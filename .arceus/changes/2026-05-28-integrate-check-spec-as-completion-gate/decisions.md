# Decisions — Integrate check-spec as completion gate

## Decision 1: 依賴 check-spec Go binary，而非 reimplement 在 TS

- **Context**: check-spec 是獨立 Go repo，Arceus 是 TypeScript。每位 Arceus 使用者要不要被迫裝 Go？
- **Options considered**:
  - (a) 要求使用者把 `check-spec` binary 裝在 PATH 上（`go install` 或從 Releases 抓 zip）
  - (b) 在 Arceus 內 reimplement 一份 TS 版的 audit judge
  - (c) 第一次呼叫時自動下載對應平台的 release binary 到 `.arceus/bin/`
- **Chosen**: (a)
- **Rationale**:
  - check-spec 設計初衷是「第三方、獨立 judge」。把它 reimplement 進 Arceus 等於消滅它的獨立性——這違反整合的核心原則
  - reimplement 是 fork：兩份 prompt、兩份 schema，未來會 drift
  - 自動下載 (c) 太魔法；下載失敗、簽章驗證、平台偵測都是維運負擔。v1 不做，未來如果使用者抱怨再說
  - 錯誤訊息會明確指引 install 路徑，使用者能自己解決
- **Revisit if**: 開發者反饋強烈不想裝 Go binary，或 check-spec 釋出 npm-distributable WASM 版本

### 子決定 1.1：版本記錄但不鎖定（不要 `minVersion`）

- **Context**: check-spec 的 JSON schema 是穩定 contract，但若日後 v2 改 schema 怎麼辦？要不要強制最低版本？
- **Options considered**:
  - (a) 在 `config.json` 加 `checkSpec.minVersion`，runtime 檢查、不符就拒跑
  - (b) 不檢查版本，但每次跑都把 `check-spec version` 結果寫進 audit metadata，靠 JSON parse 失敗 fallback (NEEDS_DISCUSSION) 捕捉不相容
  - (c) Arceus 自帶 check-spec schema 版本 whitelist
- **Chosen**: (b)
- **Rationale**:
  - (a) 把版本相容性檢查的維運責任壓在 Arceus 身上——但 check-spec 是別人的 repo，Arceus 不該成為它的版本看守人
  - (c) 是 (a) 的劣化版，更脆弱
  - (b) 的代價是「不相容時診斷沒那麼明顯」，但因為 audit 檔留下了版本字串，使用者翻 audit/latest.md 就能看見。配 JSON parse 失敗訊息也帶版本，已足夠 actionable
  - 哲學一致：信任 contract，但留痕跡

## Decision 2: 預設 advisory 模式（記錄但不擋），strict gate 由團隊 opt-in

- **Context**: 是要預設嚴格還是預設寬鬆？
- **Options considered**:
  - (a) 預設 `enabled: false`，使用者明示開啟才生效（opt-in 整個 feature）
  - (b) 預設 `enabled: true` + `requireApprove: true`（opt-out 嚴格 gate）
  - (c) 預設 `enabled: true` + `requireApprove: false`（advisory：記錄 verdict 但不擋完成）
- **Chosen**: (c) — **與初稿不同**，採納使用者明示偏好
- **Rationale**:
  - 主要使用情境是個人 prototype；hard block 在這場景下太擾民，會被當作摩擦繞過
  - advisory 並非「白做」：verdict 寫進 meta.json + 報告留進 audit/ 形成可審計軌跡，PR review 時人類能看到 judge 的意見
  - 警告訊息明示「設 `requireApprove: true` 可升級為 strict gate」——團隊要嚴格時動作很小（改一個 config）
  - 比起 (a) 一刀切關掉，(c) 至少 verdict 一直在跑，使用者習慣形成；要升級為 strict 時心理門檻低
  - 跟 Decision 5 (force) 一起看：advisory + 不需要 force，strict + 需要 force。模式之間的邊界清楚
- **Revisit if**: 開始有多人協作，發現 advisory 警告被忽略次數高、人類 review 也沒抓到 drift——這時該預設 strict

## Decision 3: verdict 必須綁 commit SHA（freshness）

- **Context**: 使用者跑完 verify 拿到 APPROVE，然後又 commit 了新東西，這時還能標 completed 嗎？
- **Options considered**:
  - (a) verdict 一次得手永遠有效（直到下次 verify）
  - (b) verdict 綁 SHA，HEAD 變了就失效
  - (c) verdict 有時間 TTL（例如 1 小時）
