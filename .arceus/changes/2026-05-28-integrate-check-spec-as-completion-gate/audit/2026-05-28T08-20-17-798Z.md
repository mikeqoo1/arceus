<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: REQUEST_CHANGES
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)
> [!WARNING]
> [arceus] Audit report exceeds 2000 chars — this change may be too large; consider splitting via 'arceus change new'.
> Threshold: 2000 chars; this report: unknown.

# Spec/Code Consistency Audit — 2026-05-28-integrate-check-spec-as-completion-gate

_Integrate check-spec as completion gate_

- **Verdict**: REQUEST_CHANGES
- **Model**: claude-opus-4-7
- **Base → Head**: origin/main (0ae6f27) → HEAD (e479c7b)
- **Files analyzed**: 18

## Summary

The diff only contains the change's planning artifacts (proposal.md, spec.md, tasks.md, decisions.md, meta.json) plus implementation work that belongs to a DIFFERENT change (2026-05-28-track-changes-folder-and-config-in-git — gitignore/ensureArceusGitignore). None of the 25 tasks for the check-spec completion gate change have been implemented: no ChangeMeta verdict fields, no src/integrations/check-spec.ts, no `change verify` CLI subcommand, no gate logic in updateChangeStatus, no Step 5.5 in apply skill, no init tip, no tests for any of this. tasks.md still has every checkbox unchecked, which honestly reflects the state, but the change is effectively unimplemented.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | Phase 1 — Types & state layer | T-1 在 `src/state/changes.ts` 的 `ChangeMeta` 介面新增 `verdict` / `verifiedSha` / `verifiedAt` / `verifiedBase` / `verificationModel` 五個 optional 欄位（含 JSDoc） | [ ] | missing | no diff to src/state/changes.ts |
| 2 | Phase 1 — Types & state layer | T-2 在 `src/state/changes.ts` 新增 `getAuditDir(arceusDir, id)` / `getAuditLatestPath(arceusDir, id)` 兩個 path helper，並更新 `ensureChangesDir` 在必要時建立 `audit/` 子目錄 | [ ] | missing | no diff to src/state/changes.ts (no getAuditDir/getAuditLatestPath) |
| 3 | Phase 1 — Types & state layer | T-3 在 `src/state/config.ts` 的 config schema 加 `checkSpec?: { enabled: boolean; binary: string; requireApprove: boolean }`，預設值 `{ enabled: true, binary: "check-spec", requireApprove: false }`（advisory 模式為預設） | [ ] | missing | src/state/config.ts diff only adds ensureArceusGitignore; no checkSpec schema |
| 4 | Phase 1 — Types & state layer | T-4 **新增 `src/integrations/check-spec.ts`**（**注意：不是 `src/state/`**——`src/state/` 是純檔案 I/O 模組，外部 process spawn 屬於整合，應建立新的 `src/integrations/` 資料夾。詳 Decision 9）：匯出 `runCheckSpec(arceusDir, id, opts)` 函式，包 `child_process.spawnSync`、先跑 `<binary> version` 取版本、再跑 verify、解析 JSON、回傳 `{ verdict, reportMarkdown, reportJson, stderr, exitCode, binaryVersion }` | [ ] | missing | src/integrations/check-spec.ts not present in diff |
| 5 | Phase 1 — Types & state layer | T-5 修改 `updateChangeStatus()`：依 F3 表格實作三態（disabled / advisory / strict）。Advisory 印警告但不擋；strict 檢查 `verdict === "APPROVE"` 且 `verifiedSha === git rev-parse HEAD`，否則 throw。**Zero-commit 防衛**：先用 try/catch 包 `git rev-parse HEAD`，失敗時印 F3 規定的「Cannot resolve HEAD」訊息、退出碼 2，不重新拋出 git stderr | [ ] | missing | no diff modifies updateChangeStatus |
| 6 | Phase 2 — CLI surface | T-6 在 `src/cli.ts` 新增 `change verify <id>` 子命令，支援 `--base`、`--head`、`--format`、`--save`、`--model` 五個 flag；預設 `--save` 為 true、`--base origin/main`、`--head HEAD`、`--format markdown`。**Disabled 分支**：`config.checkSpec.enabled === false` 時仍 spawn binary + 寫 audit 檔，但跳過寫 meta.json 並印 F4 規定的訊息 | [ ] | missing | src/cli.ts diff only adds ensureArceusGitignore call; no `change verify` subcommand |
| 7 | Phase 2 — CLI surface | T-7 `change verify` 跑完後（且非 disabled 模式）：把 markdown 報告寫入 `.arceus/changes/<id>/audit/<ISO timestamp>.md`、更新 `audit/latest.md`、把 verdict/SHA/timestamp/binaryVersion 寫回 `meta.json`。Audit 報告開頭插入 metadata 區塊（含 verdict、SHA、base、head、model、check-spec 版本、時間戳） | [ ] | missing | no audit/ report writing logic added |
| 8 | Phase 2 — CLI surface | T-8 **2000 字警告**：`change verify` 在報告字數 > 2000 時印警告到 stderr（spec F1 訊息），並在 audit 檔開頭插入 `> [!WARNING]` 區塊。警告不改變退出碼 | [ ] | missing | no 2000-char warning code |
| 9 | Phase 2 — CLI surface | T-9 在既有 `change status <id> <status>` 子命令加 `--force` flag，依模式分支處理（spec F3）： | [ ] | missing | no --force flag added to `change status` |
| 10 | Phase 2 — CLI surface | T-10 在 `change show <id>` 輸出加 Audit 區塊（spec F6 段落格式），verdict 不存在時不印該區塊 | [ ] | missing | no Audit block added to `change show` |
| 11 | Phase 2 — CLI surface | T-11 **`arceus init` first-run tip**：在 `src/cli.ts` 的 `init` 子命令尾端加 check-spec 安裝指引輸出（spec F7）；偵測方式依平台分支——`process.platform === "win32"` 用 `where check-spec`、其他平台用 `which check-spec`。已安裝改顯示 `✓ check-spec detected at <path>`。資料夾已存在的 skip 分支也要印 | [ ] | missing | src/cli.ts init only prints existing message; no check-spec install tip |
| 12 | Phase 3 — Error handling | T-12 binary 不存在時：catch ENOENT，印 spec 規定的安裝指引訊息，退出碼 2 | [ ] | missing | no ENOENT handling for check-spec binary |
| 13 | Phase 3 — Error handling | T-13 `ANTHROPIC_API_KEY` 未設（從 stderr 偵測或預先檢查 env）：印關閉 gate 的指引訊息，退出碼 2 | [ ] | missing | no API key error handling |
| 14 | Phase 3 — Error handling | T-14 check-spec 回傳非 0/1/2 退出碼，或 JSON parse 失敗：把 stdout 全文存進 audit 檔，verdict 標 `NEEDS_DISCUSSION`，印警告 | [ ] | missing | no JSON parse fallback logic |
| 15 | Phase 4 — Skill / docs 更新 | T-15 編輯 `skills/apply/SKILL.md`：在 Step 5 (Review) 與 Step 6 (Complete) 之間插入 Step 5.5 (Audit via check-spec)，含 verdict 三種狀態的 branching + 最多 3 輪 re-verify。明示 advisory / strict 兩種模式下 Step 5.5 的行為差異 | [ ] | missing | skills/apply/SKILL.md not in diff |
| 16 | Phase 4 — Skill / docs 更新 | T-16 編輯 `CLAUDE.md` 的 "Evidence-Driven Verification" 區塊：補充 check-spec gate（advisory 預設、strict opt-in、SHA freshness、force escape hatch、2000 字警告） | [ ] | missing | CLAUDE.md diff only adds 'which files commit' section (from sibling change); no check-spec gate documentation |
| 17 | Phase 4 — Skill / docs 更新 | T-17 編輯 `docs/architecture/arceus-plugin-architecture.md`：在四層架構說明後加一節「External Auditor (check-spec)」，畫出資料流向（Arceus → spawn → check-spec → JSON → meta.json + audit/） | [ ] | missing | docs/architecture/arceus-plugin-architecture.md not in diff |
| 18 | Phase 5 — Tests | T-18 `src/state/changes.test.ts`（或新增）：測試 `updateChangeStatus` 三態 gate 行為（disabled / advisory / strict × {verdict 缺、verdict 非 APPROVE、SHA 不符、APPROVE 過}），共 ~8 個 case。加 **zero-commit repo** case：mock `git rev-parse HEAD` 失敗，斷言 strict 模式回傳明確錯誤訊息 + exit code 2，**不**拋 git stack trace | [ ] | missing | no changes.test.ts updates |
| 19 | Phase 5 — Tests | T-19 `src/integrations/check-spec.test.ts`：用 fake binary（一個 shell script 印固定 JSON 回 stdout）測 `runCheckSpec` 的 happy path + ENOENT + non-zero exit + JSON parse 失敗 + `version` 子命令失敗 (binaryVersion = "unknown") | [ ] | missing | no src/integrations/check-spec.test.ts |
| 20 | Phase 5 — Tests | T-20 2000 字警告測試：mock binary 回傳 >2000 字報告，斷言 stderr 有警告字串且 audit 檔開頭有 `> [!WARNING]` | [ ] | missing | no 2000-char warning test |
| 21 | Phase 5 — Tests | T-21 `init` tip 測試：呼叫 `arceus init` stub stdout，斷言含 check-spec 安裝指引；`which check-spec` (或 Windows 的 `where`) 有命中時改顯示 `✓ ... detected` | [ ] | missing | no init tip test |
| 22 | Phase 5 — Tests | T-22 CLI integration test：完整流程 `change verify` → `change status completed`，覆蓋六種情境： | [ ] | missing | no CLI integration test covering 6 scenarios |
| 23 | Phase 5 — Tests | T-23 `disabled` 模式測試（AC17）：`enabled: false` 下跑 verify，斷言 audit 檔有建、meta.json verdict 仍 undefined、stderr 印 F4 訊息 | [ ] | missing | no disabled-mode verify test |
| 24 | Phase 5 — Tests | T-24 跑 `npm run verify`（typecheck + lint + test + build），所有步驟綠燈 | [ ] | missing | cannot verify; nothing built to test |
| 25 | Phase 6 — Self-verification (eat own dog food) | T-25 把這個 change 本身用新建好的 `arceus change verify` 跑一次，取得 APPROVE，且 audit 報告字數 < 2000 字後再 `change status completed`（AC14，最有意義的 demo）。若報告 ≥ 2000 字，**不**強行通過——回頭把本 change 拆分成多個小 change 再重做 | [ ] | missing | self-verification requires T-1..T-24 to be done |

