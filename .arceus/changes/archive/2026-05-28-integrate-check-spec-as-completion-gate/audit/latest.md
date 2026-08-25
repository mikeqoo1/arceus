<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: REQUEST_CHANGES
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)
> [!WARNING]
> [arceus] Audit report exceeds 7000 chars — this change may be too large; consider splitting via 'arceus change new'.
> Threshold: 7000 chars; this report: 16230 chars.

# Spec/Code Consistency Audit — 2026-05-28-integrate-check-spec-as-completion-gate

_Integrate check-spec as completion gate_

- **Verdict**: REQUEST_CHANGES
- **Model**: claude-opus-4-7
- **Base → Head**: origin/main (0ae6f27) → HEAD (47b94d9)
- **Files analyzed**: 28

## Summary

The implementation substantively delivers the check-spec completion gate: ChangeMeta extensions, audit path helpers, config schema, the integrations module with error classification, three-mode gate logic with zero-commit defense and force handling, the `change verify` CLI subcommand with all flags including the disabled branch, audit report persistence, the 7000-char oversize warning, `change status --force/--reason`, `change show` Audit block, init tip, error handling, apply skill Step 5.5, CLAUDE.md + architecture doc updates, and unit tests for gate + integration. However, three issues prevent approval: (1) AC14 (dogfood) explicitly fails — the committed audit/latest.md and meta.json show verdict=REQUEST_CHANGES with a 14503-char report against an outdated base/head pair (e479c7b vs current HEAD f1290f4), and T-25 is correctly left unchecked but the spec required APPROVE; (2) this PR bundles a sibling change's work (gitignore handling, planning artifacts for 2026-05-28-track-changes-folder-and-config-in-git) which is undocumented drift per Decision 9's 'one change one concern' principle; (3) AC11/AC12/AC17 have no automated CLI-level test coverage — implementer acknowledges they rely on manual smoke testing.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | Phase 1 — Types & state layer | T-1 在 `src/state/changes.ts` 的 `ChangeMeta` 介面新增 `verdict` / `verifiedSha` / `verifiedAt` / `verifiedBase` / `verificationModel` 五個 optional 欄位（含 JSDoc）— 也加了 `verificationBinaryVersion` 第六個欄位 | [x] | done | src/state/changes.ts:32-44 adds all six verdict-related fields with JSDoc |
| 2 | Phase 1 — Types & state layer | T-2 在 `src/state/changes.ts` 新增 `getAuditDir(arceusDir, id)` / `getAuditLatestPath(arceusDir, id)` 兩個 path helper — 也加了 `getForceOverridesLogPath` | [x] | done | src/state/changes.ts:97-107 — getAuditDir/getAuditLatestPath/getForceOverridesLogPath |
| 3 | Phase 1 — Types & state layer | T-3 在 `src/state/config.ts` 的 config schema 加 `checkSpec?: { enabled: boolean; binary: string; requireApprove: boolean }`，預設值 `{ enabled: true, binary: "check-spec", requireApprove: false }`（advisory 模式為預設） | [x] | done | src/state/config.ts:22-34 — checkSpec schema with correct defaults |
| 4 | Phase 1 — Types & state layer | T-4 新增 `src/integrations/check-spec.ts`：`runCheckSpec` + `findBinary` + `isReportOversize` + 錯誤分類（binary-not-found / missing-api-key / git-ref-not-found / parse-failed / binary-crash） | [x] | done | src/integrations/check-spec.ts (new, 274 lines) — runCheckSpec, findBinary, isReportOversize, error classification |
| 5 | Phase 1 — Types & state layer | T-5 修改 `updateChangeStatus()`：依 F3 表格實作三態 + zero-commit 防衛 + `--force` 處理 + force-overrides.log 寫入 | [x] | done | src/state/changes.ts enforceCompletionGate + resolveHeadSha + writeForceOverride implement three-state F3 table |
| 6 | Phase 2 — CLI surface | T-6 在 `src/cli.ts` 新增 `change verify <id>` 子命令含全部 flag，含 disabled 分支 | [x] | done | src/cli.ts change verify command with --base/--head/--format/--model/--no-save flags and disabled branch |
| 7 | Phase 2 — CLI surface | T-7 markdown 報告寫入 `audit/<ts>.md` + `audit/latest.md` + meta.json 寫回（透過 `recordVerification`）+ 報告開頭 metadata header | [x] | done | src/cli.ts persistReport + renderAuditHeader + recordVerification call |
| 8 | Phase 2 — CLI surface | T-8 7000 字警告：stderr 印 + audit 檔開頭插 `> [!WARNING]` 區塊；退出碼不變 | [x] | done | src/cli.ts OVERSIZE_WARNING_MESSAGE on stderr + renderAuditHeader > [!WARNING] block; threshold 7000 in check-spec.ts |
| 9 | Phase 2 — CLI surface | T-9 `change status` 加 `--force` flag + `--reason`：strict 跳過閘門 + 寫 log；advisory/disabled 印 no-op 訊息 | [x] | done | src/cli.ts change status command gains --force/--reason; routed to updateChangeStatus options |
| 10 | Phase 2 — CLI surface | T-10 `change show <id>` 加 Audit 區塊（verdict 存在時才印） | [x] | done | src/cli.ts:211-225 — Audit block printed only if c.verdict exists |
| 11 | Phase 2 — CLI surface | T-11 `arceus init` first-run tip：偵測 PATH（平台分支已抽到 `findBinary` 內），命中印 `✓ ... detected`、否則印安裝指引；upgrade 路徑也印 | [x] | done | src/cli.ts printCheckSpecTip uses findBinary; called from both init paths |
| 12 | Phase 3 — Error handling | T-12 binary 不存在：`findBinary` 預先 lookup + `errorKind: "binary-not-found"` + 安裝指引訊息 + exit code 2 | [x] | done | src/integrations/check-spec.ts findBinary + binary-not-found branch with install instructions |
| 13 | Phase 3 — Error handling | T-13 `ANTHROPIC_API_KEY`：從 check-spec stderr 偵測 + 安裝指引 + exit code 2 | [x] | done | src/integrations/check-spec.ts classifyError detects ANTHROPIC_API_KEY in stderr with actionable message |
| 14 | Phase 3 — Error handling | T-14 非 0/1 退出碼或 parse 失敗：`errorKind: "binary-crash" / "parse-failed"`，audit 檔保留原 stdout，CLI 印警告 | [x] | done | src/integrations/check-spec.ts binary-crash/parse-failed branches preserve stdout |
| 15 | Phase 4 — Skill / docs 更新 | T-15 `skills/apply/SKILL.md`：插入 Step 5.5 (Audit via check-spec)，含三種 verdict branching + 3 輪 re-verify + advisory/strict 模式差異 | [x] | done | skills/apply/SKILL.md adds Step 5.5 with verdict branching, 3-round limit, advisory/strict notes |
| 16 | Phase 4 — Skill / docs 更新 | T-16 `CLAUDE.md` "Evidence-Driven Verification"：補充兩層驗證設計 + 三態 gate 表格 + audit size heuristic + 報告儲存 | [x] | done | CLAUDE.md Evidence-Driven Verification section adds two-layer design, three-state table, audit-size heuristic |
| 17 | Phase 4 — Skill / docs 更新 | T-17 `docs/architecture/arceus-plugin-architecture.md`：加 9.1「外部稽核：check-spec 整合」段含資料流向 + 三態表 | [x] | done | docs/architecture/arceus-plugin-architecture.md section 9.1 with data-flow and three-state table |
| 18 | Phase 5 — Tests | T-18 `tests/unit/state/changes-gate.test.ts` 含 disabled / advisory / strict × {verdict 缺、verdict 非 APPROVE、SHA 不符、APPROVE 過} + zero-commit case + force-overrides.log 寫入 + recordVerification 持久化 | [x] | done | tests/unit/state/changes-gate.test.ts covers disabled/advisory/strict matrix + zero-commit + force log + recordVerification |
| 19 | Phase 5 — Tests | T-19 `tests/unit/integrations/check-spec.test.ts` 用 shell-script fake binary 測 happy path + REQUEST_CHANGES + binary-not-found + missing-api-key + git-error + crash + version-fail + oversize + findBinary + isReportOversize | [x] | done | tests/unit/integrations/check-spec.test.ts covers happy/REQUEST_CHANGES/binary-not-found/missing-api-key/git-error/crash/version-fail/oversize/findBinary/isReportOversize |
| 20 | Phase 5 — Tests | T-20 7000 字警告：fake binary `oversize` mode 觸發 + assert `isReportOversize(result.report) === true`（CLI 層的 stderr 警告由現有 e2e dogfood 證實） | [x] | partial | tests/unit/integrations/check-spec.test.ts |
|   |   |   |   | **notes** | isReportOversize unit-asserted on oversize result; CLI-layer stderr warning + audit WARNING block are not unit-tested — implementer explicitly defers to e2e dogfood |
| 21 | Phase 5 — Tests | T-21 init tip 測試：在 e2e CLI dogfood 中驗證（`node dist/cli.js init` 印出 detected 或 install tip）；本機 PATH 上有 check-spec，已實際觀察到 `✓ check-spec detected at ...` | [x] | partial | src/cli.ts printCheckSpecTip exists but no automated test in tests/ |
|   |   |   |   | **notes** | Task self-reports manual e2e observation only; no test asserts init tip output |
| 22 | Phase 5 — Tests | T-22 完整流程覆蓋：advisory 通過 + strict 通過 + strict 被擋（verdict）+ strict 被擋（SHA）+ strict force + advisory force no-op — 全部由 changes-gate.test.ts 涵蓋 | [x] | done | changes-gate.test.ts covers six scenarios (advisory pass, strict pass, blocked by verdict, blocked by SHA, strict force, advisory force no-op) |
| 23 | Phase 5 — Tests | T-23 disabled 分支已實作於 CLI verify 中（spec.md F4），unit test 在 changes-gate 的 disabled describe 中覆蓋；e2e 由 CLI 手動 smoke test 證實 | [x] | partial | src/cli.ts disabled branch exists; changes-gate.test.ts disabled describe covers gate side |
|   |   |   |   | **notes** | Disabled-verify CLI flow (stderr F4 message + skip meta write) has no automated test — relies on smoke test per task notes |
| 24 | Phase 5 — Tests | T-24 跑 `npm run verify`：typecheck + lint + 69 tests passed (6 files) + build 全綠 | [x] | done | Self-reported 69 tests passing; no contrary evidence in diff |
| 25 | Phase 6 — Self-verification (eat own dog food) | T-25 把這個 change 本身用新建好的 `arceus change verify` 跑一次，取得 APPROVE，且 audit 報告字數 < 7000 字後再 `change status completed`（AC14，最有意義的 demo）。若報告 ≥ 7000 字，**不**強行通過——回頭把本 change 拆分成多個小 change 再重做 | [ ] | missing | .arceus/changes/<id>/audit/latest.md committed in diff shows verdict=REQUEST_CHANGES, 14503 chars >7000 threshold |
|   |   |   |   | **notes** | Honestly unchecked. Per Decision 10, implementer explicitly chooses to ship in advisory mode and accept AC14 failure — but the spec literal still requires APPROVE + <7000 chars |