- **Chosen**: (b)
- **Rationale**:
  - (a) 有明顯 bypass：拿到 APPROVE 之後偷塞東西進去
  - (c) TTL 是 proxy，SHA 是 ground truth。TTL 短會煩、長會漏，沒有好的預設值
  - (b) 的代價只是「commit 後要重跑一次 verify」——這跟 CI 跑測試的心智模型一致，使用者能接受
- **Revisit if**: 大量 changes 在最後一刻被擋下、開發者抱怨重跑 verify 太貴

## Decision 4: 報告持久化到 `audit/<timestamp>.md`，不是覆寫

- **Context**: 多次 verify 的報告要怎麼存？
- **Options considered**:
  - (a) 單一檔 `audit.md` 每次覆寫
  - (b) `audit/<ISO timestamp>.md` 累積 + `audit/latest.md` 指向最新
  - (c) 存進 `.arceus/audit-log/<change-id>/`（跟 change 折疊分離）
- **Chosen**: (b)
- **Rationale**:
  - audit 報告是 spec-driven 流程的稽核痕跡——覆寫掉「我之前 REQUEST_CHANGES 過、後來 fix 了」這段歷史就失去了 review 價值
  - 跟 change folder 放一起 (b) 比 (c) 直觀：folder 就是 self-contained 的 change 資料夾，含所有歷史
  - `latest.md` 副本而非 symlink，避免 Windows 上 symlink 不友善的問題

## Decision 5: `--force` 允許跳過 gate，但會留 audit log

- **Context**: 緊急情況需要強制 mark completed 時（例如 check-spec 服務當機、deadline 壓力）怎麼辦？
- **Options considered**:
  - (a) 不提供 escape hatch，要嘛 verdict 過、要嘛 disable config
  - (b) `--force` 跳過 + 印警告
  - (c) `--force` 跳過 + 印警告 + append 到 `audit/force-overrides.log`
- **Chosen**: (c)
- **Rationale**:
  - 完全沒 escape hatch 太僵硬，會被使用者繞過（例如手動改 meta.json）——比有 escape hatch 但留紀錄更糟
  - 留 log 讓 force 的使用變成可審計事件，誰、何時、為什麼，事後可追查
  - (b) 沒留紀錄等於沒做——這是「信任但稽核」原則

## Decision 6: 用 audit 報告字數當「change 切太大」訊號（v2: 閾值 7000 字）

- **Context**: 怎麼讓使用者知道一個 change 一次塞太多東西、該拆分？
- **Options considered**:
  - (a) 不做——讓使用者自己感覺
  - (b) 字數警告：audit 報告超過 N 字時印警告，但不擋流程
  - (c) Hard limit：超過 N 字直接退出碼非 0，拒絕標 completed
  - (d) 動態 heuristic（diff 行數 + 報告長度 + task 數量綜合計分）
- **Chosen**: (b)
- **Rationale**:
  - audit 報告長度是 judge 自然輸出的訊號——judge 要寫越多字解釋偏差，幾乎等同 change 範圍越鬆散。免費的 heuristic
  - (c) 太僵硬，會踩到合法的大 change（例如 schema migration）
  - (d) 維護成本高、調參困難；先用 (b) 看實際命中率，未來真的需要再升級
  - 警告同時印到 stderr **與** audit 檔開頭，確保 PR review 時人類也看得到（不只是跑 CLI 的人）

### 閾值迭代史

| 版本 | 閾值 | 根據 | 結果 |
|---|---|---|---|
| v1（初稿）| 2000 字 | 直覺值，「2000 ≈ 4-5 個段落」 | **太嚴格**：本 change 的 dogfood 跑 3 次（12563 / 16138 / 14503 字）全部踩穿，false positive 風險高 |
| **v2**（本次）| **7000 字** | 觀察 v1 dogfood 數據 + 拆解 check-spec 報告結構 | 目前生效值 |

### v2 的計算根據

v1 失敗的根本原因：check-spec 報告長度被「**結構化逐項表格**」主導，而不是 change 大小本身：
- Task implementation 表：N tasks × ~400 字/列
- AC 表：M ACs × ~300 字/列
- Summary + Drift findings：~1500-3000 字

