# Spec — Integrate check-spec as completion gate

## 需求描述

### 使用者故事

身為使用 Arceus 的開發者，當我跑完 `apply` skill 後，我希望系統**強制**取得 check-spec 第三方 judge 的 APPROVE 判決，才能把 change 標記為 `completed`。這樣團隊在 PR review 時看到 `meta.json.status === "completed"`，就能信任這個狀態背後有獨立稽核背書，而不只是 Arceus 自說自話。

### 功能列表

#### F1. CLI: `arceus change verify <id>`
- 簽名：`arceus change verify <id> [--base <ref>] [--head <ref>] [--format markdown|json] [--save] [--model <id>]`
- 預設 `--base origin/main`、`--head HEAD`、`--format markdown`、`--save` 預設開
- 內部 shell-out 呼叫 `<config.checkSpec.binary> verify --change <id> --base <ref> --head <ref> --format json`
- 解析 JSON 結果，更新 `meta.json` 的 `verdict` / `verifiedSha` / `verifiedAt`
- 把報告（不論 markdown 或 json）寫到 `.arceus/changes/<id>/audit/<ISO timestamp>.<ext>`，並更新 `.arceus/changes/<id>/audit/latest.md` 為最新報告的副本
- **大小檢測**：報告字數（以 markdown 純文字長度計）超過 2000 字時，印警告到 stderr：`[arceus] Audit report exceeds 2000 chars — this change may be too large; consider splitting via 'arceus change new'.`，並在 audit 檔案開頭插入同一行 `> [!WARNING]` 區塊
- **退出碼分層**（必須區分兩個來源）：
  - check-spec binary 自己的退出碼是輸入：`0` = APPROVE、`1` = 非 APPROVE、`2` = 執行錯誤
  - Arceus CLI (`arceus change verify`) 的退出碼是輸出，由 Arceus 自己決定：
    - `0`：verify 流程完成、報告已寫入；若 binary 回 0 或 1 都算「流程成功」
    - `2`：Arceus 自己的執行錯誤（binary 不存在、缺 API key、git ref 解析失敗、JSON parse 失敗等）
  - 2000 字警告**不**改變任一層的退出碼——它純粹是 advisory
- **記錄 check-spec 版本**：在每次 spawn 前先跑 `<binary> version`（exit 0、輸出版本字串），把版本寫進 audit 報告的 metadata 表頭。若 version 子命令本身失敗，warning 而非 error，標記版本為 `unknown`

#### F2. ChangeMeta 擴充
新欄位（全部 optional，向後相容）：
```ts
interface ChangeMeta {
  // ... 既有欄位
  verdict?: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  verifiedSha?: string;       // 該次 verdict 對應的 HEAD commit SHA
  verifiedAt?: string;        // ISO timestamp
  verifiedBase?: string;      // 該次稽核使用的 base ref（如 "origin/main"）
  verificationModel?: string; // 例如 "claude-opus-4-7"
}
```

#### F3. 狀態轉移閘門（含「advisory」與「strict」兩種模式）

`updateChangeStatus(arceusDir, id, "completed")` 行為依 config 三態而定：

| `enabled` | `requireApprove` | 行為 |
|---|---|---|
| `false` | (any) | 完全旁路，行為等同今天 |
| `true` | `false`（**預設**） | **Advisory 模式**：若 `verdict` 缺失或非 APPROVE，印警告但仍允許 status 轉移；verdict 存在則照常寫入 meta.json |
| `true` | `true` | **Strict 模式**（team opt-in）：`verdict` 必須為 `"APPROVE"` 且 `verifiedSha === git rev-parse HEAD`，否則 throw |

- Advisory 模式的警告訊息：`[arceus] No APPROVE verdict for <id> (current: <verdict-or-"none">). Marking completed anyway — run 'arceus change verify <id>' for an independent audit, or set checkSpec.requireApprove=true for hard gating.`
- `--force` 旗標的行為依模式而定（**必須在實作前明確**）：
  - Strict 模式 + `--force`：跳過閘門、印警告、append 一筆到 `.arceus/changes/<id>/audit/force-overrides.log`（誰、何時、當時 verdict 為何）
  - Advisory 模式 + `--force`：**no-op 但印 info 訊息** `[arceus] --force has no effect in advisory mode; gate is already non-blocking.`，不寫 force-overrides.log（沒擋到、沒繞過）
  - `disabled` 模式 + `--force`：同 advisory，no-op + 印訊息
- **SHA freshness 在 zero-commit repo 的特殊處理**：若 `git rev-parse HEAD` 失敗（exit code 非 0，例如全新 `git init` 後尚未 commit），strict 模式不直接 throw；改為印 `[arceus] Cannot resolve HEAD (zero-commit repo?). Strict gate cannot verify SHA freshness — please commit at least once before marking completed.` 並退出碼 2。此分支需要 T-5 顯式處理

