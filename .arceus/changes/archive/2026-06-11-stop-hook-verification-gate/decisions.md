# Decisions — Stop hook verification gate

## Decision 1: 預設 advisory 模式（`stopGate.enabled: true, requireVerify: false`）

- **Context**: Stop gate 預設應該多嚴格？這決定了零配置使用者的首次體驗。
- **Options considered**:
  - (a) 預設 `enabled: false`——完全 opt-in，不影響現有使用者
  - (b) 預設 `enabled: true` + `requireVerify: true`——strict，每回合必須驗證
  - (c) 預設 `enabled: true` + `requireVerify: false`——advisory，印 `systemMessage` 警告但不阻止
- **Chosen**: (c)
- **Rationale**:
  - 鏡像 `checkSpec` 的預設策略（`src/state/config.ts:29-34`，`enabled: true` + `requireApprove: false`）。同一個 plugin 的兩個 gate 用相同的預設邏輯，降低使用者認知負擔
  - (a) 太被動——使用者不會主動去開一個不知道存在的 feature
  - (b) 會嚴重影響每回合互動的流暢度——Stop hook 每輪觸發（不只 session 結束），如果使用者在探索性對話中隨手改了一行 code，hard block 逼人跑 `npm run verify` 太擾民
  - (c) 的 `systemMessage` 讓使用者看到提醒但不被打斷，形成習慣後再升 strict
  - advisory 不需要額外的 escape hatch/marker file 機制，diff 更小
- **Revisit if**: 觀察到 advisory 警告被使用者持續忽略，驗證遺漏仍頻繁發生

## Decision 2: 結構化事件（code_edit / verification_run）取代從 generic tool_use 反解析

- **Context**: stop gate 需要知道「有沒有改過程式碼」和「有沒有跑過驗證」。來源可以是 (a) 從現有 `tool_use` 事件的 `data.input`（截斷至 500 字的 JSON string）反解析，或 (b) 在 PostToolUse 階段就產出語意明確的結構化事件。
- **Options considered**:
  - (a) 從 `tool_use.data.input`（`truncate(JSON.stringify(input.tool_input), 500)` 的結果，post-tool-use.ts:21）解析 file_path / command
  - (b) 在 `post-tool-use.ts` 額外產出 `code_edit` / `verification_run` 事件，欄位結構固定
- **Chosen**: (b)
- **Rationale**:
  - (a) 的 `data.input` 是被 truncate 到 500 字的 JSON string。對於 `MultiEdit` 等 tool，tool_input 的 JSON 很容易超過 500 字，截斷後 JSON parse 必定失敗。gate 如果依賴 truncated string 反解析，任何 non-trivial edit 都會導致 file_path 提取失敗
  - (b) 在 PostToolUse 階段就能拿到完整的 `input.tool_input` object（types.ts:38，`Record<string, unknown>`），直接存取屬性，不經截斷
  - 語意清晰：session log 從「一堆 tool_use」變成「code_edit 和 verification_run 混著 tool_use」，未來任何消費者（不只 stop gate）都能直接利用
  - 額外 log 寫入成本：每筆事件是一行 JSON append 到 JSONL 檔，可忽略

## Decision 3: 用 failure-marker heuristic 判定 `verification_run.ok`，不依賴 exit code

- **Context**: `PostToolUseInput` 沒有 `exit_code` 欄位；`tool_response` typed as string（types.ts:39）但被 truncate 到 500 字。怎麼判斷 verification 成功？
- **Options considered**:
  - (a) 只記錄 attempt（`ok` 永遠 `true`，等同「有跑就算驗證」）
  - (b) 從 `tool_response` 字串搜尋已知的 failure pattern（`error TS\d`, `FAIL`, `ERR!`, `exit code [1-9]`, `Command failed`, `\d+ errors`），無 match 則 `ok = true`
  - (c) 等 Claude Code hook protocol 原生提供 `tool_exit_code` 欄位
