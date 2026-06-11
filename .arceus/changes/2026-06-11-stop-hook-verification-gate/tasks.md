# Tasks — Stop hook verification gate

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。每一項都應該是可獨立驗證的最小步驟。_

## Phase 0 — Instrumentation spike（風險排除）

- [x] T-1 **驗證 subagent PostToolUse 假設**（零改碼 probe 完成：假設成立 + 實證 tool_response 為 object，見 decisions.md Decision 11）：在 `src/hooks/post-tool-use.ts` 的 `main()` 開頭加一行暫時性的 `logEvent(...)` 記錄 `{ event: "debug_hook_fire", data: { tool: input.tool_name, agent_id: input.agent_id, agent_type: input.agent_type, session_id: input.session_id } }`。手動用 `arceus:tester` subagent 跑一次 `npm run test`，然後讀 session log 確認 subagent 的 tool call 是否出現在同一 session log。記錄結果到 `decisions.md` Decision 6。spike code 必須在確認後移除（T-6 的 cleanup 步驟）
  - **驗證方式**：讀 `.arceus/sessions/<id>/log.jsonl` 確認有 `agent_type` 含 `arceus:tester` 的 `debug_hook_fire` 事件
  - **若假設錯誤**：gate predicate 只看主 agent 的 verification_run，並在 decisions.md 記錄替代方案

## Phase 1 — PostToolUse 結構化事件（stop gate 的資料來源）

- [x] T-2 在 `src/hooks/post-tool-use.ts` 將 `significantTools`（line 14）從 `["Bash", "Edit", "Write", "Agent"]` 改為 `["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "Agent"]`
  - **驗證方式**：`grep -c "MultiEdit" src/hooks/post-tool-use.ts` 回傳 1+

- [x] T-3 在 `src/hooks/post-tool-use.ts` 修改 `truncate()` 函式（line 30-32）：改為 `function truncate(value: unknown, max: number): string`，內部加 `typeof value === "string"` guard，非 string 時先 `JSON.stringify(value ?? "")`。同時更新呼叫處 `truncate(input.tool_response, 500)` 和 `truncate(JSON.stringify(input.tool_input), 500)` 確保型別相容
  - **驗證方式**：`npm run typecheck` 通過

- [x] T-4 在 `src/hooks/post-tool-use.ts` 新增 `classifyCodeEdit()` 本地函式：當 `tool_name` 為 `Edit`/`Write`/`MultiEdit`/`NotebookEdit` 之一時，提取 `file_path` 並 `logEvent({ event: "code_edit", data: { tool, file_path } })`。file_path 提取邏輯：`Edit`/`Write` → `input.tool_input.file_path`；`MultiEdit` → `input.tool_input.file_path` fallback 到 `(input.tool_input.edits as any)?.[0]?.file_path`；`NotebookEdit` → `input.tool_input.notebook_path`；所有 fallback → `"unknown"`。函式自帶 try/catch，失敗不影響 passThrough
  - **驗證方式**：unit test（T-11）

- [x] T-5 在 `src/hooks/post-tool-use.ts` 新增 `classifyVerificationRun()` 本地函式：當 `tool_name === "Bash"` 時，用 regex 匹配 `tool_input.command` 識別 verification kind（typecheck/lint/test/build/verify/unknown），再用 failure-marker heuristic 判定 `ok`，log `{ event: "verification_run", data: { kind, command: truncate(command, 200), ok } }`。只在匹配到 verification pattern 時才 log 此事件。函式自帶 try/catch
  - **驗證方式**：unit test（T-11）

- [x] T-6 在 `main()` 中，於既有 `logEvent("tool_use")` 呼叫之後（line 16-24 後）、`passThrough()` 之前（line 27 前），依序呼叫 `classifyCodeEdit(arceusDir, input)` 和 `classifyVerificationRun(arceusDir, input)`。同時移除 T-1 spike debug code（若 T-1 已完成）
  - **驗證方式**：`npm run typecheck` 通過；inspect code 確認 main() 流程正確

## Phase 2 — Types 與 config

- [x] T-7 在 `src/hooks/types.ts` 的 `StopInput` interface（line 51-53）新增 `stop_hook_active?: boolean` 欄位（含 JSDoc 說明 loop protection 用途）
  - **驗證方式**：`npm run typecheck` 通過

- [x] T-8 在 `src/state/config.ts` 的 `ArceusProjectConfig` interface（line 8-48）新增 `stopGate?: { enabled?: boolean; requireVerify?: boolean; excludedPaths?: string[] }` 區塊（含 JSDoc，命名與 `checkSpec.requireApprove` 的 `require + 動詞` 風格一致）
  - **驗證方式**：`npm run typecheck` 通過

