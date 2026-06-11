# Arceus — Claude Code Plugin 架構設計文件

> 版本：v2.0（2026-04-16 從 SDK 路線轉向 Plugin 路線）
> 參考專案：[oh-my-claudecode](https://github.com/Yeachan-Heo/oh-my-claudecode)、[edict](https://github.com/cft0808/edict)

---

## 1. 專案定位

Arceus 是一個 **Claude Code 插件**，讓使用者在 Claude Code 裡用自然語言就能觸發多 Agent 協作工作流。

```
使用者：「幫我用 autopilot 做這個 feature」
  ↓
Arceus Hook 偵測 keyword
  ↓
注入 Skill（autopilot）
  ↓
拆任務 → 選 Agent → Claude Code subagent 真正執行
  ↓
跑 build/test/lint 驗證
  ↓
更新 Plane / GitLab / GitHub 狀態
  ↓
.arceus/ 保存執行記錄
```

### 命名由來

阿爾宙斯——創造世界的傳說寶可夢，擁有全部屬性。對應到一個能應付所有工作需求的萬能 AI 協作引擎。

---

## 2. 核心設計原則

| 原則 | 說明 |
|------|------|
| **Hook 驅動** | 不靠顯式指令，透過 Claude Code lifecycle hooks 自動偵測並注入行為 |
| **Evidence-Driven** | 任務完成前必須通過 build/test/lint 驗證，不信任 LLM 自稱完成 |
| **Subagent 執行** | Agent 透過 Claude Code 原生 subagent 機制真正寫 code，不是呼叫 API 生文字 |
| **持久化記憶** | `.arceus/` 目錄保存 project memory、execution log、notepad，撐過 context reset |
| **Magic Keywords** | 自然語言觸發（如 "autopilot"、"review"、"plan"），零學習成本 |
| **任務平台同步** | 自動與 Plane / GitLab / GitHub 同步任務狀態 |

---

## 3. 整體架構

```
┌─────────────────────────────────────────────────┐
│                  Claude Code                     │
│                                                  │
│  User Input                                      │
│      ↓                                           │
│  ┌─────────┐    ┌──────────┐    ┌────────────┐  │
│  │  Hooks   │───→│  Skills  │───→│   Agents   │  │
│  │ (偵測)   │    │ (注入行為)│    │ (subagent) │  │
│  └─────────┘    └──────────┘    └────────────┘  │
│      ↓                ↓               ↓          │
│  ┌──────────────────────────────────────────┐    │
│  │              State Layer                  │    │
│  │  .arceus/ (memory, logs, notepad, config) │    │
│  └──────────────────────────────────────────┘    │
│      ↓                                           │
│  ┌──────────────────────────────────────────┐    │
│  │           External Skills                 │    │
│  │  Plane Ops │ GitLab Ops │ GitHub Ops      │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 四層架構（參考 OMC）

1. **Hooks Layer** — 掛入 Claude Code lifecycle，偵測 keyword、注入 context
2. **Skills Layer** — 可組合的工作流（autopilot、review、plan-and-execute 等）
3. **Agents Layer** — 專職 agent 定義（planner、coder、tester、reviewer 等）
4. **State Layer** — `.arceus/` 持久化狀態管理

---

## 4. Hooks 設計

Claude Code 支援的 lifecycle hooks（參考 OMC 的 11 個 hook point）：

| Hook | 觸發時機 | Arceus 用途 |
|------|---------|------------|
| `SessionStart` | 開啟新 session | 載入 `.arceus/` 狀態、注入 system prompt |
| `UserPromptSubmit` | 使用者送出訊息 | **Magic keyword 偵測**、注入 skill context |
| `PreToolUse` | 呼叫工具前 | 攔截危險操作、注入安全檢查 |
| `PostToolUse` | 工具執行後 | 記錄執行結果；log `code_edit`（Edit/Write/MultiEdit/NotebookEdit）與 `verification_run`（Bash 驗證指令）結構化事件 |
| `SubagentStart` | subagent 啟動 | 注入 agent-specific context |
| `SubagentStop` | subagent 完成 | 收集結果、更新任務狀態 |
| `PreCompact` | context 壓縮前 | 把關鍵資訊寫入 `.arceus/notepad` 保存 |
| `Stop` | 每回合 AI 回應結束時 | 保存最終狀態；呼叫 stop-gate 檢查未驗證的 code edit |

### 4.1 Stop Hook 驗證閘門（Stop Gate）

每回合結束時，`stop.ts` 會評估本回合是否有未驗證的程式碼修改。

#### 事件流

```
PostToolUse（每次工具呼叫後）
  ├── tool 為 Edit/Write/MultiEdit/NotebookEdit
  │     └── logEvent: { event: "code_edit", data: { tool, file_path } }
  └── tool 為 Bash 且 command 匹配驗證 pattern
        └── logEvent: { event: "verification_run", data: { kind, command, ok } }
              ↓
Stop hook 觸發（每回合結束）
  └── readSessionLog() 讀取本 session 全部事件
        └── evaluateStopGate() ← src/hooks/stop-gate.ts（純函式，無 I/O）
              ├── enabled=false  → pass（完全旁路）
              ├── stop_hook_active=true → pass（loop protection）
              ├── 無 non-excluded code_edit → pass
              ├── lastEditIndex 之後有 verification_run ok=true → pass
              ├── requireVerify=false（advisory）→ writeOutput({ systemMessage: warning })
              └── requireVerify=true（strict）   → writeOutput({ decision: "block", reason })
```

**loop protection**：`stop_hook_active === true`（Claude Code 在上一輪 block 後重進 Stop 時設此欄位）放行並以 `writeOutput({continue:true, systemMessage})` 附帶警告——於 `enabled` 檢查之後執行，disabled gate 不發任何訊息（`stop_hook_active` 可能由其他 plugin 的 Stop hook 造成）。只允許 block 一輪——AI 若仍未跑驗證，第二輪放行避免 session 鎖死。

**fail-open 原則**：整個 gate 邏輯包在 try-catch 中。任何內部錯誤（如 session log 損毀）一律 passThrough + stderr 警告，不影響正常工作流。

#### Path Exclusion（`isExcludedPath`）

`excludedPaths` 預設 `[".arceus/", "*.md"]`，在 gate predicate 階段過濾（不在 PostToolUse 階段過濾，session log 保留完整 code_edit 記錄供除錯）。

| Pattern 格式 | 匹配規則 | 範例 |
|---|---|---|
| 以 `/` 結尾 | 前綴/子字串比對（`includes`） | `.arceus/` → 排除所有 `.arceus/` 內的路徑 |
| 以 `*` 開頭 | 後綴比對（`endsWith`） | `*.md` → 排除所有 `.md` 檔 |
| 其他 | 完全相等 | `TODO.txt` → 排除該確切路徑 |
| `"unknown"` | 永不排除（保守策略） | — |

#### Gate 三態

| `stopGate.enabled` | `stopGate.requireVerify` | 行為 |
|---|---|---|
| `false` | (任何) | 完全旁路；行為等同沒有 gate |
| `true` | `false`（**預設**） | **Advisory**：`systemMessage` 警告，不阻止 AI 結束 |
| `true` | `true` | **Strict**（team opt-in）：`decision: "block"` + reason 指示 AI 補跑 `npm run verify` |

#### 與四層驗證機制的分工

| 層級 | 實作位置 | 觸發時機 | 控制力 |
|---|---|---|---|
| **L1 subagent reminder** | `subagent-stop.ts` | arceus subagent 完成時 | 零（guidance only） |
| **L2 stop gate** | `stop.ts` + `stop-gate.ts` | 每回合結束時 | advisory systemMessage 或 strict block |
| **L3 multi-agent adversarial review** | `workflows/adversarial-review.js`（apply Step 5） | apply 的 review 階段 | 存活 block findings 阻擋進度，最多 3 輪 |
| **L4 checkSpec completion gate** | `src/state/changes.ts` | `change status completed` lifecycle | throw Error（`--force` 可繞過） |

四層攔截時機完全不同，互為互補：subagent reminder（L1）引導 AI 跑驗證 → stop gate（L2）在回合出口攔截未驗證的 code edit → adversarial review（L3）在 apply 的 review 階段以多維度對抗方式把關 → checkSpec audit（L4）是 change lifecycle 的最終獨立防線。

### Magic Keywords 對應表

| Keyword | 觸發的 Skill | 說明 |
|---------|-------------|------|
| `autopilot` | autopilot | 全自動：規劃 → 實作 → 測試 → review → 完成 |
| `plan` / `規劃` | plan-and-execute | 先出計畫讓使用者確認，再執行 |
| `review` | code-review | 多角度 code review（security、performance、style） |
| `test` / `tdd` | test-driven | TDD 工作流 |
| `fix` / `debug` | debug-loop | 反覆除錯直到測試通過 |
| `deep-dive` / `分析` | deep-analysis | 深度程式碼分析 |
| `sync` / `同步` | task-sync | 同步任務狀態到 Plane/GitLab/GitHub |

---

## 5. Skills 設計

Skills 是可組合的工作流定義，不是單一指令。

### 第一批 Skills

#### 5.1 `autopilot`（全自動）

```
讀取需求 → Planner 拆任務 → Coder 實作 → Tester 驗證
  → Reviewer 審查 → 修正 → 最終驗證 → 更新任務狀態
```

- 最多 N 輪修正循環
- 每步都有 evidence-driven 驗證
- 失敗時自動降級（retry → 縮小範圍 → 報告給使用者）

#### 5.2 `plan-and-execute`

```
分析需求 → 產出計畫 → 等使用者確認 → 逐步執行 → 驗證
```

- 計畫包含：子任務清單、風險分析、驗收標準
- 使用者可修改計畫後再執行

#### 5.3 `code-review`

```
讀取 diff → 多角度 review → 產出結構化意見
```

- 面向：security、performance、style、correctness
- 可同時用多個 reviewer agent（不同角度）
- 產出：blocking issues、non-blocking issues、建議

#### 5.4 `debug-loop`（類似 OMC 的 ralph）

```
跑測試 → 分析失敗 → 修正 → 重跑 → 直到通過或達上限
```

#### 5.5 `task-sync`

```
讀取 Plane/GitLab/GitHub issues → 轉成 Arceus 任務
→ 執行後回寫狀態、附上 MR/PR URL
```

#### 5.6 `deep-analysis`

```
讀取程式碼 → trace 執行路徑 → 產出架構分析
```

### Skill 檔案格式

每個 skill 是一個 markdown 檔，放在 `.arceus/skills/` 或 `skills/`：

```markdown
---
name: autopilot
description: 全自動開發工作流
triggers: ["autopilot", "自動", "全自動"]
agents: [planner, coder, tester, reviewer]
verification: [build, test, lint, typecheck]
---

# 執行流程

1. 分析需求，產出子任務清單
2. 逐一執行子任務（可平行的就平行）
3. 每個子任務完成後跑驗證
4. 全部完成後做最終 review
5. 更新外部任務狀態

# 失敗處理

- 驗證失敗：自動修正，最多 3 輪
- 3 輪後仍失敗：報告給使用者決定
```

---

## 6. Agents 設計

### Agent 分類

| 類別 | Agents | 職責 |
|------|--------|------|
| **規劃** | planner, architect | 需求分析、任務拆解、架構設計 |
| **開發** | coder, debugger | 寫 code、修 bug |
| **品質** | tester, verifier | 跑測試、驗證結果 |
| **審查** | code-reviewer, security-reviewer, perf-reviewer | 多角度 code review |
| **同步** | task-syncer | 讀寫 Plane/GitLab/GitHub |
| **輔助** | researcher, writer | 調查、寫文件 |

### Agent 定義格式

每個 agent 是一個 markdown 檔，放在 `agents/`：

```markdown
---
name: planner
description: 需求分析與任務拆解
model_preference: opus  # 高推理能力
skills: [implementation-strategy]
delegation_to: [coder, tester, researcher]
---

# System Prompt

你是 Planner Agent。你的職責是：
1. 分析使用者需求
2. 識別影響範圍和風險
3. 產出可執行的子任務清單
4. 每個子任務有明確的驗收標準

# 輸出格式

- 需求摘要
- 風險清單
- 子任務清單（含 type、title、acceptance_criteria、estimated_complexity）
- 建議的執行順序（哪些可平行）
```

### Model Routing

| Agent 類別 | 建議 Model | 原因 |
|-----------|-----------|------|
| planner, architect | Opus | 需要深度推理 |
| coder, debugger | Sonnet | 平衡品質和速度 |
| tester, verifier | Haiku/Sonnet | 速度優先 |
| reviewer | Sonnet/Opus | 穩定且深入 |
| task-syncer | Haiku | 簡單 API 操作 |

（Model routing 由 Claude Code 的 subagent model 參數控制）

---

## 7. State 管理（`.arceus/` 目錄）

```
.arceus/
├── config.json          # 使用者設定（task sources、model preferences）
├── notepad.md           # 跨 session 持久筆記（撐過 context reset）
├── memory/              # Project-level 記憶
│   ├── patterns.md      # 發現的 code patterns
│   ├── decisions.md     # 架構決策記錄
│   └── issues.md        # 已知問題
├── sessions/            # 執行記錄
│   └── {session-id}/
│       ├── plan.json    # 執行計畫
│       ├── results.json # 各 agent 結果
│       └── log.jsonl    # 時間線 log
└── skills/              # 使用者自訂 skills（覆蓋預設）
```

### Notepad（關鍵設計）

Notepad 是 **compaction-resistant** 的——在 `PreCompact` hook 時，Arceus 會把當前 session 的關鍵資訊寫入 notepad，下次 context reset 後還能讀回來。

內容包含：
- 當前任務進度
- 成功的做法（what worked）
- 已知的坑（what to avoid）
- 未完成的事項

---

## 8. 外部整合（作為 Skills）

### 8.1 GitHub Skill

```typescript
// 工具定義（MCP tool format）
tools: {
  "github_list_issues": { /* 列出 issues */ },
  "github_create_issue": { /* 建立 issue */ },
  "github_update_issue": { /* 更新 issue 狀態 */ },
  "github_create_pr": { /* 建立 PR */ },
  "github_add_comment": { /* 加 comment */ },
}
```

### 8.2 GitLab Skill

```typescript
tools: {
  "gitlab_list_issues": { /* 列出 issues */ },
  "gitlab_create_mr": { /* 建立 MR */ },
  "gitlab_get_pipeline": { /* 查 pipeline 狀態 */ },
  // ...
}
```

### 8.3 Plane Skill

```typescript
tools: {
  "plane_list_tasks": { /* 列出任務 */ },
  "plane_update_status": { /* 更新狀態 */ },
  "plane_attach_link": { /* 附上 MR 連結 */ },
  // ...
}
```

---

## 9. 驗證系統（Evidence-Driven）

任務完成前，**必須通過驗證**。Agent 不能自稱 "done"。

### 驗證步驟

```bash
# 依照專案設定自動執行
npm run typecheck  # 或 tsc --noEmit
npm run lint       # 或 eslint
npm run test       # 或 vitest run
npm run build      # 或 tsup
```

### 驗證邏輯

```
Agent 回報完成
  ↓
Verifier Agent 執行驗證指令
  ↓
全部通過？ → 標記完成 ✅
有失敗？   → 回傳失敗資訊給 Agent → 修正 → 重跑驗證
3 輪都失敗？→ 報告給使用者 ⚠️
```

### 9.1 外部稽核：check-spec 整合

Self-verification 只能證明「code 編譯過、測試會過」，**證明不了**「code 有解決 spec 寫的問題」。後者需要獨立第三方判決。

```
Arceus apply 完成 self-verification
  ↓
arceus change verify <id>
  ↓  spawnSync
check-spec (Go binary, 獨立 repo) ─→ Anthropic API ─→ JSON verdict
  ↓                                                       ↓
audit/<ts>.md + audit/latest.md  ←──────────────  meta.json:
                                                    verdict
                                                    verifiedSha
                                                    verifiedAt
                                                    verificationBinaryVersion
```

**設計原則**：check-spec 不嵌入 Arceus，保持獨立的 repo / binary / review 視角；Arceus 只是「**呼叫它、尊重它的判決**」。

**Gate 三態**（由 `.arceus/config.json` 的 `checkSpec` 區塊控制）：

| `enabled` | `requireApprove` | 行為 |
|---|---|---|
| `false` | (任何) | 閘門完全旁路；verify 仍可手動跑、報告會寫，但 meta.json 不寫 verdict |
| `true` | `false`（預設） | Advisory：verdict 寫進 meta.json；缺 / 非 APPROVE 印警告但不擋 `completed` |
| `true` | `true` | Strict：必須 verdict === APPROVE 且 verifiedSha === HEAD；`--force` 帶 audit log entry 可繞過 |

**Audit 大小訊號**：報告超過 7000 字時 stderr 印警告，提示 change 切太大、建議拆分。不擋流程。

### 9.2 Workflow 多 Agent 審查：adversarial review 與 judge panel

Arceus 附帶兩個 plugin-shipped Workflow script（`workflows/` 目錄，經 `package.json` 的 `files` 陣列隨 plugin 發布）。兩者均為 Claude Code Workflow tool 的 scriptPath 目標，**不是** standalone Node 模組——不能用 `import()` 單元測試，只在 Workflow tool runtime 中執行。

#### `{{ARCEUS_PLUGIN_ROOT}}` Placeholder 替換機制

builtin SKILL.md 注入前，`keyword-detector.ts` 的 `loadSkillContent()` 在 builtin path 分支呼叫：

```typescript
content.replaceAll("{{ARCEUS_PLUGIN_ROOT}}", getPluginRoot())
```

`getPluginRoot()` 讀取 `process.env["CLAUDE_PLUGIN_ROOT"]`（Claude Code 啟動 plugin hooks 時設定）；未設定時 fallback 到 `process.cwd()`。替換**只發生在 builtin path**——project-level override（`.arceus/skills/*/SKILL.md`）由作者自行控制路徑，plugin 不介入。

#### 9.2.1 `workflows/adversarial-review.js`（apply Step 5，L3）

apply Step 5 的 Path A，輸入 `{ changeId, diff, specContent, tasksContent }`。

```
Phase 1 "dimension-review"
  parallel() ──→ dim:spec-compliance   ─┐
             ──→ dim:correctness        ├─→ 4 個 DimensionFindings
             ──→ dim:security           │   (severity: block/warn/suggest,
             ──→ dim:performance       ─┘    evidence 必填)
                      ↓
              彙整 all findings
              ├── 空 findings → 直接 return APPROVE (skip Phase 2/3)
              └── 有 block findings → Phase 2
                      ↓
Phase 2 "skeptic-verification"
  parallel() ──→ skeptic:0  (嘗試反駁 finding[0]) ─┐
             ──→ skeptic:1  (嘗試反駁 finding[1])  ├─→ survives: bool
             ──→ …                                 ─┘
              ├── skeptic errored → 保守保留 finding (survives=true)
              └── 全部反駁成功 → surviving=[] → APPROVE
                      ↓
Phase 3 "synthesis"
  agent ──→ 彙整存活 block findings + advisories → verdict + report
```

**Edge case 處理**：
- 單一 dimension agent 錯誤 → 標記 `dimension_error`，不阻擋其他維度，synthesis report 標注「INCOMPLETE dimensions（coverage gap，非 pass）」
- findings 全為空 → Phase 2/3 跳過，直接回傳 `verdict: "APPROVE"`
- skeptic agent 錯誤 → finding 保留（conservative default）

**所有 agents 均為 prompt-only**（`agent(prompt, { label, schema })`），不指定 `agentType`，避免與 `agents/reviewer.md` 的 system prompt 衝突（詳見 decisions.md Decision 7）。

#### 9.2.2 `workflows/judge-panel.js`（propose Step 3，L3 前置）

propose Step 3 的 Path A，輸入 `{ changeId, changePath, researchFindings, userGoal }`。三份草稿共用 Step 2 researcher 的 `researchFindings`，不各自 re-research。

```
Phase 1 "drafting"
  parallel() ──→ draft:minimal-surface        ─┐
             ──→ draft:robustness-edge-cases   ├─→ 3 份草稿（lens + 四檔內容）
             ──→ draft:team-workflow-DX        ─┘
              ├── 0 份成功 → throw Error（中止）
              └── 1 份成功 → judge 跳過 ranking，仍驗證事實性
                      ↓
Phase 2 "judging"
  parallel() ──→ judge:1  (讀全部草稿 + Read 實際程式碼驗證事實) ─┐
             ──→ judge:2  (同上)                                  ├─→ JudgeVerdict
                      ↓                                          ─┘
              factErrors 彙整（judge 讀實際 code，其 reality 為權威）
              rankings 合併（衝突時 synthesis 自行裁決）
                      ↓
Phase 3 "synthesis"
  agent ──→ 取 ranking 最高草稿 + 修正 factErrors + 吸收 bestIdeas
         ──→ return { proposal, spec, tasks, decisions, openQuestions }
```

**主 agent 負責寫檔**：workflow 回傳四檔內容字串後，由 propose skill 的主 agent 以 Write tool 寫入 change folder——workflow agents 不直接寫 change files（保持「workflow agents 無 filesystem 副作用」的原則）。

#### 9.2.3 Dual-path Fallback 機制

兩個 skill 共用相同判斷邏輯（Decision 6）：

```
if the Workflow tool is in your tool list
  → Path A: 呼叫 Workflow script
else
  → Path B: 退回單一 arceus:reviewer（apply）/ arceus:planner（propose）
```

前置判斷（不是 try-catch）確保 script error 不被誤判為「tool 不可用」，保留 script bug 的可見性。

#### 9.2.4 與 L4 check-spec 的層級關係

L3 multi-agent review 在 `apply` Step 5 執行，**不取代** L4 check-spec audit（Step 5.5）：

| 層 | 執行時機 | 視角 | 目的 |
|---|---|---|---|
| L3 adversarial review | apply Step 5（code 寫好後） | 對抗式多維度（plugin 內部） | 找出 code bug 和 spec 偏差，修了再繼續 |
| L4 check-spec audit | apply Step 5.5（review 通過後） | 獨立第三方 Go binary | 確認整體 spec 符合度，verdict 寫進 meta.json |

兩層互補：L3 是「修 code 的依據」（迭代性，findings 修復後失去獨立意義）；L4 是「PR 審計 trail」（verdict 持久化到 `audit/latest.md`，git-tracked）。

---

## 10. 建議 Repo 結構（Plugin 版）

```
arceus/
├── package.json               # Plugin 設定 + npm 依賴
├── CLAUDE.md                  # Claude Code 入口（自動讀取）
├── AGENTS.md                  # Codex 入口
│
├── src/
│   ├── index.ts               # Plugin 主入口，export hooks
│   ├── hooks/                 # Lifecycle hooks
│   │   ├── session-start.ts   # 載入 .arceus/ 狀態
│   │   ├── prompt-submit.ts   # Magic keyword 偵測 + skill 注入
│   │   ├── pre-tool-use.ts    # 安全檢查
│   │   ├── post-tool-use.ts   # 記錄結果
│   │   ├── subagent-start.ts  # 注入 agent context
│   │   ├── subagent-stop.ts   # 收集結果
│   │   ├── pre-compact.ts     # 保存 notepad
│   │   └── stop.ts            # 保存最終狀態
│   │
│   ├── skills/                # 工作流定義
│   │   ├── autopilot.ts
│   │   ├── plan-and-execute.ts
│   │   ├── code-review.ts
│   │   ├── debug-loop.ts
│   │   ├── task-sync.ts
│   │   ├── deep-analysis.ts
│   │   └── index.ts           # Skill registry
│   │
│   ├── agents/                # Agent 定義
│   │   ├── planner.ts
│   │   ├── coder.ts
│   │   ├── tester.ts
│   │   ├── reviewer.ts
│   │   ├── task-syncer.ts
│   │   └── index.ts           # Agent registry
│   │
│   ├── tools/                 # MCP tools
│   │   ├── state-tools.ts     # .arceus/ 讀寫
│   │   ├── notepad-tools.ts   # Notepad 操作
│   │   ├── memory-tools.ts    # Project memory
│   │   ├── verification-tools.ts  # build/test/lint 執行
│   │   ├── github-tools.ts    # GitHub API 操作
│   │   ├── gitlab-tools.ts    # GitLab API 操作
│   │   ├── plane-tools.ts     # Plane API 操作
│   │   └── index.ts
│   │
│   ├── state/                 # .arceus/ 狀態管理
│   │   ├── notepad.ts
│   │   ├── memory.ts
│   │   ├── session-log.ts
│   │   └── config.ts
│   │
│   └── utils/
│       ├── keyword-detector.ts  # Magic keyword 匹配
│       ├── prompt-injector.ts   # System prompt 注入
│       └── logger.ts
│
├── agents/                    # Agent markdown 定義（Claude Code 讀取）
│   ├── planner.md
│   ├── coder.md
│   ├── tester.md
│   ├── reviewer.md
│   ├── security-reviewer.md
│   ├── task-syncer.md
│   └── researcher.md
│
├── skills/                    # Skill markdown 定義
│   ├── autopilot.md
│   ├── plan-and-execute.md
│   ├── code-review.md
│   ├── debug-loop.md
│   ├── task-sync.md
│   └── deep-analysis.md
│
├── hooks/                     # Hook 設定檔（Claude Code settings 格式）
│   └── hooks.json
│
├── docs/
│   └── architecture/
│       └── arceus-plugin-architecture.md  # 本文件
│
├── tests/
└── .arceus/                   # Runtime 狀態（gitignore）
    ├── config.json
    ├── notepad.md
    ├── memory/
    └── sessions/
```

---

## 11. 與既有 Code 的關係

### 可以保留

| 檔案 | 用途 | 調整 |
|------|------|------|
| `src/types/task.ts` | UnifiedTask 型別 | 簡化，移除 Zod 驗證（改用輕量版） |
| `src/adapters/github/*` | GitHub API 操作 | 改包成 MCP tools |
| `src/utils/retry.ts` | 重試邏輯 | 直接用 |
| `src/utils/dedup.ts` | 去重 | 直接用 |
| `src/utils/logger.ts` | Logger | 直接用 |
| `package.json` | 專案設定 | 大改：移除不需要的依賴 |
| `tsconfig.json` | TypeScript 設定 | 保留 |
| `eslint.config.js` | Lint 設定 | 保留 |

### 需要移除或大改

| 檔案/目錄 | 原因 |
|-----------|------|
| `src/orchestrator/` | 自己寫的 DAG、queue、pool → Plugin 不需要，改用 Claude Code subagent |
| `src/services/model-router.ts` | 自己選 model → 改由 Claude Code 控制 |
| `src/agents/*.ts` | 原本是空殼 class → 改成 markdown 定義 + hook 注入 |
| `src/skills/` | 原本是空 tool 定義 → 改成工作流 markdown |
| `src/services/context-loader.ts` | → 改成 hook 裡的 state 載入 |
| `src/adapters/gitlab/`、`src/adapters/plane/` | → 改包成 MCP tools |

---

## 12. 實作路線

### Phase 0：研究 Claude Code Plugin API ✅ 完成
- [x] 確認 plugin manifest 格式（`.claude-plugin/plugin.json`）
- [x] 確認 hooks 的 API（`hooks/hooks.json`，command type，JSON stdin/stdout）
- [x] 確認 subagent API（`subagent_type="arceus:<name>"`，透過 agent markdown frontmatter 指定 model）
- [x] 確認 MCP tools 的註冊方式（`.mcp.json` 在 plugin manifest 引用；現已改為 plugin.json 內聯——見 13 節第 6 點與 2026-06-11 Decision 2）
- [x] 研究 OMC 的 source code 確認實作細節

### Phase 1：最小可用版本 ✅ 完成
- [x] Plugin manifest + 基本 hooks（session-start, prompt-submit, pre-tool-use, post-tool-use, subagent-stop, stop）
- [x] Magic keyword 偵測（autopilot, review, plan, fix, debug, sync, deep-dive + 中文觸發詞）
- [x] 6 個完整 skill：autopilot, plan-and-execute, code-review, debug-loop, task-sync, deep-analysis
- [x] 6 個 agent 定義：planner, coder, tester, reviewer, task-syncer, researcher
- [x] `.arceus/` 狀態初始化（notepad, session-log, config）
- [x] 驗證系統提醒（subagent-stop hook 注入 verification reminder）
- [x] CLI（`arceus init`, `arceus status`）
- [x] 7 個 unit tests 全部通過
- [x] typecheck + lint + test + build 全部通過

### Phase 2：核心 Skills 進階
- [ ] Notepad 持久化（context compaction 時自動保存到 .arceus/notepad.md）
- [ ] Skill 執行追蹤（在 session log 記錄 skill 進度和結果）
- [ ] 自訂 skill 支援（.arceus/skills/ 覆蓋內建 skill）
- [ ] 失敗自動降級（autopilot 3 輪失敗後報告給使用者）

### Phase 3：外部整合（MCP Tools）
- [ ] GitHub tools（Issues + PR）— 可重用舊 adapter 程式碼
- [ ] GitLab tools（Issues + MR + Pipeline）
- [ ] Plane tools（Tasks + Status）
- [ ] MCP server 實作（dist/mcp-server.js；註冊方式必須用 plugin.json 的 `mcpServers` 內聯欄位 + tsup entry，勿復活根目錄 `.mcp.json`——見 2026-06-11-remove-vestigial-mcp-server-registration Decision 2）
- [ ] `task-sync` skill 接上 MCP tools

### Phase 4：進階功能
- [ ] 更多 agent（security-reviewer, perf-reviewer, architect）
- [ ] Agent team 協作（多 reviewer 同時 review）
- [ ] Session resume（context reset 後恢復工作狀態）
- [ ] Project memory（自動學習 code patterns 和 decisions）

---

## 13. 已解決的研究問題

1. **Plugin manifest** → `.claude-plugin/plugin.json`，含 `name`, `version`, `skills`, `mcpServers` 欄位
2. **Hooks 註冊** → `hooks/hooks.json`，每個 event 可註冊多個 command/http/prompt/agent type handler
3. **Hook 通訊協議** → stdin 接收 JSON（含 session_id, cwd, prompt 等），stdout 輸出 JSON（含 continue, hookSpecificOutput.additionalContext）
4. **Context 注入** → 透過 `additionalContext` 欄位，hook 可注入文字到 Claude 的對話 context
5. **Subagent model 控制** → agent markdown frontmatter 的 `model` 欄位，使用時 `subagent_type="pluginName:agentName"`
6. **MCP tools** → plugin.json 的 `mcpServers` 欄位**內聯**註冊（支援 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` 變數）。根目錄 `.mcp.json` 形式已於 2026-06-11 移除——symlink 安裝下該檔名會被同時當成 plugin 設定與專案設定讀兩次
7. **檔案系統存取** → hook scripts 可自由讀寫檔案，`$CLAUDE_PROJECT_DIR` 和 `$CLAUDE_PLUGIN_ROOT` 環境變數可用
8. **OMC 實作模式** → OMC 用 `scripts/run.cjs` 作為 hook runner，keyword detection + skill injection + state management 全透過 hooks 實現

### 待研究

- Claude Code plugin marketplace 的發布流程
- `$CLAUDE_PLUGIN_DATA` 的確切行為（plugin-specific 持久化目錄）
- Agent team 的 `TeamCreate` / `TaskCreate` API 細節

---

## 14. 設計決策記錄

| 日期 | 決策 | 原因 |
|------|------|------|
| 2026-04-16 | 從 npm SDK 轉向 Claude Code Plugin | 研究 OMC 和 edict 後，認為 Plugin 路線更符合「導入即用」的願景 |
| 2026-04-16 | 採用 OMC 的四層架構（Hooks → Skills → Agents → State） | 經過驗證的設計模式 |
| 2026-04-16 | Agent 定義用 markdown 而非 TypeScript class | 更容易修改、Claude Code 可直接讀取 |
| 2026-04-16 | 保留 Plane/GitLab/GitHub 整合但作為 MCP tools | 符合 Plugin 的工具使用模式 |