對「合理大小」的 change（10-15 tasks + 6-8 ACs），表格基線就佔了：
`12 * 400 + 7 * 300 + 2000 = 8900 字` ≈ 9k

因此：
- 把閾值定在「合理 change 的自然基線」之上 → 不會誤警
- 又要在「真的偏大」時觸發 → 不能太鬆

**7000 字** 卡在這個切點：
- 5-10 tasks 的小型 change：報告 ~3000-5500 字，**不**觸發
- 12-15 tasks 的中型 change：報告 ~6000-8000 字，**邊界**附近，觸發代表 drift 較多
- 20+ tasks 或大量 findings：報告 >10000 字，**確定**觸發

### Revisit 觸發條件（仍承襲 v1，校準對象換成 v2 數值）

- 連續 3 個 change 的 audit 報告長度落在 6500–7000 字之間卻**沒**被警告 → 閾值往下調
- 連續 3 個 change 被警告但事後 review 結論「拆分沒必要」→ 閾值往上調，或改用 diff 行數 / 動態公式
- 同一個 change 的 audit 報告長度連續兩次 verify 之間差異 >50% → 重新評估「字數」是否還是好的代理指標
- 收集到 ≥10 個 change 的數據後，考慮升級到 Option (d) 動態公式：`max(7000, tasks * 200 + acs * 150 + 1000)`，把「結構基線」自動扣掉

## Decision 7: 把 check-spec 安裝指引塞進 `arceus init` first-run 輸出

- **Context**: 使用者第一次裝 Arceus 時，怎麼讓他知道有 check-spec 這層 audit？
- **Options considered**:
  - (a) 只在第一次跑 `change verify` 失敗時印錯誤訊息
  - (b) 在 `arceus init` first-run 輸出中印安裝 tip
  - (c) 寫進 README，靠使用者讀
- **Chosen**: (b)
- **Rationale**:
  - (a) 太被動——使用者要先發現 verify 這個 CLI 存在才會撞到錯誤
  - (c) 沒人會主動讀 README 直到出問題
  - (b) 是 onboarding 自然時機：init 是使用者跟 Arceus 的第一次互動，這時告訴他完整生態（含 check-spec）正好
  - 若 PATH 上已有 check-spec，改顯示 `✓ check-spec detected`——獎勵已裝好的使用者，不重複叮嚀
- **Revisit if**: init 輸出變得太雜（之後還有更多整合要塞 tip）——這時該改成 `arceus doctor` 集中檢查

## Decision 8: check-spec 整合模組放 `src/integrations/`，不放 `src/state/`

- **Context**: 新模組 `check-spec.ts` 該放哪？初稿錯誤地寫進 `src/state/`，review 時被指出違反現有分層
- **Options considered**:
  - (a) `src/state/check-spec.ts`（初稿位置）
  - (b) 新建 `src/integrations/check-spec.ts`（外部整合專用資料夾）
  - (c) `src/hooks/`（既然有 hook 概念）
  - (d) `src/cli.ts` 內 inline 實作
- **Chosen**: (b)
- **Rationale**:
  - 現有 `src/state/`（`notepad.ts` / `session-log.ts` / `config.ts` / `changes.ts` / `preflight.ts`）全是**純本地檔案 I/O**，沒有任何模組做 process spawn 或外部呼叫。把 `runCheckSpec` 塞進去會稀釋這層的職責邊界——未來任何人讀 `src/state/` 都會誤以為「這裡可以 spawn process」
  - (c) hooks 是 Claude Code lifecycle event 的 handler，不是「呼叫外部工具」的概念
  - (d) inline 在 cli.ts 等於 cli.ts 變肥皂盒，且難測試（不能 mock）
  - (b) 開新資料夾的成本就是建一個檔——這個 change 順便確立「外部整合 = `src/integrations/`」的慣例，後續若要加 Plane/GitLab/GitHub sync 也有現成位置
- **Revisit if**: 未來發現「整合」這個分類太粗（例如分成 process integrations vs HTTP integrations 才合理）

## Decision 9: 不寫 `tasks.md` / `spec.md` 的 ID 編號（推遲到下個 change）

- **Context**: spec 提到 phase B 是「加 T-1 / AC-N ID」讓 check-spec judge 訊號更穩；要不要一起做？
- **Options considered**:
  - (a) 一起做（gate + 結構化 ID）
  - (b) 只做 gate（A），ID 編號留給後續 change