## Phase 3 — Stop gate 核心邏輯

- [x] T-9 新增 `src/hooks/stop-gate.ts`：export `StopGateConfig` / `StopGateInput` / `StopGateResult` interface 以及 `evaluateStopGate()` 純函式和 `isExcludedPath()` helper。實作 spec F2 的完整 predicate 邏輯：disabled → loop protection → collect/filter code_edit → find lastEditIndex → find ok verification_run after → block/warn/pass。`isExcludedPath` 使用前綴/後綴字串比對（F6），不引入 glob library
  - **驗證方式**：unit test（T-12）

- [x] T-10 重寫 `src/hooks/stop.ts`：在 `logEvent("session_stop")` 之後加入 gate 邏輯——(1) 讀 config + enabled check (2) readSessionLog wrapped in try/catch (3) 建構 StopGateConfig 填入預設值 (4) 呼叫 evaluateStopGate (5) 依 action 分流 output。整個 gate 區塊包在 try/catch（fail-open），catch 印 stderr warning + passThrough。loop protection 時附帶 systemMessage（F7）
  - **驗證方式**：unit test（T-12）；`npm run typecheck` 通過

## Phase 4 — Tests

- [x] T-11 新增 `tests/unit/hooks/post-tool-use.test.ts`：測試 (a) Edit tool → code_edit 事件含正確 file_path (b) Write tool → code_edit 事件 (c) MultiEdit → code_edit 事件 (d) NotebookEdit → code_edit 事件含 notebook_path (e) file_path 缺失 → fallback "unknown" (f) Bash + `npm run test` 無 failure marker → verification_run ok=true, kind="test" (g) Bash + `npm run test` 含 FAIL → ok=false (h) Bash + `npm run verify` → kind="verify" (i) non-verification Bash（如 `ls`）→ 不產出 verification_run (j) tool_response 為 object 時不產生損壞 data (k) significantTools 包含 MultiEdit/NotebookEdit。使用 vitest mock `logEvent`
  - **驗證方式**：`npm run test -- tests/unit/hooks/post-tool-use.test.ts` 全綠

- [x] T-12 新增 `tests/unit/hooks/stop-gate.test.ts`：測試 `evaluateStopGate` 純函式 + `isExcludedPath` helper——(a) 無 code_edit → pass (b) 有 code_edit 無 verification_run + advisory → action="warn" (c) 同上 + strict → action="block" (d) code_edit 後接 verification_run ok=true → pass (e) code_edit 後接 verification_run ok=false → 視為未驗證 (f) stopHookActive=true → pass (g) enabled=false → pass (h) excludedPaths 排除 .arceus/ 前綴 → pass (i) excludedPaths 排除 *.md 後綴 → pass (j) file_path="unknown" 不被排除 (k) editedFiles 列表正確 (l) 多個 code_edit 中最晚一個的 index 決定 gate (m) `isExcludedPath` edge cases（空 patterns、exact match）。另外測試 `stop.ts` 整合：mock readStdin + readSessionLog + readConfig，驗證 (n) fail-open（corrupt log → passThrough + stderr）(o) loop protection passThrough 附帶 systemMessage
  - **驗證方式**：`npm run test -- tests/unit/hooks/stop-gate.test.ts` 全綠

## Phase 5 — Docs 更新

- [x] T-13 更新 `CLAUDE.md`：在「Evidence-Driven Verification」段落新增 Stop hook gate 說明——三態表格（disabled/advisory/strict）、config keys（`stopGate.enabled` / `stopGate.requireVerify` / `stopGate.excludedPaths`）、與 subagent-stop reminder + checkSpec completion gate 的三層互補關係。更新 PostToolUse hook 行為描述（補上 MultiEdit/NotebookEdit 以及新的 code_edit/verification_run 事件）。繁體中文
  - **驗證方式**：inspect CLAUDE.md 含 `stopGate` 相關段落

- [x] T-14 更新 `docs/architecture/arceus-plugin-architecture.md`：在 hooks 段落加 Stop hook gate 說明，含事件流（PostToolUse log code_edit/verification_run → Stop hook 讀取 session log → evaluateStopGate → block/warn/pass）。繁體中文
  - **驗證方式**：inspect 檔案含 stop gate 事件流描述

## Phase 6 — Final verification

- [x] T-15 跑 `npm run verify`（typecheck + lint + test + build）全綠
  - **驗證方式**：exit code 0，0 errors