- **Chosen**: (b)
- **Rationale**:
  - (a) 太弱——使用者跑 `npm run test` 失敗了 10 次，gate 全部放行，失去意義
  - (c) 不可控——Claude Code 的 protocol 演進由 Anthropic 決定，不能 block 本 feature
  - (b) 多 signal 組合比單一 signal 健壯。六個 failure marker 覆蓋 TypeScript compiler / vitest / jest / npm error 的常見輸出。選擇「預設 ok=true，出現失敗標記才翻 false」而非反向——成功輸出的格式更多元（`All tests passed`/`0 errors`），失敗標記反而更一致
  - **已知限制**：truncation 到 500 字可能丟失 failure marker（特別是 lint 輸出很長時 error count 在尾部）。v2 可考慮提高 verification_run 的 tool_response truncation，但 v1 不做。false negative 在 advisory 模式下只是少一個警告；strict 模式下 check-spec completion gate（`src/state/changes.ts:430-487`）是最後防線
  - 所有 failure markers 和 verification patterns 集中在 `post-tool-use.ts` 的 const，方便未來擴充
- **Revisit if**: false positive/negative 的實際發生率高到影響使用體驗；或 Claude Code hook protocol 新增 `tool_exit_code` 欄位

## Decision 4: Loop protection 用 `stop_hook_active` 一次放行，不做 bounded N rounds marker file

- **Context**: Stop hook block 後 Claude 繼續執行，下一輪結束時 Stop hook 再觸發。如果 AI 沒跑驗證就又想停，會不會無窮迴圈？
- **Options considered**:
  - (a) `stop_hook_active === true` 時直接 `passThrough()`（最多 block 一次）
  - (b) 用 marker file `.arceus/sessions/<session_id>/stop-gate-rounds.json` 追蹤已 block 次數，N 次後放行
  - (c) 不做 loop protection，信任 AI 一定會跑驗證
- **Chosen**: (a)
- **Rationale**:
  - (c) 太危險——AI 可能因 context 限制根本不理解 reason 中的指示，造成真正的無窮迴圈鎖死 session
  - (b) 比 (a) 多一層彈性（「允許 block N 次」），但增加了 fs 狀態管理（寫/讀/清理 marker file）和 config 膨脹（`maxRounds` knob）。邊際收益低——如果第一次 block + 明確 reason 還不夠讓 AI 去跑驗證，第二次第三次也不太可能成功。marker 檔的 I/O 還會引入「純函式 stop-gate.ts 要不要做 I/O」的架構矛盾
  - (a) 是最簡單的安全閥門：block 一次讓 AI 看到 reason，如果它仍然沒跑驗證，第二次放行避免鎖死。零 state file，零 counter logic，一個 `if` 搞定
  - 若 `stop_hook_active` 欄位不存在（Claude Code 尚未送此欄位），`input.stop_hook_active === true` 為 `false`，loop protection 不生效。此時 AI 在 block reason 指示下跑完驗證後再 stop，第二輪 session log 有 verification_run → gate pass。只有「驗證根本跑不了」的情境才可能 loop——但使用者可以 Ctrl+C 中斷或設 `stopGate.enabled: false`
  - passThrough 時附帶 systemMessage 警告（F7），讓使用者知道 gate 被 bypass 了
- **Revisit if**: 實測發現 `stop_hook_active` 欄位確實不存在於 Claude Code 的 StopInput，且 infinite loop 在實際 session 中可復現。此時升級為 (b) marker file 方案

## Decision 5: 用 array index 判斷事件時序，不用 timestamp 字串比較

- **Context**: gate predicate 需要判斷「code_edit 之後是否有 verification_run」。用什麼比較時序？
- **Options considered**:
  - (a) ISO 8601 timestamp 字串比較（`event.timestamp > lastEditTimestamp`）
  - (b) array index 比較（`eventIndex > lastEditIndex`）
  - (c) 混用（先 index，timestamp 做 tiebreak）
- **Chosen**: (b)
- **Rationale**:
  - session log 是 append-only JSONL（`session-log.ts:32`，`appendFileSync`），`readSessionLog` 逐行 parse（session-log.ts:41-45），回傳的 array 順序即 append 順序。array index 天然代表時序，不依賴時鐘精度
  - (a) 有 edge case：同一秒內有多個事件時字串相等，判斷失效
  - (c) 增加複雜度但無額外收益——append-only 的 JSONL 保證 index 單調遞增
  - 純函式 `evaluateStopGate` 接收的 `events: SessionEvent[]` 只需用 `.findLastIndex()` 即可

