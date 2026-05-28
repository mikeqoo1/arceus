# Tasks — Integrate check-spec as completion gate

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。每一項都應該是可獨立驗證的最小步驟。_

## Phase 1 — Types & state layer

- [x] T-1 在 `src/state/changes.ts` 的 `ChangeMeta` 介面新增 `verdict` / `verifiedSha` / `verifiedAt` / `verifiedBase` / `verificationModel` 五個 optional 欄位（含 JSDoc）— 也加了 `verificationBinaryVersion` 第六個欄位
- [x] T-2 在 `src/state/changes.ts` 新增 `getAuditDir(arceusDir, id)` / `getAuditLatestPath(arceusDir, id)` 兩個 path helper — 也加了 `getForceOverridesLogPath`
- [x] T-3 在 `src/state/config.ts` 的 config schema 加 `checkSpec?: { enabled: boolean; binary: string; requireApprove: boolean }`，預設值 `{ enabled: true, binary: "check-spec", requireApprove: false }`（advisory 模式為預設）
- [x] T-4 新增 `src/integrations/check-spec.ts`：`runCheckSpec` + `findBinary` + `isReportOversize` + 錯誤分類（binary-not-found / missing-api-key / git-ref-not-found / parse-failed / binary-crash）
- [x] T-5 修改 `updateChangeStatus()`：依 F3 表格實作三態 + zero-commit 防衛 + `--force` 處理 + force-overrides.log 寫入

## Phase 2 — CLI surface

- [x] T-6 在 `src/cli.ts` 新增 `change verify <id>` 子命令含全部 flag，含 disabled 分支
- [x] T-7 markdown 報告寫入 `audit/<ts>.md` + `audit/latest.md` + meta.json 寫回（透過 `recordVerification`）+ 報告開頭 metadata header
- [x] T-8 7000 字警告：stderr 印 + audit 檔開頭插 `> [!WARNING]` 區塊；退出碼不變
- [x] T-9 `change status` 加 `--force` flag + `--reason`：strict 跳過閘門 + 寫 log；advisory/disabled 印 no-op 訊息
- [x] T-10 `change show <id>` 加 Audit 區塊（verdict 存在時才印）
- [x] T-11 `arceus init` first-run tip：偵測 PATH（平台分支已抽到 `findBinary` 內），命中印 `✓ ... detected`、否則印安裝指引；upgrade 路徑也印

## Phase 3 — Error handling

- [x] T-12 binary 不存在：`findBinary` 預先 lookup + `errorKind: "binary-not-found"` + 安裝指引訊息 + exit code 2
- [x] T-13 `ANTHROPIC_API_KEY`：從 check-spec stderr 偵測 + 安裝指引 + exit code 2
- [x] T-14 非 0/1 退出碼或 parse 失敗：`errorKind: "binary-crash" / "parse-failed"`，audit 檔保留原 stdout，CLI 印警告

## Phase 4 — Skill / docs 更新

- [x] T-15 `skills/apply/SKILL.md`：插入 Step 5.5 (Audit via check-spec)，含三種 verdict branching + 3 輪 re-verify + advisory/strict 模式差異
- [x] T-16 `CLAUDE.md` "Evidence-Driven Verification"：補充兩層驗證設計 + 三態 gate 表格 + audit size heuristic + 報告儲存
- [x] T-17 `docs/architecture/arceus-plugin-architecture.md`：加 9.1「外部稽核：check-spec 整合」段含資料流向 + 三態表

## Phase 5 — Tests

- [x] T-18 `tests/unit/state/changes-gate.test.ts` 含 disabled / advisory / strict × {verdict 缺、verdict 非 APPROVE、SHA 不符、APPROVE 過} + zero-commit case + force-overrides.log 寫入 + recordVerification 持久化
- [x] T-19 `tests/unit/integrations/check-spec.test.ts` 用 shell-script fake binary 測 happy path + REQUEST_CHANGES + binary-not-found + missing-api-key + git-error + crash + version-fail + oversize + findBinary + isReportOversize
- [x] T-20 7000 字警告：fake binary `oversize` mode 觸發 + assert `isReportOversize(result.report) === true`（CLI 層的 stderr 警告由現有 e2e dogfood 證實）
- [x] T-21 init tip 測試：在 e2e CLI dogfood 中驗證（`node dist/cli.js init` 印出 detected 或 install tip）；本機 PATH 上有 check-spec，已實際觀察到 `✓ check-spec detected at ...`
- [x] T-22 完整流程覆蓋：advisory 通過 + strict 通過 + strict 被擋（verdict）+ strict 被擋（SHA）+ strict force + advisory force no-op — 全部由 changes-gate.test.ts 涵蓋
- [x] T-23 disabled 分支已實作於 CLI verify 中（spec.md F4），unit test 在 changes-gate 的 disabled describe 中覆蓋；e2e 由 CLI 手動 smoke test 證實
- [x] T-24 跑 `npm run verify`：typecheck + lint + 69 tests passed (6 files) + build 全綠

## Phase 6 — Self-verification (eat own dog food)

> **依賴**：本階段必須在 T-1 ~ T-24 全部完成後才能執行。提早勾掉 T-25 等同 invalidating 整個 dogfood demo。

- [ ] T-25 把這個 change 本身用新建好的 `arceus change verify` 跑一次，取得 APPROVE，且 audit 報告字數 < 7000 字後再 `change status completed`（AC14，最有意義的 demo）。若報告 ≥ 7000 字，**不**強行通過——回頭把本 change 拆分成多個小 change 再重做
