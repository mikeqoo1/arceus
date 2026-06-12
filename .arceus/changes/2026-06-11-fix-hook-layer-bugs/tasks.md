# Tasks — Fix hook layer bugs

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。_

## F1 — preflight matcher（#5）
- [x] T-1 hooks.json：PreToolUse matcher 改 `"Bash|Edit|Write|MultiEdit|NotebookEdit"`、timeout 3 → 10
- [x] T-2 preflight.ts：`fetchTimeoutMs ?? 10_000` → `3_000` + 兩處 JSDoc（preflight.ts / config.ts）
- [x] T-3 plugin-manifest.test.ts：新增 matcher 覆蓋率斷言 + timeout 一致性斷言

## F2 — reminder 去重（#6）
- [x] T-4 subagent-stop.ts：marker 路徑 helper + 注入前查 marker、注入時寫 marker（try/catch 包覆）
- [x] T-5 tests/unit/hooks/subagent-stop.test.ts：首次注入 / 二次 passThrough / 非 arceus passThrough / planner 不注入但 logEvent

## F3 — 系統文字早退（#7）
- [x] T-6 keyword-detector.ts：module-level `SYSTEM_TEXT_MARKERS` + main() 早退
- [x] T-7 tests/unit/hooks/keyword-detector-system-text.test.ts：task-notification 不觸發 / command-name 不觸發 / 正常 prompt 照常觸發（control）

## 收尾
- [x] T-8 CLAUDE.md / docs/architecture：hooks 描述同步（preflight 生效範圍、reminder 一次性、系統文字跳過）
- [x] T-9 npm run verify 全綠