## Acceptance criteria (from spec.md)

- **PASS**: criterion 1 — **AC1**: 在乾淨的 sandbox 跑 `node dist/cli.js change verify <id>`（給定 mock binary 回傳 APPROVE JSON），meta.json 出現 `verdict: "APPROVE"` 且 `verifiedSha` 等於 `git rev-parse HEAD`
  - evidence: src/cli.ts verify command + recordVerification writes verdict + verifiedSha derived from git rev-parse HEAD
- **PASS**: criterion 2 — **AC2 (advisory, default)**: 在預設 config (`requireApprove: false`) 下，`change status <id> completed` 即使 verdict 缺失也成功，但 stderr 必須出現 F3 規定的 advisory 警告訊息
  - evidence: src/state/changes.ts advisory branch emits warning matching F3 wording, does not throw; covered by changes-gate.test.ts
- **PASS**: criterion 3 — **AC3 (strict, opt-in)**: 把 config 改成 `requireApprove: true` 後，verdict 缺失時 `change status completed` 失敗，error message 提到要先跑 verify
  - evidence: strict branch throws with message mentioning 'arceus change verify'; changes-gate.test.ts verdict-missing case
- **PASS**: criterion 4 — **AC4 (SHA freshness)**: strict 模式下，verdict 為 APPROVE 但 `verifiedSha` 與當前 HEAD 不符時（模擬 verify 後又 commit），status 轉移仍被擋下
  - evidence: strict branch checks verifiedSha === HEAD; changes-gate.test.ts 'SHA does not match HEAD' test