## Decision 6: verification command pattern 硬編碼，不讀 `config.verification`；v1 已知限制

- **Context**: 怎麼識別哪些 Bash 命令是 verification command？`config.verification`（config.ts:14-19）已有 `build`/`test`/`lint`/`typecheck` 欄位。
- **Options considered**:
  - (a) 從 `config.verification` 讀取使用者設定的 override command string，作為 detection pattern
  - (b) 硬編碼常見 verification command 的 regex pattern，不讀 config
  - (c) 硬編碼 + config `stopGate.extraVerificationPatterns` 讓使用者擴充
- **Chosen**: (b)
- **Rationale**:
  - `config.verification` 的 value 是 **execution** override（如 `"pnpm test"`），不是 **detection** pattern。用途不同：execution 是「跑什麼」，detection 是「怎麼認出來」。強制把 execution string 變成 regex match 邏輯會很脆弱（`"cd packages/foo && pnpm test"` 不能直接當 pattern 用）
  - (c) 的 `extraVerificationPatterns` 讓使用者在 JSON config 中寫 regex string——認知負擔高，且 v1 的 advisory 預設下使用者可能永遠不會配置。留給 v2
  - **v1 limitation**：使用 `pnpm`/`yarn`/`bun` 的專案，其 verification 指令可能不被硬編碼 pattern 覆蓋。但大部分人仍然用 `npm run test` 或直接呼叫 `vitest`/`tsc`/`eslint`，這些都被覆蓋。不匹配的指令不產出 `verification_run` 事件，gate 會 false-trigger（advisory 多一個 warning / strict 多一次 block），不會 false-pass
- **Revisit if**: 收到使用者回饋反映 pnpm/yarn/bun 使用者被頻繁誤觸 gate

## Decision 7: gate predicate 提取為 `stop-gate.ts` 純函式模組，事件分類邏輯 inline 在 `post-tool-use.ts`

- **Context**: 分類邏輯（code_edit / verification_run 判定）和 gate predicate（evaluateStopGate）放哪裡？
- **Options considered**:
  - (a) 全部 inline 在 `post-tool-use.ts` 和 `stop.ts` 中
  - (b) 分類邏輯提取為 `event-classifier.ts` + gate predicate 提取為 `stop-gate.ts`（兩個新模組）
  - (c) 分類邏輯 inline 在 `post-tool-use.ts`（本地函式），gate predicate 提取為 `stop-gate.ts`（一個新模組）
- **Chosen**: (c)
- **Rationale**:
  - gate predicate（`evaluateStopGate`）是純函式（inputs: events array + config → output: action enum），天然適合獨立模組 + 直接 unit test，不需要 mock stdin/stdout/fs
  - 分類邏輯只被 `post-tool-use.ts` 消費一次，不需要獨立模組。inline 為本地函式（如 `denyEdit` 在 `pre-tool-use.ts:31-44` 中 inline）符合 hooks 目錄的既有風格，且避免多建一個檔案帶來的 tsup bundle 驗證負擔
  - (a) 把 gate 邏輯塞進 stop.ts 會讓 hook 變肥（stop.ts 目前 27 行），且測試必須 mock 整個 hook I/O
  - (b) 兩個新模組增加結構複雜度，且 event-classifier.ts 需要讀 config 來做 excludePaths 過濾——但 excludePaths 過濾應在 gate predicate 階段做（Decision 8），不是 classification 階段
  - tsup 的 `noExternal: [/.*/]`（tsup.config.ts:36）會自動把 `stop-gate.ts` tree-shake 進 `dist/hooks/stop.js`，不需要額外 entry point

## Decision 8: excludedPaths 過濾在 gate predicate 階段做，不在 post-tool-use classification 階段