#### F4. Config schema
`.arceus/config.json` 新增（**預設值**）：
```json
{
  "checkSpec": {
    "enabled": true,
    "binary": "check-spec",
    "requireApprove": false
  }
}
```
- `binary` 允許設成絕對路徑（例如 `/usr/local/bin/check-spec`）或 PATH 上的命令
- 預設 `requireApprove: false` 是**advisory 模式**——verdict 寫進 meta.json 但不擋完成；個人 prototype 不被打擾
- 團隊要升級為 strict gate 時，把 `requireApprove` 改成 `true` 即可
- 若 `enabled: false`：`change verify` 子命令本身**仍可手動跑**（不被旁路），但行為改變：
  - 仍 spawn binary、仍寫 audit 報告檔（讓使用者能 debug）
  - **不**寫回 `meta.json`（不留 verdict / verifiedSha 等欄位——避免污染 disabled 場景的 meta）
  - 不擋 `change status completed`
  - 跑完後 stderr 印 `[arceus] checkSpec.enabled=false — report saved but verdict not recorded to meta.json.`

#### F5. Apply skill 更新
`skills/apply/SKILL.md` 在 Step 5 (Review) 與 Step 6 (Complete) 中間插入：

```markdown
### Step 5.5: Audit via check-spec (independent judge)
Run the third-party spec/code audit:
```bash
node dist/cli.js change verify <id>
```
- If verdict === APPROVE: proceed to Step 6
- If verdict === REQUEST_CHANGES: read `.arceus/changes/<id>/audit/latest.md`,
  fix the drift findings, commit, then re-run verify
- If verdict === NEEDS_DISCUSSION: stop and surface the report to the user
- Max 3 re-verify rounds before stopping and asking the user
```

Step 6 的 `change status <id> completed` 不變——但因為 F3 的閘門，它會在 verdict 不對時自動失敗。

#### F6. `change show` 顯示
`arceus change show <id>` 額外輸出區塊（若 `verdict` 存在）：
```
Audit:
  Verdict:   APPROVE
  At:        2026-05-28T07:12:33Z
  Base:      origin/main
  Head SHA:  def4567
  Model:     claude-opus-4-7
  Report:    .arceus/changes/<id>/audit/latest.md
```

#### F7. `arceus init` first-run 輸出加 check-spec 指引
`src/cli.ts` 的 `init` 子命令在建立 `.arceus/` 之後印出：
```
✓ Arceus initialized at .arceus/

Tip: Arceus integrates with check-spec for independent spec/code audits.
  Install:   go install github.com/mikeqoo1/check-spec/cmd/check-spec@latest
             # or grab a binary from https://github.com/mikeqoo1/check-spec/releases
  Run:       arceus change verify <id>
  Strict gate (opt-in): set checkSpec.requireApprove=true in .arceus/config.json
```
- 偵測 `check-spec` 已在 PATH 時，把「Install」段改成 `✓ check-spec detected at <which-path>`
- `arceus init` 在資料夾已存在的 skip 分支也印同樣的 tip（讓重新跑 init 的人也看得到）

### 錯誤處理（必須是 actionable，不是 stacktrace）

- **`check-spec` binary 不在 PATH**：印 `check-spec not found. Install: 'go install github.com/mikeqoo1/check-spec/cmd/check-spec@latest' or set checkSpec.binary in .arceus/config.json`
- **`ANTHROPIC_API_KEY` 未設**：印 `ANTHROPIC_API_KEY required by check-spec. Export it in your shell, or set checkSpec.enabled=false in .arceus/config.json to disable the gate.`
- **git ref 不存在**：原樣轉發 check-spec stderr，加前綴 `[arceus] check-spec failed:`
- **JSON parse 失敗**：fallback 到把整段 stdout 存進 audit 檔，verdict 標記為 `NEEDS_DISCUSSION`，並印警告

## 驗收條件

