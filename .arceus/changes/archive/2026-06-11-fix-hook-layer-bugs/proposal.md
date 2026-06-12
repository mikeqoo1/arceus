# Fix hook layer bugs

## 為什麼 (Why)

2026-06-11 的 autopilot 全週期執行中發現三個 hooks 層 bug（已開 issue #5/#6/#7）：

1. **#5 — PreToolUse matcher 只註冊 Bash**：`pre-tool-use.ts` 的 `MODIFYING_TOOLS` 分支（protected branch 擋編輯、behind-upstream 擋編輯）因 `hooks/hooks.json` 的 matcher 只有 `"Bash"` 而**從未執行**。skills 文件承諾的「preflight hook will hard-block edits」是空話。連帶問題：hook timeout 3 秒 < preflight `git fetch` 預設 10 秒——matcher 修好後首次編輯可能因 fetch 超時被 Claude Code 砍掉 hook。
2. **#6 — SubagentStop reminder 循環注入**：`subagent-stop.ts` 對 coder/debugger 的 verification reminder 無去重——subagent 每次回應→stop→hook 再注入→再回應，循環到 agent 放棄。三個 coder 的結尾回報全數被吃掉（實錄在 issue #6）。
3. **#7 — keyword-detector 被系統文字誤觸發**：task notification 內文的 "review" 一詞觸發了完整 code-review skill 注入（數 KB context + 錯誤工作流指示）。`sanitizePrompt()` 與 `isInformationalContext()` 都攔不住非使用者意圖的 harness 文字。

三個 bug 同屬 hooks 層、彼此檔案不相交，合併為一個 change 處理（見 Decision 1）。

## 範圍 (Scope)

- **In scope**:
  - `hooks/hooks.json`：PreToolUse matcher 擴為修改類工具 + timeout 調整
  - `src/state/preflight.ts` / `src/state/config.ts`：fetch timeout 預設值下修
  - `src/hooks/subagent-stop.ts`：per-agent_id marker 去重
  - `src/hooks/keyword-detector.ts`：系統文字 marker 早退
  - 對應 unit tests（含 matcher 覆蓋率的 regression guard）與文件同步
- **Out of scope**:
  - preflight 邏輯本身的行為變更（fetch 策略、protected branches 清單）
  - Layer 1 reminder 的存廢重新評估（stop gate 落地後的後續討論）
  - keyword 觸發詞表的增刪

## Stakeholders

- **Owner**: @mikeqoo1
- **影響**: 所有 plugin 使用者——#5 修復會**首次啟用**分支保護（行為變更，main 上編輯會被擋）；#6 修復讓委派 subagent 的回報恢復正常；#7 修復讓背景通知不再污染 context