- **Chosen**: (b)
- **Rationale**:
  - 一個 change 一個 concern：gate 是行為改動、ID 是格式改動，混在一起 review 很難
  - ID 編號需要遷移既有 changes，blast radius 大
  - 沒有 ID，check-spec 還是能跑（它本來就是吃自由格式的 markdown）——只是判決訊號比較糊
  - 先觀察 A 上線後判決品質是否真的成問題，再決定 B 值不值得
- **Revisit if**: 上線後發現 check-spec 對逐項判決經常給不出有用結果

## Decision 10: dogfood 失敗的雙重回應——**校準閾值 + 接受殘餘失敗**

- **Context**: 跑 T-25 dogfood 三次（12563 / 16138 / 14503 字），verdict 都是 **REQUEST_CHANGES**，報告長度都遠超原始 2000 字閾值。AC14 在 v1 spec 下嚴格失敗。我們有兩個獨立但相關的問題要回答：
  1. **2000 閾值本身對不對**？
  2. **就算閾值對了，本 change 仍超標**——怎麼處理？

- **Options considered**（兩層決策樹）:

  第一層：閾值校準
  - (1a) 不動閾值，承認 dogfood 失敗
  - (1b) 根據新數據調整閾值

  第二層：本 change 怎麼結案
  - (2a) 拆分本 change：把實作切成 6-8 個小 change 重做
  - (2b) 一路提高閾值到讓本 change 過（cheating — 例如改成 15000）
  - (2c) advisory 模式下 mark completed，把殘餘失敗記為已知 limitation
  - (2d) 切 strict + `--force` 跳過

- **Chosen**: **(1b) + (2c)**
  - 第一層：把閾值從 2000 升到 **7000**（詳見 Decision 6 v2 的計算根據）
  - 第二層：本 change 在新閾值下仍超標（14503 > 7000），但**接受**這個現實，advisory 模式 mark completed

- **Rationale**:
  - **為什麼不只做 (2c)**：原本只承認失敗、不改閾值，等於把錯誤的 heuristic 留給後面所有 change 繼承——下個 change 就算只有 10 tasks 也會踩穿。dogfood 的價值就是讓 v1 假設**被資料證偽**，順手校準是正確的迭代
  - **為什麼不選 (2b)**：如果只把閾值調到 14503+1 讓本 change 過，就是「考試考不過改通過分數」。Decision 6 v2 的 7000 是基於「合理 change 的結構基線」算出來的，不是為了讓本 change 過
  - **為什麼不選 (2a) 拆分**：1600+ 行 diff、跨 8 個檔案的工作回頭拆 commit。價值低於成本：實作已 review、tests 過、AC 17/18 PASS（AC11 已修、AC14 是這條決策的對象）。拆分的好處是「dogfood 過」，但會大量改寫 git 歷史
  - **為什麼不選 (2d) force**：Force 是緊急逃生口，不是「我寫的 change 太大」的常規回應。濫用會稀釋訊號
  - **為什麼選 (2c)**：advisory 模式的設計初衷就是 **verdict 記錄、警告印出、人類決定是否 ship**。我們作為人類已 review，知道 audit 長度的根因有兩個：(i) check-spec 報告天生隨 task/AC 數量線性成長；(ii) 本 change 實作偏大。前者是 check-spec 的特性、後者是真實但**已知**的訊號——我們**承認**它

- **Learning**（要 propagate 到未來 changes）:
  - 下次 propose 時把 **task 數壓在 < 15**：超過代表 change 範圍過大，應在 propose 階段就拆分
  - **AC 數量壓在 < 10**：類似道理
  - **如果一個 change 必須包含基礎建設 + 多個 feature surface**，先用一個小 change 落地基礎建設、再用小 change 逐個加 feature。`integrate-check-spec` 回頭看應該拆成: gate-types-only / cli-verify-command / advisory-strict-modes / docs-update / tests 五個
  - **閾值不是「考試通過分數」**：當 dogfood 失敗時，先問「閾值對不對」（校準），再問「本 change 是否仍超標」（承認）——兩個動作獨立、都要做

- **Revisit if**:
  - 後續 3 個 change 都過了 dogfood，本 change 就是「歷史學習」，不需要再動
  - 若連續多個 change 在新閾值（7000）下都 fail dogfood（即便 change 範圍合理），證實 Decision 6 v2 仍偏低，**那時**再迭代到 v3
