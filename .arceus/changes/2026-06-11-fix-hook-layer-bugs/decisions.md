# Decisions — Fix hook layer bugs

## Decision 1: 三個 bug 合併一個 change，不拆三個

- **Context**: 三個 issue 彼此獨立，照慣例可各開一個 change。
- **Options considered**: (a) 三個 change 三次 propose/audit；(b) 一個 change 三節 spec。
- **Chosen**: (b)
- **Rationale**: 同屬 hooks 層修復、檔案不相交、單一 PR。拆三個會在同一條 stacked branch 上做三次 check-spec base 體操（diff 歸屬混亂），ceremony 成本超過收益。check-spec size 警告若觸發即為此決策的反證，屆時下次拆開。

## Decision 2: matcher 顯式列舉，不用 `"*"`

- **Context**: matcher 要涵蓋修改類工具。`"*"` 最省維護但每次 Read/Glob/Grep 都 spawn 一個 node process。
- **Chosen**: `"Bash|Edit|Write|MultiEdit|NotebookEdit"` + 測試強制與 `MODIFYING_TOOLS` 同步。
- **Rationale**: 唯讀工具呼叫頻率最高，PostToolUse 已經是 `"*"`（必要——要記錄所有事件），PreToolUse 不需要跟進。drift 風險由 T-3 的雙向 regression guard 吸收。

## Decision 3: timeout 組合取 fetch 3s + hook 10s

- **Context**: 原本 hook 3s < fetch 10s 必然超時。issue #5 給了三個方向。
- **Chosen**: 兩端一起調——fetch 下修到 3s（preflight 是 best-effort，慢網路下 fail-open 本來就是設計），hook 上修到 10s（preflight 每 session 只跑一次，10s 是首次編輯的最壞情況上限，不是每次成本）。
- **Rationale**: 只調一端要嘛犧牲 fetch 完成率（1s 太短）、要嘛讓 hook 上限離譜（15s+）。3/10 留 7 秒餘裕給其餘 git 呼叫。

## Decision 4: `<system-reminder>` 不列入系統文字 marker

- **Context**: harness 的 system-reminder 會「附加」在真實使用者 prompt 上，而 task-notification / command payload 是「整則」系統文字。
- **Chosen**: 只攔整則系統文字的 marker（task-notification / local-command-caveat / command-name / persisted-output）。
- **Rationale**: 列入 system-reminder 會讓「使用者輸入 + 附帶 reminder」的正常情境全面失去關鍵字偵測——誤殺面太大。混合內容的殘餘誤觸發風險由現有 sanitize + informational-context 機制承接。

## Decision 5: reminder 採 marker 去重而非移除 Layer 1

- **Context**: stop gate（Layer 2）落地後，Layer 1 reminder 的必要性下降，issue #6 也提出重新評估選項。
- **Chosen**: 本 change 只做最小修復（per-agent_id 一次性）；Layer 1 存廢另案討論。
- **Rationale**: 移除 Layer 1 是四層模型的架構決策，需要實際觀察 stop gate 上線後的行為數據，不該夾在 bug fix 裡。

## Decision 6: 對抗式審查結果（APPROVE、0 block、10 advisory）與處置

- **修復（6 項）**:
  1. **[security warn]** marker 路徑消毒：`session_id`/`agent_id` 來自 hook stdin 未經驗證即進 `path.join`（traversal sink）——新增 `safePathSegment()`（`[^A-Za-z0-9._-]` → `_`），並加 traversal 形 id 的 regression test。
  2. agent_id 缺失防護：dedup 整段（含 `existsSync`）包進 try/catch，`agent_id` 缺失或 fs 錯誤一律降級為「照常注入」——提醒兩次好過永遠不提醒（原寫法 `join(undefined)` 會 throw 進頂層 catch，reminder 永久靜默）。
  3. **[performance warn]** preflight 失敗重試成本：preflight 失敗時 success marker 不寫（設計如此，讓使用者修好分支後重試），但這代表每次重試都付一次 `git fetch`（至多 3 秒）。新增 `preflight.fetched` per-session marker——fetch 每 session 至多一次，重試只跑本地 git。
  4. matcher guard 補 `"Bash"`（dangerous-Bash 分支同樣依賴 matcher，原斷言只覆蓋 MODIFYING_TOOLS）。
  5. matcher guard 容忍 `"*"`（合法的全匹配 matcher 會讓 `new RegExp("^(?:*)$")` 直接 SyntaxError）；timeout 斷言只檢查顯式值（省略 = Claude Code 60s 預設，餘裕充足）。
  6. `<local-command-caveat>` 補測試（四個 marker 全覆蓋）。
- **記錄後順延（3 項 suggest）**:
  - reminder markers / sessions 目錄無清理機制——與既有 sessions/ 生命週期一致（preflight.ok、log.jsonl 同樣不清理），未來可做 `arceus prune` 統一處理。
  - 修改類工具每次呼叫多一個 node spawn（~30-80ms）——hooks 架構固有成本，PostToolUse 已是 `"*"`。
  - 首次編輯觸發 `git fetch` 網路 egress（環境憑證）——preflight 既有設計（best-effort、fail-open），fetch-once marker 已把頻率降到每 session 一次。