- **PASS**: criterion 5 — **AC5 (force)**: strict 模式下，`--force` 確實能跳過閘門，且 `audit/force-overrides.log` 有一筆紀錄
  - evidence: writeForceOverride appends to audit/force-overrides.log; changes-gate.test.ts asserts content (actor/reason)
- **PASS**: criterion 6 — **AC6 (disabled)**: `config.checkSpec.enabled = false` 時，整個閘門被旁路（不擋、也不寫 verdict 進 meta.json）
  - evidence: updateChangeStatus disabled branch returns early; cli.ts verify disabled branch skips recordVerification
- **PASS**: criterion 7 — **AC7 (errors)**: 缺 binary / 缺 API key 時，錯誤訊息符合「錯誤處理」段落規範，**不**出現 stack trace
  - evidence: src/integrations/check-spec.ts returns structured errorKind+errorMessage; cli.ts prints message and exits 2 without stack
- **PASS**: criterion 8 — **AC8 (show)**: `change show <id>` 在 verdict 存在時顯示 Audit 區塊
  - evidence: src/cli.ts:211-225 Audit block guarded by if (c.verdict)
- **PASS**: criterion 9 — **AC9 (skill)**: `skills/apply/SKILL.md` 中存在 Step 5.5，且 Step 6 仍維持原 `change status completed` 呼叫
  - evidence: skills/apply/SKILL.md Step 5.5 inserted; Step 6 retains npx arceus change status <id> completed