## Acceptance criteria (from spec.md)

- **FAIL**: criterion 1 — **AC1**: 在乾淨的 sandbox 跑 `node dist/cli.js change verify <id>`（給定 mock binary 回傳 APPROVE JSON），meta.json 出現 `verdict: "APPROVE"` 且 `verifiedSha` 等於 `git rev-parse HEAD`
  - evidence: no `change verify` CLI exists
- **FAIL**: criterion 2 — **AC2 (advisory, default)**: 在預設 config (`requireApprove: false`) 下，`change status <id> completed` 即使 verdict 缺失也成功，但 stderr 必須出現 F3 規定的 advisory 警告訊息
  - evidence: advisory gate not implemented in updateChangeStatus
- **FAIL**: criterion 3 — **AC3 (strict, opt-in)**: 把 config 改成 `requireApprove: true` 後，verdict 缺失時 `change status completed` 失敗，error message 提到要先跑 verify
  - evidence: strict gate not implemented
- **FAIL**: criterion 4 — **AC4 (SHA freshness)**: strict 模式下，verdict 為 APPROVE 但 `verifiedSha` 與當前 HEAD 不符時（模擬 verify 後又 commit），status 轉移仍被擋下
  - evidence: SHA freshness check not implemented
- **FAIL**: criterion 5 — **AC5 (force)**: strict 模式下，`--force` 確實能跳過閘門，且 `audit/force-overrides.log` 有一筆紀錄
  - evidence: --force flag not added
