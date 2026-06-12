# Spec — Fix hook layer bugs

## 需求描述

### F1（issue #5）PreToolUse matcher + timeout

**F1a. matcher**：`hooks/hooks.json` 的 PreToolUse matcher 從 `"Bash"` 改為 `"Bash|Edit|Write|MultiEdit|NotebookEdit"`（顯式列舉而非 `"*"`——避免 Read/Glob 等唯讀工具白白 spawn node，見 Decision 2）。
**F1b. timeout 對齊**：hook timeout `3` → `10`（秒）；`preflight.ts` 的 `fetchTimeoutMs` 預設 `10_000` → `3_000`（`config.ts` JSDoc 同步）。原則：fetch 上限必須明顯小於 hook 上限，留時間給其餘 git 呼叫。
**F1c. regression guard**：`tests/unit/plugin-manifest.test.ts` 新增兩個斷言——(1) PreToolUse matcher 必須覆蓋 `pre-tool-use.ts` 的 `MODIFYING_TOOLS` 每個成員（從原始碼 regex 提取，雙向防 drift）；(2) hook timeout（秒）×1000 必須大於 preflight fetch timeout 預設值（從原始碼提取）。

**行為變更聲明**：此修復會首次啟用「protected branch 擋編輯」與「behind-upstream 擋編輯」。每 session 只檢查一次（既有 marker 機制），fetch 失敗 fail-open（既有 `gitOutput` catch → null）。

### F2（issue #6）SubagentStop reminder 去重

`subagent-stop.ts` 的 coder/debugger reminder 注入前檢查 marker：`.arceus/sessions/<session_id>/reminders/<agent_id>`。存在 → `passThrough()`；不存在 → 建 marker（`mkdirSync recursive` + `writeFileSync`，自帶 try/catch，marker 失敗不阻擋 reminder）→ 注入。每個 agent_id 至多收到一次 reminder，循環最多多一輪即終止。`sessions/` 已在 `.arceus/.gitignore` 的 runtime state 清單內。

### F3（issue #7）keyword-detector 系統文字早退

`keyword-detector.ts` 的 `main()` 在 sanitize 之前檢查 `SYSTEM_TEXT_MARKERS = ["<task-notification>", "<local-command-caveat>", "<command-name>", "<persisted-output>"]`——prompt 含任一 marker 即 `passThrough()`。

- `<system-reminder>` **刻意不在清單內**：harness 會把 reminder 附加在真實使用者 prompt 上（混合內容），列入會讓正常關鍵字失效（Decision 4）
- 誤殺方向是安全的：使用者貼含 marker 的 log 時失去關鍵字偵測（可改寫重發），比錯誤注入 skill 好
- 附帶效益：slash command（`<command-name>`）不再被 hook 重複注入 skill（command 系統已注入過一次）

## 驗收條件

- [ ] **AC1**: hooks.json PreToolUse matcher 涵蓋 Bash/Edit/Write/MultiEdit/NotebookEdit；timeout 為 10
- [ ] **AC2**: `preflight.ts` fetch 預設 3000ms，`config.ts` JSDoc 同步
- [ ] **AC3**: matcher 覆蓋率 + timeout 一致性兩個靜態斷言存在且通過
- [ ] **AC4**: 同一 `agent_id` 第二次 SubagentStop 不再注入 reminder（unit test：首次注入 + 二次 passThrough + marker 檔存在）
- [ ] **AC5**: 非 arceus agent 與非 coder/debugger agent 行為不變（passThrough / 僅 logEvent）
- [ ] **AC6**: 含 `<task-notification>` 等 marker 的 prompt 不觸發任何 skill 注入；正常 prompt 觸發行為不變（control test）
- [ ] **AC7**: `npm run verify` 全綠
- [ ] **AC8**: CLAUDE.md 與架構文件反映三項行為（preflight 真實生效、reminder 一次性、系統文字跳過）

## 技術假設

- Claude Code hook matcher 支援 `|` regex 交替語法（官方 hooks 文件記載）
- SubagentStop 的 additionalContext 會回送給停止中的 subagent（issue #6 實錄三次重現）——去重 marker 不依賴此行為的修復，即使 Claude Code 改變路由也無害
- UserPromptSubmit 的 `prompt` 欄位包含 harness 產生的訊息文字（task notification 實錄）；`<system-reminder>` 可能與真實 prompt 混合
- 本 change 基於 propose/remove-vestigial-mcp-registration（stacked：keyword-detector.ts 與 PR #8、plugin-manifest.test.ts 與 PR #9 同檔）