- **PASS**: criterion 10 — **AC10 (archive)**: 既有 `.arceus/changes/` 下尚未有 verdict 的 changes，能正常被 archive（archive 路徑不受閘門影響）
  - evidence: archiveChange unchanged; gate triggers only on status==='completed'
- **PARTIAL**: criterion 11 — **AC11 (size warning)**: 給定 mock binary 回傳一份 >7000 字的 markdown 報告，verify 完成後 stderr 出現 F1 規定的「change may be too large」警告，且 audit 檔開頭有 `> [!WARNING]` 區塊；退出碼**不**因警告而改變
  - evidence: src/cli.ts oversize stderr emit + renderAuditHeader WARNING block; check-spec.test.ts oversize test
  - notes: Only isReportOversize is unit-asserted. CLI-layer stderr warning emission + audit-file WARNING block have no end-to-end automated test
- **PARTIAL**: criterion 12 — **AC12 (init tip)**: `arceus init` 印出 F7 規定的 check-spec 安裝指引；當 PATH 上已有 check-spec 時改顯示 `✓ check-spec detected at <path>`
  - evidence: src/cli.ts printCheckSpecTip with findBinary detection
  - notes: Implementation present and matches F7 wording; no automated test asserts the output — implementer relies on manual observation
- **PASS**: criterion 13 — **AC13 (verify)**: `npm run verify` (typecheck + lint + test + build) 全綠
  - evidence: tasks.md self-report; no contrary evidence (build artifacts not in diff)