- **FAIL**: criterion 6 — **AC6 (disabled)**: `config.checkSpec.enabled = false` 時，整個閘門被旁路（不擋、也不寫 verdict 進 meta.json）
  - evidence: disabled bypass not implemented (no gate code at all)
- **FAIL**: criterion 7 — **AC7 (errors)**: 缺 binary / 缺 API key 時，錯誤訊息符合「錯誤處理」段落規範，**不**出現 stack trace
  - evidence: no error handling code added
- **FAIL**: criterion 8 — **AC8 (show)**: `change show <id>` 在 verdict 存在時顯示 Audit 區塊
  - evidence: `change show` Audit block not added
- **FAIL**: criterion 9 — **AC9 (skill)**: `skills/apply/SKILL.md` 中存在 Step 5.5，且 Step 6 仍維持原 `change status completed` 呼叫
  - evidence: skills/apply/SKILL.md untouched
- **PASS**: criterion 10 — **AC10 (archive)**: 既有 `.arceus/changes/` 下尚未有 verdict 的 changes，能正常被 archive（archive 路徑不受閘門影響）
  - evidence: archive path unaffected — but trivially so because no gate was implemented
- **FAIL**: criterion 11 — **AC11 (size warning)**: 給定 mock binary 回傳一份 >2000 字的 markdown 報告，verify 完成後 stderr 出現 F1 規定的「change may be too large」警告，且 audit 檔開頭有 `> [!WARNING]` 區塊；退出碼**不**因警告而改變
  - evidence: no size warning code