- [ ] **AC1**: 在乾淨的 sandbox 跑 `node dist/cli.js change verify <id>`（給定 mock binary 回傳 APPROVE JSON），meta.json 出現 `verdict: "APPROVE"` 且 `verifiedSha` 等於 `git rev-parse HEAD`
- [ ] **AC2 (advisory, default)**: 在預設 config (`requireApprove: false`) 下，`change status <id> completed` 即使 verdict 缺失也成功，但 stderr 必須出現 F3 規定的 advisory 警告訊息
- [ ] **AC3 (strict, opt-in)**: 把 config 改成 `requireApprove: true` 後，verdict 缺失時 `change status completed` 失敗，error message 提到要先跑 verify
- [ ] **AC4 (SHA freshness)**: strict 模式下，verdict 為 APPROVE 但 `verifiedSha` 與當前 HEAD 不符時（模擬 verify 後又 commit），status 轉移仍被擋下
- [ ] **AC5 (force)**: strict 模式下，`--force` 確實能跳過閘門，且 `audit/force-overrides.log` 有一筆紀錄
- [ ] **AC6 (disabled)**: `config.checkSpec.enabled = false` 時，整個閘門被旁路（不擋、也不寫 verdict 進 meta.json）
- [ ] **AC7 (errors)**: 缺 binary / 缺 API key 時，錯誤訊息符合「錯誤處理」段落規範，**不**出現 stack trace
- [ ] **AC8 (show)**: `change show <id>` 在 verdict 存在時顯示 Audit 區塊
- [ ] **AC9 (skill)**: `skills/apply/SKILL.md` 中存在 Step 5.5，且 Step 6 仍維持原 `change status completed` 呼叫
- [ ] **AC10 (archive)**: 既有 `.arceus/changes/` 下尚未有 verdict 的 changes，能正常被 archive（archive 路徑不受閘門影響）
- [ ] **AC11 (size warning)**: 給定 mock binary 回傳一份 >2000 字的 markdown 報告，verify 完成後 stderr 出現 F1 規定的「change may be too large」警告，且 audit 檔開頭有 `> [!WARNING]` 區塊；退出碼**不**因警告而改變
- [ ] **AC12 (init tip)**: `arceus init` 印出 F7 規定的 check-spec 安裝指引；當 PATH 上已有 check-spec 時改顯示 `✓ check-spec detected at <path>`
- [ ] **AC13 (verify)**: `npm run verify` (typecheck + lint + test + build) 全綠
- [ ] **AC14 (dogfood)**: 本 change 自身在 apply 完成後，能跑過 `check-spec verify` 並取得 APPROVE（吃自己的狗食，且 audit 報告字數 < 2000 字——若超過，代表此 change 本身就違反自己訂的規矩，需要拆分）
- [ ] **AC15 (zero-commit)**: 在 zero-commit repo（`git init` 但無任何 commit）跑 strict 模式的 `change status <id> completed`，必須印 F3 規定的「Cannot resolve HEAD」訊息、退出碼 2，**不**拋出原始 git stderr stack
- [ ] **AC16 (force in advisory)**: advisory 模式下執行 `change status <id> completed --force` 必須印 F3 規定的「--force has no effect in advisory mode」訊息且**不**寫 force-overrides.log
- [ ] **AC17 (disabled verify)**: `config.checkSpec.enabled = false` 下跑 `change verify <id>`，stderr 出現 F4 規定的「report saved but verdict not recorded」訊息，audit 檔有被建立，但 meta.json 的 verdict 欄位仍為 undefined
- [ ] **AC18 (version recorded)**: audit 報告 metadata 開頭含 check-spec 版本字串；mock binary 的 `version` 子命令失敗時，版本欄位顯示 `unknown` 但 verify 流程不失敗

## 技術假設

- check-spec 的 `--format json` 輸出 schema 不變（見 https://github.com/mikeqoo1/check-spec/blob/main/internal/report/schema.json）
- check-spec 的 CLI flag (`--change`, `--base`, `--head`, `--format`, `--model`, `version`) 與退出碼 0/1/2 為穩定 contract
- **版本記錄但不鎖定**：每次 verify 把 `check-spec version` 的輸出寫進 audit metadata。Arceus 不主動拒絕舊版本——若 schema 不相容，會在 JSON parse 失敗 fallback 路徑被偵測到並降級為 `NEEDS_DISCUSSION` 並印警告；診斷時靠 audit 中的版本字串。實作的明確 contract：JSON parse 失敗訊息必須帶版本字串
- 開發者本機可裝 Go（為了 `go install` check-spec），或從 Releases 抓 pre-built binary
- 在不能訪問 Anthropic API 的環境（CI 沒設 secret、企業 firewall），使用者會明示地把 `checkSpec.enabled` 設成 `false`，不期望自動降級
- Arceus 目前的 `src/state/config.ts` 結構能用增量擴充的方式加 `checkSpec` 區塊，不需要 schema migration
- `git rev-parse HEAD` 在**有 commit 歷史**的 repo 上可用；zero-commit repo 已在 F3 明確處理
- **不支援並行 verify**：兩個 process 同時跑 `arceus change verify <id>` 的行為未定義（誰最後寫入 meta.json 誰 wins）。使用者自行確保序列化。將來若需要可加 `.arceus/changes/<id>/.lock` 檔做檔案鎖
- **平台相容性**：偵測 `check-spec` 是否在 PATH 上時，Linux/macOS 用 `which`、Windows 用 `where`，依 `process.platform` 分支處理
