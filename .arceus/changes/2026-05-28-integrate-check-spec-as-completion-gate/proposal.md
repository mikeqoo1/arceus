# Integrate check-spec as completion gate

## 為什麼 (Why)

目前 `apply` skill 完成一個 change 的判定是**榮譽制**：

- `skills/apply/SKILL.md` Step 3 由 `arceus:coder` 自己在 `tasks.md` 勾選 `[x]`
- Step 4 跑 `npm run verify`（typecheck/lint/test/build），這只證明**程式碼能編譯且測試會過**，不證明「程式碼有解決 `spec.md` 寫的問題」
- Step 6 直接呼叫 `npx arceus change status <id> completed`，沒有任何外部驗證
- 結果：「completed」這個狀態的可信度，等同於 Arceus 自己說「我覺得做完了」

姊妹專案 `check-spec` (https://github.com/mikeqoo1/check-spec) 是專門補這個缺口的第三方 Go 工具：它把 `proposal.md` + `spec.md` + `tasks.md` + `git diff` 餵給 Claude 作為**獨立 judge**，回傳 `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION` 結構化判決。但目前它跟 Arceus 沒有任何耦合——使用者得記得手動跑、手動讀報告、手動決定要不要 mark completed。

這個 change 把 check-spec 接成 Arceus 的**完成閘門 (completion gate)**：在 `apply` 走到 `change status completed` 之前，強制取得 check-spec 的 APPROVE 判決，否則狀態轉移會被擋下來。

### 設計原則

- **不破壞 check-spec 的獨立性**：check-spec 保持是分離的 Go binary、分離的 repo、分離的 review 視角。Arceus 只是「**呼叫它、尊重它的判決**」，不嵌入它的邏輯。
- **不重複 check-spec 已經做好的事**：Arceus 不會自己 reimplement spec/diff 比對；那是 check-spec 的核心價值。
- **預設記錄但不擋**：verify 預設會跑、verdict 預設會寫進 `meta.json`，但**不**預設阻擋 `change status completed`——個人 prototype 場景下 hard block 太擾民。團隊要嚴格 gate 時把 `checkSpec.requireApprove` 設成 `true` 即可升級。
- **用 audit 大小當 task 切分訊號**：單份 audit 報告超過 7000 字時印警告——通常意味著這個 change 一次塞太多東西，建議拆分。這是 advisory，不擋流程。

## 範圍 (Scope)

- **In scope**:
  - 新增 CLI 子命令 `arceus change verify <id>`，封裝 `check-spec verify` 呼叫
  - 擴充 `ChangeMeta` (`src/state/changes.ts`) 新增 `verdict` / `verifiedSha` / `verifiedAt` 三個欄位
  - 修改 `updateChangeStatus()`：當目標 status 為 `completed` 且 config 啟用 gate 時，要求最近一次驗證 verdict === `APPROVE` 且 `verifiedSha` 等於當前 HEAD
  - 修改 `apply` skill 的 SKILL.md：在 Step 5 (review) 與 Step 6 (complete) 之間插入「Step 5.5 Audit via check-spec」
  - 新增 config schema `checkSpec.{enabled, binary, requireApprove}` 進 `.arceus/config.json`（預設 `enabled: true`、`requireApprove: false`）
  - 稽核報告持久化到 `.arceus/changes/<id>/audit/<timestamp>.md`，並維護 `audit/latest.md` 指向最新一份
  - 在 `arceus init` first-run 輸出中加入 check-spec 安裝指引（讓使用者第一天就知道有這層 audit）
  - 單份 audit 報告超過 7000 字時印警告（「change 可能切太大，考慮拆分」）
  - `change show` 輸出顯示最近 verdict + 時間戳 + 對應的 commit SHA
  - 加 `--force` 旗標讓 emergency 情境可以跳過 gate（會印警告 + 寫進 audit log）
  - 對應 unit/integration tests

- **Out of scope** (留給後續 changes):
  - 把 `tasks.md` / `spec.md` 模板改成帶 ID 編號（`T-1`、`AC-1`）——這是 phase B 的事
  - check-spec 報告的 drift findings 自動回寫 `tasks.md` 變成新任務——phase C
  - 改寫 `check-spec` 本身（它是另一個 repo）
  - GitHub Action 整合（check-spec 已自帶 action.yml，使用者直接照它的 README 配置即可，我們只需在文件提一下）
  - 不再要求 `npm run verify` 的傳統 4 步——它跟 check-spec 互補，不是替代

## Stakeholders

- **Owner**: @mikeqoo1（Arceus 與 check-spec 雙專案作者）
- **Primary user**: Arceus 在 spec-driven 流程下的所有使用者
- **External dependency owner**: check-spec 本身——它的 CLI 介面 (`check-spec verify --change <id> --base <ref> --head <ref>` + exit code 0/1/2) 是這個整合的 contract，後續若要修改需同步協調
- **Reviewer**: 任何要在 main 上以 spec-driven 方式合 PR 的協作者