- **FAIL**: criterion 12 — **AC12 (init tip)**: `arceus init` 印出 F7 規定的 check-spec 安裝指引；當 PATH 上已有 check-spec 時改顯示 `✓ check-spec detected at <path>`
  - evidence: src/cli.ts init has no check-spec tip
- **FAIL**: criterion 13 — **AC13 (verify)**: `npm run verify` (typecheck + lint + test + build) 全綠
  - evidence: cannot evaluate; expected new tests/code don't exist, so verify cannot demonstrate the feature works
- **FAIL**: criterion 14 — **AC14 (dogfood)**: 本 change 自身在 apply 完成後，能跑過 `check-spec verify` 並取得 APPROVE（吃自己的狗食，且 audit 報告字數 < 2000 字——若超過，代表此 change 本身就違反自己訂的規矩，需要拆分）
  - evidence: dogfood not possible without implementation
- **FAIL**: criterion 15 — **AC15 (zero-commit)**: 在 zero-commit repo（`git init` 但無任何 commit）跑 strict 模式的 `change status <id> completed`，必須印 F3 規定的「Cannot resolve HEAD」訊息、退出碼 2，**不**拋出原始 git stderr stack
  - evidence: zero-commit handling not present
- **FAIL**: criterion 16 — **AC16 (force in advisory)**: advisory 模式下執行 `change status <id> completed --force` 必須印 F3 規定的「--force has no effect in advisory mode」訊息且**不**寫 force-overrides.log
  - evidence: advisory --force no-op not implemented
- **FAIL**: criterion 17 — **AC17 (disabled verify)**: `config.checkSpec.enabled = false` 下跑 `change verify <id>`，stderr 出現 F4 規定的「report saved but verdict not recorded」訊息，audit 檔有被建立，但 meta.json 的 verdict 欄位仍為 undefined
  - evidence: disabled-mode verify message not implemented
- **FAIL**: criterion 18 — **AC18 (version recorded)**: audit 報告 metadata 開頭含 check-spec 版本字串；mock binary 的 `version` 子命令失敗時，版本欄位顯示 `unknown` 但 verify 流程不失敗
  - evidence: version recording not implemented

## Drift findings

**Undocumented additions** (in diff, not in spec):

- All gitignore-related work (.gitignore, .arceus/.gitignore, .arceus/.gitkeep, ensureArceusGitignore in src/state/config.ts, CLAUDE.md 'which files commit' section, tests/unit/state/gitignore.test.ts, src/cli.ts init wiring) belongs to the sibling change '2026-05-28-track-changes-folder-and-config-in-git', not to this change
- Planning artifacts for the sibling change are also included in this diff (.arceus/changes/2026-05-28-track-changes-folder-and-config-in-git/*)

**Missing from implementation** (in spec, not in diff):

- Entire implementation of the check-spec completion gate: CLI verify subcommand, integrations module, ChangeMeta extension, config schema, gate logic, --force flag, change show Audit block, init tip, error handling, skill/docs updates, all tests

## Open questions for human reviewer

- Was this diff intended to be the implementation of the check-spec gate change, or is it just a commit of the planning artifacts plus the prerequisite gitignore fix? The diff base→head appears to capture only the planning + a sibling change's work, with zero progress on T-1..T-25 of this change.

