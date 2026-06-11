<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: APPROVE
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)

# Spec/Code Consistency Audit — 2026-06-11-fix-hook-layer-bugs

_Fix hook layer bugs_

- **Verdict**: APPROVE
- **Model**: claude-opus-4-7
- **Base → Head**: propose/remove-vestigial-mcp-registration (d84010e) → HEAD (75232fa)
- **Files analyzed**: 18

## Summary

All three hook-layer bugs are addressed: (1) hooks.json PreToolUse matcher expanded to Bash|Edit|Write|MultiEdit|NotebookEdit with timeout raised to 10s, and fetch default lowered to 3000ms with JSDoc synced; (2) subagent-stop.ts adds per-agent_id marker dedup with path sanitization and try/catch fail-open; (3) keyword-detector.ts adds SYSTEM_TEXT_MARKERS early-exit before sanitize. Static regression guards in plugin-manifest.test.ts verify matcher coverage of MODIFYING_TOOLS + Bash and timeout/fetch headroom. Unit tests cover all promised scenarios plus the adversarial-review additions (traversal id, fetch-attempt marker). Docs updated in CLAUDE.md and architecture doc.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | F1 — preflight matcher（#5） | T-1 hooks.json：PreToolUse matcher 改 `"Bash\|Edit\|Write\|MultiEdit\|NotebookEdit"`、timeout 3 → 10 | [x] | done | hooks/hooks.json:29,34 |
| 2 | F1 — preflight matcher（#5） | T-2 preflight.ts：`fetchTimeoutMs ?? 10_000` → `3_000` + 兩處 JSDoc（preflight.ts / config.ts） | [x] | done | src/state/preflight.ts:70, src/state/config.ts:65 |
| 3 | F1 — preflight matcher（#5） | T-3 plugin-manifest.test.ts：新增 matcher 覆蓋率斷言 + timeout 一致性斷言 | [x] | done | tests/unit/plugin-manifest.test.ts:69-130 |
| 4 | F2 — reminder 去重（#6） | T-4 subagent-stop.ts：marker 路徑 helper + 注入前查 marker、注入時寫 marker（try/catch 包覆） | [x] | done | src/hooks/subagent-stop.ts:50-74 |
| 5 | F2 — reminder 去重（#6） | T-5 tests/unit/hooks/subagent-stop.test.ts：首次注入 / 二次 passThrough / 非 arceus passThrough / planner 不注入但 logEvent | [x] | done | tests/unit/hooks/subagent-stop.test.ts (all six cases incl. planner logEvent-only) |
| 6 | F3 — 系統文字早退（#7） | T-6 keyword-detector.ts：module-level `SYSTEM_TEXT_MARKERS` + main() 早退 | [x] | done | src/hooks/keyword-detector.ts:72-83,149-154 |
| 7 | F3 — 系統文字早退（#7） | T-7 tests/unit/hooks/keyword-detector-system-text.test.ts：task-notification 不觸發 / command-name 不觸發 / 正常 prompt 照常觸發（control） | [x] | done | tests/unit/hooks/keyword-detector-system-text.test.ts (control + 4 markers) |
| 8 | 收尾 | T-8 CLAUDE.md / docs/architecture：hooks 描述同步（preflight 生效範圍、reminder 一次性、系統文字跳過） | [x] | done | CLAUDE.md:53-54,140, docs/architecture/arceus-plugin-architecture.md:88-92 |
| 9 | 收尾 | T-9 npm run verify 全綠 | [x] | done | cannot run verify from diff; tests added compile-consistently with existing modules — accepting self-report |
|   |   |   |   | **notes** | Verify pass is self-reported; no way to execute from diff. |

## Acceptance criteria (from spec.md)

- **PASS**: criterion 1 — **AC1**: hooks.json PreToolUse matcher 涵蓋 Bash/Edit/Write/MultiEdit/NotebookEdit；timeout 為 10
  - evidence: hooks/hooks.json:29 matcher and :34 timeout:10
- **PASS**: criterion 2 — **AC2**: `preflight.ts` fetch 預設 3000ms，`config.ts` JSDoc 同步
  - evidence: src/state/preflight.ts:70 (3_000) and config.ts:65 JSDoc
- **PASS**: criterion 3 — **AC3**: matcher 覆蓋率 + timeout 一致性兩個靜態斷言存在且通過
  - evidence: tests/unit/plugin-manifest.test.ts new describe block with two it() blocks
- **PASS**: criterion 4 — **AC4**: 同一 `agent_id` 第二次 SubagentStop 不再注入 reminder（unit test：首次注入 + 二次 passThrough + marker 檔存在）
  - evidence: tests/unit/hooks/subagent-stop.test.ts first/second-stop cases + marker existsSync check
- **PASS**: criterion 5 — **AC5**: 非 arceus agent 與非 coder/debugger agent 行為不變（passThrough / 僅 logEvent）
  - evidence: tests/unit/hooks/subagent-stop.test.ts non-arceus passThrough + planner logEvent-only cases
- **PASS**: criterion 6 — **AC6**: 含 `<task-notification>` 等 marker 的 prompt 不觸發任何 skill 注入；正常 prompt 觸發行為不變（control test）
  - evidence: tests/unit/hooks/keyword-detector-system-text.test.ts control test + 4 marker tests
- **PASS**: criterion 7 — **AC7**: `npm run verify` 全綠
  - evidence: self-reported T-9 done; cannot independently execute
- **PASS**: criterion 8 — **AC8**: CLAUDE.md 與架構文件反映三項行為（preflight 真實生效、reminder 一次性、系統文字跳過）
  - evidence: CLAUDE.md and docs/architecture/arceus-plugin-architecture.md edits cover all three behaviors

## Drift findings

**Undocumented additions** (in diff, not in spec):

- Added fetch-attempt marker (hasFetchAttempted/markFetchAttempted) in src/state/preflight.ts and src/hooks/pre-tool-use.ts — documented post-hoc in Decision 6 item 3
- Added safePathSegment() for traversal-safe agent_id encoding in src/hooks/subagent-stop.ts — documented in Decision 6 item 1
- Added try/catch around dedup logic so missing agent_id degrades to remind-anyway — documented in Decision 6 item 2
- New test file tests/unit/state/preflight-markers.test.ts for the fetch-attempt marker

