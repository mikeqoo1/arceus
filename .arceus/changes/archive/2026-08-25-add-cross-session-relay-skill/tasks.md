# Tasks — Add cross-session relay skill

- [x] 新增 `skills/cross-session/SKILL.md`
- [x] `src/hooks/keyword-detector.ts`：KEYWORDS 加 cross-session；SYSTEM_TEXT_MARKERS 加 `<cross-session-message`、`[Cross-session idle notice]`
- [x] `src/hooks/session-start.ts`：啟動關鍵字清單加一列
- [x] README.md / CLAUDE.md / docs/architecture 關鍵字表加一列；架構文件加 §5.7
- [x] `tests/unit/hooks/keyword-detector-system-text.test.ts`：加 4 個 case（含 informational「有啥/有什麼/哪些」不觸發）
- [x] `npm run verify` 全綠（165 tests / 16 files，2026-08-25）
- [ ] `arceus change verify` 取得 check-spec 判定 — **blocked**：check-spec 呼叫 Anthropic API 回 400 credit balance too low，帳號充值後重跑
