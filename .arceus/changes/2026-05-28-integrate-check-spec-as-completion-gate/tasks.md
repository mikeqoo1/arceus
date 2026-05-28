# Tasks — Integrate check-spec as completion gate

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。每一項都應該是可獨立驗證的最小步驟。_

## Phase 1 — Types & state layer

- [ ] T-1 在 `src/state/changes.ts` 的 `ChangeMeta` 介面新增 `verdict` / `verifiedSha` / `verifiedAt` / `verifiedBase` / `verificationModel` 五個 optional 欄位（含 JSDoc）
- [ ] T-2 在 `src/state/changes.ts` 新增 `getAuditDir(arceusDir, id)` / `getAuditLatestPath(arceusDir, id)` 兩個 path helper，並更新 `ensureChangesDir` 在必要時建立 `audit/` 子目錄
- [ ] T-3 在 `src/state/config.ts` 的 config schema 加 `checkSpec?: { enabled: boolean; binary: string; requireApprove: boolean }`，預設值 `{ enabled: true, binary: "check-spec", requireApprove: false }`（advisory 模式為預設）
- [ ] T-4 **新增 `src/integrations/check-spec.ts`**（**注意：不是 `src/state/`**——`src/state/` 是純檔案 I/O 模組，外部 process spawn 屬於整合，應建立新的 `src/integrations/` 資料夾。詳 Decision 9）：匯出 `runCheckSpec(arceusDir, id, opts)` 函式，包 `child_process.spawnSync`、先跑 `<binary> version` 取版本、再跑 verify、解析 JSON、回傳 `{ verdict, reportMarkdown, reportJson, stderr, exitCode, binaryVersion }`
- [ ] T-5 修改 `updateChangeStatus()`：依 F3 表格實作三態（disabled / advisory / strict）。Advisory 印警告但不擋；strict 檢查 `verdict === "APPROVE"` 且 `verifiedSha === git rev-parse HEAD`，否則 throw。**Zero-commit 防衛**：先用 try/catch 包 `git rev-parse HEAD`，失敗時印 F3 規定的「Cannot resolve HEAD」訊息、退出碼 2，不重新拋出 git stderr

## Phase 2 — CLI surface

- [ ] T-6 在 `src/cli.ts` 新增 `change verify <id>` 子命令，支援 `--base`、`--head`、`--format`、`--save`、`--model` 五個 flag；預設 `--save` 為 true、`--base origin/main`、`--head HEAD`、`--format markdown`。**Disabled 分支**：`config.checkSpec.enabled === false` 時仍 spawn binary + 寫 audit 檔，但跳過寫 meta.json 並印 F4 規定的訊息
- [ ] T-7 `change verify` 跑完後（且非 disabled 模式）：把 markdown 報告寫入 `.arceus/changes/<id>/audit/<ISO timestamp>.md`、更新 `audit/latest.md`、把 verdict/SHA/timestamp/binaryVersion 寫回 `meta.json`。Audit 報告開頭插入 metadata 區塊（含 verdict、SHA、base、head、model、check-spec 版本、時間戳）
- [ ] T-8 **2000 字警告**：`change verify` 在報告字數 > 2000 時印警告到 stderr（spec F1 訊息），並在 audit 檔開頭插入 `> [!WARNING]` 區塊。警告不改變退出碼
- [ ] T-9 在既有 `change status <id> <status>` 子命令加 `--force` flag，依模式分支處理（spec F3）：
  - Strict 模式：跳過閘門 + 寫 `force-overrides.log`
  - Advisory 模式：印 `[arceus] --force has no effect in advisory mode; gate is already non-blocking.` 並當作沒帶 flag
  - Disabled 模式：同 advisory
- [ ] T-10 在 `change show <id>` 輸出加 Audit 區塊（spec F6 段落格式），verdict 不存在時不印該區塊
- [ ] T-11 **`arceus init` first-run tip**：在 `src/cli.ts` 的 `init` 子命令尾端加 check-spec 安裝指引輸出（spec F7）；偵測方式依平台分支——`process.platform === "win32"` 用 `where check-spec`、其他平台用 `which check-spec`。已安裝改顯示 `✓ check-spec detected at <path>`。資料夾已存在的 skip 分支也要印