- **Context**: `.arceus/` 和 `*.md` 的路徑排除應該在哪裡執行？在 post-tool-use.ts（不產出 code_edit 事件）還是在 stop-gate.ts（忽略 excluded 事件）？
- **Options considered**:
  - (a) 在 post-tool-use.ts classifier 階段過濾：excluded path 的 edit 不產出 code_edit 事件
  - (b) 在 stop-gate.ts predicate 階段過濾：code_edit 全部產出，gate 判定時忽略 excluded path
- **Chosen**: (b)
- **Rationale**:
  - (a) 要求 post-tool-use.ts 讀取 config（目前不讀 config，也不 import readConfig），增加了 hook 的 I/O 和啟動時間。PostToolUse hook 每次 tool call 都觸發，應保持最簡
  - (b) 讓 post-tool-use.ts 只做「分類 + 記錄」，stop-gate.ts 做「判定 + 過濾」。職責清晰
  - session log 中保留所有 code_edit 事件（包含 excluded path 的）也有除錯價值——未來可以用來分析「這個 session 改了哪些檔案」
  - gate predicate 已經要讀 config（為了 enabled/requireVerify），多讀一個 excludedPaths 是零成本

## Decision 9: 預設排除 `.arceus/` 和 `*.md`，用前綴/後綴字串比對，不引入 glob

- **Context**: AI 編輯 proposal / spec / README 等檔案後停下來，gate 該不該要求跑 npm run verify？matching 用什麼語法？
- **Options considered**:
  - (a) 不排除任何路徑
  - (b) 前綴/後綴字串比對（`.arceus/` = prefix，`*.md` = suffix）
  - (c) glob 語法（`**/*.md`、`.arceus/**`），自實作或引入 picomatch
- **Chosen**: (b)
- **Rationale**:
  - (a) 會讓 `propose` skill 每次寫完 proposal 就 gate 一次——明顯不合理
  - (c) glob 語法增加實作複雜度：自製 glob matcher 約 15-20 行但 `**` 跨路徑分隔符的語意有 edge case；引入 picomatch 違反 hooks standalone 零 npm dependency 原則（tsup `noExternal: [/.*/]` 會 bundle 進去增大 bundle size）
  - (b) 兩種 matching 規則覆蓋最常見場景，總共 5 行 code，易讀易測。`excludedPaths` config 讓使用者可以加 `["docs/", "*.json"]` 等自訂排除
  - `"unknown"` file_path 不匹配任何 exclusion——保守策略：若 file_path 提取失敗，寧可多 gate 一次
- **Revisit if**: 使用者需要複雜 pattern（如 `tests/**/*.test.ts`），但在 excludePaths 場景中極不可能

## Decision 10: 與三層驗證機制的分工——不修改 subagent-stop.ts

- **Context**: Arceus 已有兩層驗證機制。新增第三層會不會造成重複催促？
- **Options considered**:
  - (a) 取代 subagent-stop.ts 的 verification reminder
  - (b) 三層共存但各有明確分工
- **Chosen**: (b)
- **Rationale**:
  - **subagent-stop.ts**（`src/hooks/subagent-stop.ts:32-48`）：在 `arceus:coder`/`arceus:debugger` 完成時注入 **guidance**（`additionalContext`）。時機：subagent 結束時。控制力：零
  - **stop gate**（本 change）：在主 agent **每回合結束時檢查** session log。時機：回合結束。控制力：advisory systemMessage 或 strict block
  - **checkSpec completion gate**（`src/state/changes.ts`）：在 `change status completed` 時要求 check-spec verdict。時機：lifecycle transition。控制力：throw Error
  - 三者攔截時機完全不同。subagent 的 verification reminder + stop gate 看到的 verification_run 事件是自然互補：reminder 引導 AI 跑驗證 → 驗證結果被記錄為 verification_run → stop gate 看到就 pass。不存在「重複叮嚀」問題
  - (a) 移除 subagent-stop reminder 會失去「前導提醒」——AI 收不到 guidance 就更不可能自發跑驗證，stop gate 被 block 的機率反而上升

## Decision 11: T-1 instrumentation spike 結果（2026-06-11 實測）

