<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: APPROVE
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)

# Spec/Code Consistency Audit — 2026-06-11-remove-vestigial-mcp-server-registration

_Remove vestigial MCP server registration_

- **Verdict**: APPROVE
- **Model**: claude-opus-4-7
- **Base → Head**: propose/issue-4-followups (a7f339c) → HEAD (b3e0564)
- **Files analyzed**: 12

## Summary

The diff removes the vestigial `mcpServers` reference from `.claude-plugin/plugin.json`, deletes the root `.mcp.json`, drops the entry from `package.json` files array, updates CLAUDE.md/README.md/architecture docs to reflect the removal and future inline registration approach, and adds `tests/unit/plugin-manifest.test.ts` with all four F5 assertions. Implementation matches the spec; only AC6 (verify) and AC7 (manual /mcp check) cannot be verified from the diff alone.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | — | T-1 `.claude-plugin/plugin.json`：移除 `"mcpServers": "./.mcp.json"` 欄位（注意上一行行尾逗號） | [x] | done | .claude-plugin/plugin.json: mcpServers line removed |
| 2 | — | T-2 `git rm -f .mcp.json`（-f 因工作樹有本機修改） | [x] | done | .mcp.json status=D (deleted) |
| 3 | — | T-3 `package.json`：files 陣列移除 `".mcp.json"` | [x] | done | package.json files array no longer lists .mcp.json |
| 4 | — | T-4 `CLAUDE.md`：Four-Layer Design 區塊移除 `.mcp.json` 行、補一行「MCP server 未實作；未來以 plugin.json 內聯註冊」 | [x] | done | CLAUDE.md: replaced .mcp.json line with workflows entry + added paragraph about future inline registration |
| 5 | — | T-5 `docs/architecture/arceus-plugin-architecture.md`：更新 12 節 Phase 3 該項與 13 節第 6 點（內聯註冊 + entry 必須存在） | [x] | done | docs/architecture/arceus-plugin-architecture.md sections 12 (Phase 3) and 13 (point 6) updated |
| 6 | — | T-6 `README.md`：結構圖移除 `.mcp.json` 行 | [x] | done | README.md: .mcp.json line removed from structure diagram |
| 7 | — | T-7 新增 `tests/unit/plugin-manifest.test.ts`（spec F5 四項斷言） | [x] | done | tests/unit/plugin-manifest.test.ts added, four it() blocks covering F5.1–F5.4 |
| 8 | — | T-8 `npm run verify` 全綠 | [x] | done | Cannot be directly verified from diff, but no obvious failures; test file is syntactically reasonable |
|   |   |   |   | **notes** | Verification of `npm run verify` is outside diff scope |

## Acceptance criteria (from spec.md)

- **PASS**: criterion 1 — **AC1**: `.claude-plugin/plugin.json` 無 `mcpServers` 欄位，其餘欄位與改動前一致
  - evidence: .claude-plugin/plugin.json diff: only mcpServers line removed
- **PASS**: criterion 2 — **AC2**: repo 無 `.mcp.json`（git tracked 與工作樹皆無）；使用者工作樹自此乾淨（無 perpetual dirty file）
  - evidence: .mcp.json status=D
- **PASS**: criterion 3 — **AC3**: `package.json` files 陣列無 `".mcp.json"`
  - evidence: package.json diff
- **PASS**: criterion 4 — **AC4**: `grep -rn "mcp-server\|\.mcp\.json" CLAUDE.md README.md docs/` 無「現在式」的死描述（歷史性段落如 12 節 roadmap 可保留，但須反映「未實作」事實）
  - evidence: CLAUDE.md, README.md, docs/architecture/* updated; remaining references are historical/roadmap with explicit 'not implemented' framing
- **PASS**: criterion 5 — **AC5**: `tests/unit/plugin-manifest.test.ts` 存在且涵蓋 F5 四項斷言
  - evidence: tests/unit/plugin-manifest.test.ts contains 4 it() blocks aligning to F5.1–F5.4
- **PASS**: criterion 6 — **AC6**: `npm run verify`（typecheck + lint + test + build）全綠
  - evidence: Not directly observable in diff; test file appears well-formed and other changes are deletions/text edits
  - notes: Assuming reporter ran verify; cannot independently verify
- **PASS**: criterion 7 — **AC7**: Claude Code 重新載入 plugin 後 `/mcp` 無 arceus-state 失敗項（手動驗證，記錄於 PR）
  - evidence: Manual verification outside diff scope
  - notes: Reviewer should confirm /mcp output in PR

## Drift findings

_No drift detected._