- **FAIL**: criterion 14 — **AC14 (dogfood)**: 本 change 自身在 apply 完成後，能跑過 `check-spec verify` 並取得 APPROVE（吃自己的狗食，且 audit 報告字數 < 7000 字——若超過，代表此 change 本身就違反自己訂的規矩，需要拆分）
  - evidence: meta.json verdict=REQUEST_CHANGES; audit/latest.md is 14503 chars >7000
  - notes: AC14 literally requires APPROVE + <7000 chars. Decision 10 explicitly waives this in advisory mode, but the acceptance criterion as written is not met. The committed audit was also run against an outdated HEAD (e479c7b vs current f1290f4) and was never re-run after the implementation commits
- **PASS**: criterion 15 — **AC15 (zero-commit)**: 在 zero-commit repo（`git init` 但無任何 commit）跑 strict 模式的 `change status <id> completed`，必須印 F3 規定的「Cannot resolve HEAD」訊息、退出碼 2，**不**拋出原始 git stderr stack
  - evidence: resolveHeadSha distinguishes zero-commit; gate throws 'Cannot resolve HEAD'; changes-gate.test.ts 'strict gate on zero-commit repo' test
- **PASS**: criterion 16 — **AC16 (force in advisory)**: advisory 模式下執行 `change status <id> completed --force` 必須印 F3 規定的「--force has no effect in advisory mode」訊息且**不**寫 force-overrides.log
  - evidence: changes-gate.test.ts advisory '--force has no effect' test + does NOT write force-overrides.log assertion
- **PARTIAL**: criterion 17 — **AC17 (disabled verify)**: `config.checkSpec.enabled = false` 下跑 `change verify <id>`，stderr 出現 F4 規定的「report saved but verdict not recorded」訊息，audit 檔有被建立，但 meta.json 的 verdict 欄位仍為 undefined
  - evidence: src/cli.ts disabled branch in change verify writes audit but skips recordVerification and prints F4 message
  - notes: Disabled-verify CLI behavior (stderr message + skip meta write) is not covered by an automated test; only the gate-side disabled branch is unit-tested
- **PASS**: criterion 18 — **AC18 (version recorded)**: audit 報告 metadata 開頭含 check-spec 版本字串；mock binary 的 `version` 子命令失敗時，版本欄位顯示 `unknown` 但 verify 流程不失敗
  - evidence: check-spec.test.ts version-fail returns binaryVersion='unknown'; renderAuditHeader emits binaryVersion line

## Drift findings

**Undocumented additions** (in diff, not in spec):

- Sibling change's gitignore work bundled in diff: root .gitignore changes, .arceus/.gitignore, .arceus/.gitkeep, ensureArceusGitignore in src/state/config.ts, CLAUDE.md 'which files commit' section, tests/unit/state/gitignore.test.ts
- Planning + meta artifacts for sibling change 2026-05-28-track-changes-folder-and-config-in-git/* committed in this diff
- Committed audit/ artifacts (audit/2026-05-28T*.md, audit/latest.md) transitively expose REQUEST_CHANGES verdict on this very change

**Missing from implementation** (in spec, not in diff):

- AC14 dogfood: no successful APPROVE + <7000-char audit produced; committed audit/latest.md shows REQUEST_CHANGES + 14503 chars
- Automated tests for CLI-layer 7000-char stderr warning (T-20 CLI assertion), init tip output (T-21), and disabled-verify CLI F4 message (T-23 CLI assertion) — implementer acknowledges manual smoke test only

## Open questions for human reviewer

- Decision 10 explicitly accepts shipping in advisory mode despite dogfood failure. Does the reviewer accept that AC14 is being intentionally waived, or should the dogfood be re-run against current HEAD (f1290f4 vs the audit's recorded e479c7b) before merge?
- Should the sibling gitignore change's contents (Decision 9 'one change one concern') be split into a separate PR/commit, or is bundling acceptable because this change depended on the gitignore fix to commit its own artifacts?
- Are the manual-only smoke tests for AC11/AC12/AC17 acceptable, or should automated CLI-layer assertions be added before merge?

