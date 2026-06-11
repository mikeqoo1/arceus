# Stop hook verification gate

## 為什麼 (Why)

目前 Arceus 的驗證提醒是**純建議性**的：

- `subagent-stop.ts` 在 `arceus:coder` / `arceus:debugger` 完成時注入一段 `<arceus-verification-reminder>`（`src/hooks/subagent-stop.ts:32-48`），但這只是 `additionalContext`——AI 可以忽略
- Stop hook（`src/hooks/stop.ts`）只記錄 `session_stop` 事件然後 `passThrough()`，不做任何檢查
- `post-tool-use.ts` 會記錄 `Bash`/`Edit`/`Write`/`Agent` 四種工具的使用（`src/hooks/post-tool-use.ts:14`），但不記錄 `MultiEdit`/`NotebookEdit`（`pre-tool-use.ts:15-20` 的 `MODIFYING_TOOLS` 已包含這兩個），也不區分「編輯了程式碼」和「跑了驗證」
- 結果：AI 可以大量改 code 後直接結束回合，verification 步驟被完全跳過，使用者看到回應時 code 已被修改但沒有任何品質保證

`subagent-stop.ts` 的提醒補不了這個缺口——它只在 subagent 完成時觸發，主 agent 直接寫 code 時完全旁通。而且 Stop hook 每個回合都觸發（不只是 session 結束），這代表**每一輪 AI 回應**都是可以閘門的檢查點。

`check-spec` 完成閘門（`2026-05-28-integrate-check-spec-as-completion-gate`）解決的是 **change 層級**的驗證——「整個 change 能不能標 completed」。但一個 change 的實作過程中，AI 可能跨多個 Stop 回合逐步修改程式碼，每個回合結束時都應確認「這一輪的修改有跑過驗證」。這是**回合層級 (turn-level)** 的缺口。

這個 change 把 Stop hook 升級為**驗證閘門**：讀取 session log，判斷最後一次 code edit 之後是否有成功的 verification run。缺失時，advisory 模式印警告（zero friction），strict 模式 block stop 並指示 AI 補跑驗證。

### 設計原則

- **MINIMAL SURFACE**：最小 diff、最大複用。不發明新機制——複用既有的 session log（`src/state/session-log.ts`）、config 命名慣例（`checkSpec.*` / `preflight.*`）、hook 錯誤處理慣例（`main().catch(() => exit(0))`）
- **fail-open**：任何內部錯誤 → `passThrough()`，絕不鎖住使用者。與 `preflight.ts` 的 `gitOutput catch → null` 和 `config.ts` 的 `readConfig catch → {}` 一致
- **advisory 預設、strict opt-in**：鏡像 `checkSpec.requireApprove` 的哲學（`src/state/config.ts:29-34`），預設記錄但不擋
- **5 秒以內**：`hooks/hooks.json` 給 Stop hook 5 秒 timeout（line 68），gate 只做 `readSessionLog` 檔案 I/O，絕不 spawn 驗證命令

## 範圍 (Scope)

- **In scope**:
  - 在 `post-tool-use.ts` 新增結構化事件記錄：`code_edit`（明確記錄 tool name + file path）、`verification_run`（記錄 command kind + ok flag）——取代從 truncated `data.input` 反解析的脆弱方式
  - 補齊 `post-tool-use.ts` 的 `significantTools` 遺漏：從 `["Bash", "Edit", "Write", "Agent"]` 擴展為 `["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Agent"]`，對齊 `pre-tool-use.ts:15-20` 的 `MODIFYING_TOOLS`
  - 在 `post-tool-use.ts` 新增 `typeof` guard for `tool_response`，防止 runtime 收到非 string 時的靜默資料損壞（`truncate()` 在 object 輸入時不 throw 但回傳 object 原樣，外層 `JSON.stringify` 會產出錯誤格式的 event data）
  - 在 `types.ts` 的 `StopInput`（line 51-53）新增 `stop_hook_active?: boolean` 欄位
  - 重寫 `stop.ts`：讀取 session log → 評估 gate predicate → advisory 時 `systemMessage` 警告 / strict 時 `decision: "block"` + `reason`
  - 新增 `src/hooks/stop-gate.ts`：純函式模組，包含 `evaluateStopGate()` gate predicate 邏輯，與 `stop.ts` 的 I/O 分離，方便 vitest 單元測試
  - 在 `config.ts` 的 `ArceusProjectConfig` 新增 `stopGate` config block（`enabled` / `requireVerify` / `excludedPaths`）
  - Loop protection：當 `stop_hook_active === true` 時，直接 `passThrough()`（不再 block，避免無窮迴圈）
  - 預設路徑排除（`.arceus/`、`*.md`）：只編輯文件/提案時不要求跑 npm 驗證
  - Unit tests: `tests/unit/hooks/post-tool-use.test.ts`、`tests/unit/hooks/stop-gate.test.ts`
  - 文件更新：`CLAUDE.md`、`docs/architecture/arceus-plugin-architecture.md`（繁體中文）

- **Out of scope**（留給後續 changes）:
  - 讓 stop gate 自己 spawn verification command（違反 5 秒 timeout 限制；gate 只判斷 log 裡的紀錄）
  - 分析 verification run 的 diff coverage（哪些改過的檔案被測試覆蓋）——過度工程
  - 把 `verification_run` 事件綁到特定 change proposal（session log 是 session-scoped，不是 change-scoped）
  - `requiredKinds` config（要求所有 typecheck+lint+test+build 都通過才算 verified）——v1 只看「有任何一個 verification_run.ok === true」即可
  - Per-session env var bypass（`ARCEUS_SKIP_STOP_GATE=1`）——`stopGate.enabled: false` 已足夠
  - 跨 session 的驗證追蹤（每個 session 獨立）
  - `extraVerificationPatterns` config knob——v1 硬編碼 pattern，用 config 擴充留給 v2

## Stakeholders

- **Owner**: @mikeqoo1（Arceus 專案作者）
- **Primary user**: 所有使用 Arceus 的 Claude Code 使用者
- **Affected components**: `stop.ts`、`post-tool-use.ts`、`types.ts`、`config.ts`（均為小幅修改）+ 新增 `stop-gate.ts`
- **Relationship to existing mechanisms**: 與 `subagent-stop.ts` 互補不衝突——subagent-stop 在 subagent 結束時注入「請跑驗證」的 guidance，stop gate 在主 agent 回合結束時檢查「有沒有真的跑了」。三層（subagent-stop reminder → stop gate → checkSpec completion gate）各司其職，攔截時機完全不同、控制力遞增、不會同時觸發同一事件