## Phase 3 — Error handling

- [ ] T-12 binary 不存在時：catch ENOENT，印 spec 規定的安裝指引訊息，退出碼 2
- [ ] T-13 `ANTHROPIC_API_KEY` 未設（從 stderr 偵測或預先檢查 env）：印關閉 gate 的指引訊息，退出碼 2
- [ ] T-14 check-spec 回傳非 0/1/2 退出碼，或 JSON parse 失敗：把 stdout 全文存進 audit 檔，verdict 標 `NEEDS_DISCUSSION`，印警告

## Phase 4 — Skill / docs 更新

- [ ] T-15 編輯 `skills/apply/SKILL.md`：在 Step 5 (Review) 與 Step 6 (Complete) 之間插入 Step 5.5 (Audit via check-spec)，含 verdict 三種狀態的 branching + 最多 3 輪 re-verify。明示 advisory / strict 兩種模式下 Step 5.5 的行為差異
- [ ] T-16 編輯 `CLAUDE.md` 的 "Evidence-Driven Verification" 區塊：補充 check-spec gate（advisory 預設、strict opt-in、SHA freshness、force escape hatch、2000 字警告）
- [ ] T-17 編輯 `docs/architecture/arceus-plugin-architecture.md`：在四層架構說明後加一節「External Auditor (check-spec)」，畫出資料流向（Arceus → spawn → check-spec → JSON → meta.json + audit/）

## Phase 5 — Tests

- [ ] T-18 `src/state/changes.test.ts`（或新增）：測試 `updateChangeStatus` 三態 gate 行為（disabled / advisory / strict × {verdict 缺、verdict 非 APPROVE、SHA 不符、APPROVE 過}），共 ~8 個 case。加 **zero-commit repo** case：mock `git rev-parse HEAD` 失敗，斷言 strict 模式回傳明確錯誤訊息 + exit code 2，**不**拋 git stack trace
- [ ] T-19 `src/integrations/check-spec.test.ts`：用 fake binary（一個 shell script 印固定 JSON 回 stdout）測 `runCheckSpec` 的 happy path + ENOENT + non-zero exit + JSON parse 失敗 + `version` 子命令失敗 (binaryVersion = "unknown")
- [ ] T-20 2000 字警告測試：mock binary 回傳 >2000 字報告，斷言 stderr 有警告字串且 audit 檔開頭有 `> [!WARNING]`
- [ ] T-21 `init` tip 測試：呼叫 `arceus init` stub stdout，斷言含 check-spec 安裝指引；`which check-spec` (或 Windows 的 `where`) 有命中時改顯示 `✓ ... detected`
- [ ] T-22 CLI integration test：完整流程 `change verify` → `change status completed`，覆蓋六種情境：
  - advisory 通過（verdict 缺也過 + advisory 警告印出）
  - strict 通過（APPROVE + SHA 相符）
  - strict 被擋（verdict 非 APPROVE）
  - strict 被擋（SHA 不符）
  - strict + `--force` 跳過（驗證 force-overrides.log 有紀錄）
  - advisory + `--force` no-op（驗證 info 訊息 + force-overrides.log **未**被寫入）
- [ ] T-23 `disabled` 模式測試（AC17）：`enabled: false` 下跑 verify，斷言 audit 檔有建、meta.json verdict 仍 undefined、stderr 印 F4 訊息
- [ ] T-24 跑 `npm run verify`（typecheck + lint + test + build），所有步驟綠燈

## Phase 6 — Self-verification (eat own dog food)

> **依賴**：本階段必須在 T-1 ~ T-24 全部完成後才能執行。提早勾掉 T-25 等同 invalidating 整個 dogfood demo。

- [ ] T-25 把這個 change 本身用新建好的 `arceus change verify` 跑一次，取得 APPROVE，且 audit 報告字數 < 2000 字後再 `change status completed`（AC14，最有意義的 demo）。若報告 ≥ 2000 字，**不**強行通過——回頭把本 change 拆分成多個小 change 再重做
