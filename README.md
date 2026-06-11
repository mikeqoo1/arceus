# Arceus

> 阿爾宙斯——創造世界的傳說寶可夢，擁有全部屬性。

Claude Code 多 agent 協作插件。AI 規劃變成 git-trackable 的設計產物、實作前後雙層驗證、可被獨立第三方稽核——讓「AI 自己說做完了」這件事，**不再只是 AI 自己說了算**。

## 三件這個插件做的事

1. **Magic keywords**：對話中打 `propose`、`apply`、`autopilot`、`review` 等關鍵字觸發對應工作流，背後是 subagent 真的去執行。
2. **Change-driven 協作**：每一個 AI 規劃會落地成 `.arceus/changes/<id>/` 下的 proposal/spec/tasks/decisions 四份 markdown，**進 git、可 PR review**——團隊在 AI 動工前就能擋下爛計畫。
3. **雙層驗證 + 第三方稽核**：除了 typecheck/lint/test/build 的 self-verification，可選整合 [check-spec](https://github.com/mikeqoo1/check-spec) 作為**獨立稽核者**——它讀 spec.md + git diff，回 `APPROVE / REQUEST_CHANGES / NEEDS_DISCUSSION` 結構化判決，verdict 寫進 `meta.json` 並綁定 commit SHA。

## 安裝

```bash
# 方式 A：開發測試
claude --plugin-dir /path/to/arceus

# 方式 B：透過 marketplace 安裝
claude plugin marketplace add /path/to/marketplace
claude plugin install arceus@marketplace-name
```

在目標專案初始化：

```bash
arceus init
```

第一次跑會建立 `.arceus/` 骨架、寫入 nested `.gitignore`（runtime state 自動排除），並提示是否安裝 check-spec（選用）。

### 選用：安裝 check-spec 做第三方稽核

```bash
go install github.com/mikeqoo1/check-spec/cmd/check-spec@latest
export ANTHROPIC_API_KEY=sk-ant-...
```

裝好後 `arceus init` 會偵測到並顯示 `✓ check-spec detected`。沒裝也能用，只是少了 audit 層。

## Magic keywords

對話中輸入即可觸發。所有 keyword 都有中英對照。

| Keyword | 效果 |
|---------|------|
| `propose` / `提案` | 草擬一份 change proposal 到 `.arceus/changes/<id>/`（不寫程式碼） |
| `apply` / `實作` | 實作一份 active 的 change，含驗證 + 第三方稽核 |
| `review-change` / `審查` | 在實作前對 proposal 做結構化 review（BLOCK / WARN / SUGGEST） |
| `autopilot` | 全自動：規劃 → 實作 → 測試 → review → 完成 |
| `plan` / `規劃` | 先出計畫，確認後再執行 |
| `review` | 多角度 code review |
| `fix` / `debug` | 反覆除錯直到測試通過 |
| `sync` / `同步` | 同步任務狀態到 Plane/GitLab/GitHub |
| `deep-dive` / `分析` | 深度程式碼分析 |

### 兩種使用節奏

**輕量（聊天模式）**——適合 prototyping、單人快迭代：

```
幫我 autopilot 實作使用者登入功能
plan 重構 API 路由層
review 目前的 diff
debug 這個測試為什麼失敗
```

**嚴謹（spec-driven 模式）**——適合團隊協作、PR review、需要稽核軌跡：

```
propose 整合 Stripe 付款        # AI 寫 4 份檔到 .arceus/changes/...
                                # → 你 commit、開 PR、人工 review
review-change <id>              # AI 對 proposal 做 BLOCK/WARN/SUGGEST 結構化評審
npx arceus change status <id> active  # 你 approve
apply <id>                      # AI 實作 + 跑 verify + 跑 check-spec
                                # → verdict 寫進 meta.json + audit/ 報告
npx arceus change status <id> completed  # gate 放行（advisory 或 strict）
```

## CLI

```bash
arceus init                            # 初始化 .arceus/ + nested .gitignore
arceus status                          # 顯示插件狀態
arceus change new "<title>"            # 建一份 change skeleton
arceus change list [--status active]   # 列 changes
arceus change show <id> [-f spec]      # 顯示 change 內容 + audit 區塊
arceus change verify <id>              # 跑 check-spec 第三方稽核
arceus change status <id> <status>     # 轉狀態（draft/active/completed/archived）
                                       # --force 在 strict mode 下逃生口
arceus change archive <id>             # 完成的 change 移到 archive/
```

## 第三方稽核：check-spec 整合

`.arceus/config.json` 控制三種 gate 模式：

```json
{
  "checkSpec": {
    "enabled": true,
    "binary": "check-spec",
    "requireApprove": false
  }
}
```

| `enabled` | `requireApprove` | 行為 |
|---|---|---|
| `false` | (任何) | 閘門完全旁路；`change verify` 仍可手動跑、報告會寫，但不更新 meta.json |
| `true` | `false`（**預設**）| **Advisory**：verdict 寫進 meta.json；缺 / 非 APPROVE 印警告但不擋 `completed` |
| `true` | `true` | **Strict**：完成必須 `verdict === APPROVE` 且 `verifiedSha === git rev-parse HEAD`；`--force` 帶 audit log 可繞過 |

**SHA freshness**：strict 模式把 verdict 綁 commit SHA。verify 拿到 APPROVE 後又 commit 新東西，verdict 自動失效——避免「verify 通過後偷塞改動」漏洞。

**Audit size heuristic**：報告超過 7000 字會印警告，提示「change 切太大、考慮拆分」（不擋）。閾值是 calibrated heuristic，校準依據見 [Decision 6 v2](.arceus/changes/2026-05-28-integrate-check-spec-as-completion-gate/decisions.md)。

## 架構

```
Hooks → Skills → Agents → State → (Integrations)
```

```
arceus/
├── .claude-plugin/plugin.json          # Plugin manifest
├── hooks/hooks.json                    # Lifecycle hook 註冊
├── agents/*.md                         # Agent 定義（planner/coder/tester/reviewer/researcher/task-syncer）
├── skills/*/SKILL.md                   # 9 個 skill 工作流
├── src/
│   ├── hooks/                          # Hook 實作（TypeScript）
│   ├── state/                          # .arceus/ 純檔案 I/O
│   │   ├── changes.ts                  # change CRUD + completion gate
│   │   ├── config.ts                   # config + nested .gitignore
│   │   ├── notepad.ts                  # compaction-resistant 筆記
│   │   ├── session-log.ts              # 事件 log
│   │   └── preflight.ts                # 分支保護檢查
│   ├── integrations/                   # 外部工具整合
│   │   └── check-spec.ts               # spawn check-spec + 解析 verdict
│   ├── index.ts                        # 主要 exports
│   └── cli.ts                          # CLI
└── tests/unit/                         # vitest 單元測試
```

每個 repo 第一次跑 `arceus init` 會建：

```
.arceus/
├── .gitignore                          # 自動寫入：擋 runtime state、放行 changes/
├── .gitkeep
├── config.json                         # ← commit 進 git
└── changes/                            # ← commit 進 git
    └── <YYYY-MM-DD-slug>/
        ├── proposal.md                 # 為什麼
        ├── spec.md                     # 做什麼
        ├── tasks.md                    # 怎麼做（checkbox）
        ├── decisions.md                # 技術決策
        ├── meta.json                   # 含 verdict / verifiedSha / verifiedAt
        └── audit/                      # check-spec 報告歷史
            ├── 2026-XX-XX-...md
            ├── latest.md
            └── force-overrides.log     # （若用過 --force）
```

詳細架構：[docs/architecture/arceus-plugin-architecture.md](docs/architecture/arceus-plugin-architecture.md)

## 開發

```bash
npm install
npm run build        # tsup → dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest（69 tests）
npm run verify       # 全部跑一遍
```

本專案自己也用 spec-driven workflow 維護——`.arceus/changes/` 下可以看到歷次 change 的提案、實作、稽核軌跡。

## 授權

Apache-2.0