- **Context**: spec 技術假設 2（subagent 的 PostToolUse 與主 agent 共用 session log）與 F1c（`tool_response` 型別防禦）需要實證。
- **方法**: 零改碼 probe——讓 `arceus:tester` subagent 執行 `echo SPIKE_T1_SUBAGENT_PROBE_OK`，然後 grep 當前 session 的 `log.jsonl`（以 `"tool":"Bash"` 過濾，排除 Agent-spawn 事件 prompt 內容的誤判）。
- **結果**:
  - **假設 2 成立**：subagent 的 Bash 呼叫以 `"tool":"Bash"` 出現在同一份 `.arceus/sessions/<session_id>/log.jsonl`（命中 1 筆）。`arceus:tester` 跑的 verification 會被 gate 看到，無需修改 SubagentStop hook。
  - **F1c 從理論變實證**：同一筆 log 顯示 `"response":{"st...`——runtime 的 `tool_response` 是 **object** 而非 string。現行 `truncate()` 對 object 輸入回傳原值（`.length` 為 `undefined`，`undefined > max` 為 false），object 被原樣嵌入 event data——silent corruption 正在發生，且 response 完全未被截斷（log 膨脹）。T-3 的 typeof guard 為必要修復，非防禦性過度設計。
  - 額外觀察：`subagent_complete` 事件（subagent-stop hook 產出）也在同一 log，`agent: "tester"` 欄位可用——未來若需區分 main/subagent 來源，資料已存在。
- **影響**: 不需要 fallback 方案（spec 假設 2 的「若假設錯誤」分支不啟用）；T-1 無 spike code 需要清除（probe 未改任何程式碼）。

## Decision 12: 對抗式審查（multi-agent adversarial review）結果與修正（2026-06-11）

- **Context**: 實作完成、`npm run verify` 全綠後，以 4 維度 reviewer（spec 合規 / 正確性 / 安全強健 / 一致性）+ 每個 blocker/major 發現 3 人 refuter 小組投票的方式做獨立審查（19 agents）。
- **Confirmed majors（3 個，全數修復）**:
  1. `/\bERR!\b/` 的 trailing `\b` 在真實 npm 輸出（`ERR! ` 後接空格/換行）永遠不成立 → npm 失敗全數漏判為 ok=true。修正為 `/\bERR!/`，並新增 `/"exitCode":\s*[1-9]/` 捕捉 object 形式 tool_response 字串化後的 non-zero exit（refuter 以 Node 實測確認）。
  2. test pattern 匹配 `npm install jest` → 裝套件產生幽靈 `verification_run ok=true`，可無聲騙過 strict gate。修正為 segment 切分 + package-management guard（`npm install jest && npm test` 仍由第二段正常計入）。
  3. AC7/AC8 的 stop.ts 輸出分發分支（warn→systemMessage / block→decision）無整合測試——warn/block 寫反也能 105 測試全綠。補上三個 `runStopHook` 整合測試。
- **Panel 駁回（2 個，不修）**:
  - 「reason 內嵌檔名構成 prompt injection」（1/3 維持）——檔名來自本機 session log，威脅模型不成立。
  - 「isExcludedPath substring 比對可被檔名繞過」（0/3 維持）——spec F6 明定 includes 行為，Decision 9 已記錄取捨。
- **Minors 一併修復**: `/[1-9]\d*\s+errors?\b/i` 排除 "0 errors" 成功摘要；loop-protection 移到 enabled 檢查之後（disabled gate 不發訊息）；`readSessionLog` 改逐行容錯（單行損毀不再使整份 log 作廢——原行為會讓 gate 整個 session 靜默旁路）；測試斷言釘死（`not.toBe("pass")` → `toBe("warn")`、loop-protection 測試必須看到 systemMessage）；CLAUDE.md / 架構文件 / spec 措辭同步（AC10、F3 流程、hooks 表「session 結束前」→「每回合」）。
- **Rationale**: 三個 confirmed major 都是「測試全綠但行為錯誤」的類型——單靠 Layer 1 自我驗證抓不到，正是獨立對抗式審查的價值所在。spec 同步修訂（而非讓實作偏離 spec），維持 spec = 事實。
