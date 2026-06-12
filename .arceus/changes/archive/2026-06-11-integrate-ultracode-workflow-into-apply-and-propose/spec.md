# Spec — Integrate ultracode workflow into apply and propose

## 需求描述

### 使用者故事

身為使用 Arceus 的開發者，當我跑 `apply` 的 review 階段（Step 5）時，我希望系統透過**多維度對抗式 review** 來把關——每個維度的 findings 都有獨立 skeptic 嘗試反駁，只有存活的 findings 才 block。這樣我修的 bug 是真的 bug，不是 reviewer 幻覺。

身為使用 Arceus 的開發者，當我跑 `propose` 的草稿階段（Step 3）時，我希望系統透過**多透鏡 judge panel** 來產出提案——平行產生多份草稿、對抗式 judges 驗證聲稱、合成最佳版本。這樣提案品質不被單一視角限制。

當 Workflow tool 不在 tool list 中時，兩個 skill 必須自動退回現有的單一 subagent 流程，行為等同今天。

### 功能列表

#### F1. Workflow script asset: `workflows/adversarial-review.js`（apply Step 5）

Workflow script 遵循 Workflow tool contract：
- `export const meta = { name: "adversarial-review", description: "...", phases: [{ title: "dimension-review", ... }, { title: "skeptic-verification", ... }, { title: "synthesis", ... }] }` -- PURE literal（不含函式呼叫、`Date.now()`、`new Date()`、`Math.random()`）。**實作期修正**：harness 實際 contract 的 `meta.phases` 是 `{ title, detail }` 物件陣列（title 與 `phase()` 呼叫字串對應），非草稿假設的字串陣列——見 Decision 8
- Phase 1 "dimension-review"：使用 `parallel()` 啟動 4 個 dimension agents（spec-compliance、correctness、security、performance）。每個 agent **不指定 `agentType`**（純 prompt agent），prompt 帶有 dimension-specific 指令和 `spec.md` acceptance criteria。`schema` 要求回傳：
```ts
interface DimensionFindings {
  dimension: string;
  findings: Array<{
    severity: "block" | "warn" | "suggest";
    file: string;
    description: string;
    evidence: string; // 必須引用具體 diff hunk 或 spec AC
  }>;
}
```
- Phase 2 "skeptic-verification"：對每個 severity === "block" 的 finding，用 `parallel()` 啟動一個 skeptic agent（prompt-only，不指定 agentType），prompt 為「嘗試反駁這個 finding——如果你能證明它不成立或不嚴重，回傳 survives: false」，`schema` 要求回傳 `{ findingIndex: number, survives: boolean, reasoning: string }`
- Phase 3 "synthesis"：用一個 agent 彙整存活的 findings（`survives === true` 的 block findings + 所有 warn/suggest findings），回傳最終 review 報告
- `args` global 接收 `{ changeId: string, diff: string, specContent: string, tasksContent: string }` -- 由 SKILL.md 指示主 agent 傳入
- Dimension 數量固定為 4；sizing 不在 v1 做 config 化

**Edge case 保護**：
- findings 為空（diff 無問題）-- Phase 2 和 Phase 3 直接跳過，回傳 APPROVE
- skeptic agent 全部反駁所有 block findings -- 最終 verdict 為 APPROVE
- 單一 dimension agent 超時或錯誤 -- 其 findings 標記為 `dimension_error`，不阻擋其他維度，synthesis 報告中標注「未完成維度」
- Script 內禁用 `Date.now()` / `Math.random()` / `new Date()`（resume safety，harness documented）

#### F2. Workflow script asset: `workflows/judge-panel.js`（propose Step 3）

- `export const meta = { name: "judge-panel", description: "...", phases: [{ title: "drafting", ... }, { title: "judging", ... }, { title: "synthesis", ... }] }` -- PURE literal（物件陣列形式，同 F1 的 Decision 8 修正）
- Phase 1 "drafting"：使用 `parallel()` 啟動 3 個 drafter agents（prompt-only，不指定 agentType），每個帶不同設計透鏡 prompt：(1) minimal-surface（最小 diff、最大重用）(2) robustness-edge-cases（邊界條件、錯誤處理、回歸防護）(3) team-workflow-DX（協作體驗、文件清晰度、入門門檻）。Drafter agents 接收 `args.researchFindings`（Step 2 researcher 產出的 context summary + affected files 清單），不各自重複 research。`schema` 要求回傳 `{ lens: string, proposal: string, spec: string, tasks: string, decisions: string }`
- Phase 2 "judging"：使用 `parallel()` 啟動 2 個 judge agents（prompt-only，不指定 agentType），每個讀取**全部 3 份草稿**，並透過 agent tool access **讀取實際程式碼**驗證草稿中的事實性宣稱（file paths、function signatures、config keys），`schema` 要求回傳：
```ts
interface JudgeVerdict {
  rankings: [number, number, number]; // 1-based draft indices, best-first
  factErrors: Array<{ draftIndex: number; claim: string; reality: string }>;
  bestIdeas: Array<{ draftIndex: number; idea: string }>;
}
```
- Phase 3 "synthesis"：一個 agent 讀取排名最高的草稿 + judges 的 factErrors 和 bestIdeas，產出最終版本的 proposal/spec/tasks/decisions 文字內容
- `args` global 接收 `{ changeId: string, changePath: string, researchFindings: string, userGoal: string }`

**Edge case 保護**：
- 單一 drafter 超時或錯誤 -- 以剩餘草稿繼續 judging（最少需 2 份才做 ranking；若只剩 1 份則跳過 ranking 直接採用，judge 仍驗證事實性）
- 兩個 judge 排名完全衝突 -- synthesis agent 收到衝突資訊，自行裁決（不額外輪次）
- `args.researchFindings` 為空 -- drafter agents 依 userGoal 自行探索（不報錯）

#### F3. `src/hooks/keyword-detector.ts` 的 `loadSkillContent()` placeholder 替換

修改 `loadSkillContent()` 函式（第 108-123 行），在 builtin path 分支（第 116-120 行）的 `readFileSync` 後、`return` 前，執行：
```typescript
let content = readFileSync(builtinPath, "utf-8");
content = content.replaceAll("{{ARCEUS_PLUGIN_ROOT}}", getPluginRoot());
return content;
```
- `getPluginRoot()` 已存在於 `src/hooks/utils.ts`（第 59-61 行），已在 keyword-detector.ts 第 7 行 import
- 只替換 `{{ARCEUS_PLUGIN_ROOT}}` 這一個 token——不做通用 template engine
- **只替換 builtin path 分支**（plugin 附帶的 skills），不替換 project-level override 分支（第 110-113 行）——project override 的作者自行控制路徑
- 若 `CLAUDE_PLUGIN_ROOT` 環境變數未設定，`getPluginRoot()` fallback 到 `process.cwd()`——在非 plugin 環境下 scriptPath 可能解析到不存在的路徑，但此時 Workflow tool 不在 tool list 中，SKILL.md 的 fallback 路徑自然接管

#### F4. `skills/apply/SKILL.md` Step 5 改寫

Step 5 改為雙路徑結構：

**Workflow 可用路徑（Path A）**（偵測方式：「if the Workflow tool is in your tool list」前置判斷）：
1. 收集 `git diff <base>...HEAD`、`spec.md` 內容、`tasks.md` 內容
2. 聲明 "Starting adversarial review: 4 dimension reviewers + up to N skeptics"
3. 呼叫 `Workflow({ scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js", args: { changeId, diff, specContent, tasksContent } })`
4. 讀取 synthesis report：若有 surviving block findings -- 修復 -- re-verify（含 Step 4 重跑）-- 最多 3 輪
5. 所有 block findings 解決 -- 繼續 Step 5.5

**Fallback 路徑（Path B）**（Workflow tool 不在 tool list）：
保留現有 Step 5 完整邏輯（delegate to `arceus:reviewer`，review diff against spec.md），一字不改地嵌入。

- Step 5.5 (check-spec audit) 和 Step 6 (completion) 不變
- Step 5 開頭加 Layer 1.5 定位說明（不取代 Layer 1 和 Layer 2）
- frontmatter `agents` 欄位維持 `[coder, tester, reviewer]` 不變（workflow 內部使用 prompt-only agents，不新增 agent 定義）

#### F5. `skills/propose/SKILL.md` Step 3 改寫

Step 3 改為雙路徑結構：

**Workflow 可用路徑（Path A）**：
1. 準備 `researchFindings`（Step 2 researcher 的產出）、userGoal
2. 聲明 "Starting judge panel: 3 drafters + 2 judges + 1 synthesizer"
3. 呼叫 `Workflow({ scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js", args: { changeId, changePath, researchFindings, userGoal } })`
4. 收到 synthesis agent 的合併結果後，**主 agent 自己**用 Write tool 寫入四個 change 檔案——workflow agents 不直接寫 change files
5. 繼續 Step 4（人類 gate）

**Fallback 路徑（Path B）**：
保留現有 Step 3 完整邏輯（delegate to `arceus:planner`），一字不改地嵌入。

- Step 2 (researcher) 不變——drafter agents 消費 researcher 結果，不各自 research
- Step 4 (human gate) 不變
- frontmatter `agents` 欄位維持 `[planner, researcher]` 不變

#### F6. `package.json` files 陣列擴充

在 `files` 陣列（第 19-26 行，目前為 `["dist", ".claude-plugin", "hooks", "agents", "skills", ".mcp.json"]`）加入 `"workflows"`。

#### F7. 文件更新

- `CLAUDE.md`：Evidence-Driven Verification 段落新增 multi-agent review 層。**實作時調整**：本提案與 stop-hook-verification-gate 提案平行起草，後者先落地並把該段落改為三層模型（L1 subagent reminder / L2 stop gate / L3 check-spec）——故本 change 改為**四層模型**：L1 reminder / L2 stop gate（turn-level）/ **L3 multi-agent adversarial review（apply Step 5）** / L4 check-spec audit（change-level），原 L3 check-spec 重編號為 L4（見 decisions.md Decision 7）
- `docs/architecture/arceus-plugin-architecture.md`：在 Section 9.1 之後新增 9.2「Workflow 多 Agent 審查」段落

### 測試限制

Workflow scripts 無法透過 dynamic import 做 unit test——script body 在 import 時就 top-level 呼叫 `agent()`/`phase()`/`parallel()`，這些只在 Workflow tool runtime 中存在。因此測試策略為：

1. **靜態結構測試**：regex-assert `export const meta` 存在且為 PURE literal、`name` 和 `phases` 欄位正確；斷言不含 `Date.now()` / `new Date()` / `Math.random()`
2. **SKILL.md 一致性測試**：assert SKILL.md 中的 `{{ARCEUS_PLUGIN_ROOT}}` 出現次數等於 `scriptPath` 引用次數；assert byte size 在限制內
3. **keyword-detector 替換測試**：mock `readFileSync` 和 `getPluginRoot()`，assert builtin path 的 placeholder 已替換、project-level override 未替換

## 驗收條件

- [ ] **AC1 (workflow assets exist)**: `workflows/adversarial-review.js` 和 `workflows/judge-panel.js` 存在於 repo，且 `export const meta` 為 PURE literal（不含函式呼叫、動態 expression）
- [ ] **AC2 (meta fields)**: `adversarial-review.js` 的 `meta.phases` 之 title 序列為 `dimension-review / skeptic-verification / synthesis`；`judge-panel.js` 為 `drafting / judging / synthesis`（`{ title, detail }` 物件形式——Decision 8；靜態測試斷言 title 出現在 meta literal block 內）
- [ ] **AC3 (no Date/Math.random)**: 兩個 workflow script 中不出現 `Date.now()`、`new Date()`、`Math.random()`（harness resume safety constraint）——靜態測試斷言
- [ ] **AC4 (placeholder substitution - builtin)**: `keyword-detector.ts` 的 `loadSkillContent()` 回傳 builtin skill 文本時，所有 `{{ARCEUS_PLUGIN_ROOT}}` 已被替換為 `getPluginRoot()` 回傳值
- [ ] **AC5 (placeholder no-op - project override)**: `loadSkillContent()` 回傳 project-level override（`.arceus/skills/*/SKILL.md`）時，文本內容不做任何 placeholder 替換
- [ ] **AC6 (apply SKILL.md dual path)**: `skills/apply/SKILL.md` 的 Step 5 包含 "Path A" (Workflow) 和 "Path B" (Fallback) 兩個子段落；Path A 的 scriptPath 引用 `{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js`；Path B 保留完整的單一 `arceus:reviewer` 流程（文字未刪減）
- [ ] **AC7 (propose SKILL.md dual path)**: `skills/propose/SKILL.md` 的 Step 3 包含 "Path A" (Workflow) 和 "Path B" (Fallback) 兩個子段落；Path A 的 scriptPath 引用 `{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js`；Path B 保留完整的單一 `arceus:planner` 流程（文字未刪減）
- [ ] **AC8 (fallback semantics)**: 兩個 SKILL.md 都明確指示「if the Workflow tool is in your tool list」作為前置判斷——fallback 路徑的行為描述等同改動前的完整 Step 5 / Step 3
- [ ] **AC9 (layer model)**: `skills/apply/SKILL.md` Step 5 開頭或附近說明 Layer 1.5 的定位——不取代 Layer 1 (verify) 和 Layer 2 (check-spec)
- [ ] **AC10 (main agent writes files)**: `skills/propose/SKILL.md` 的 workflow 路徑明確指示「主 agent 自己用 Write tool 寫四個 change 檔案」，workflow agents 不寫檔
- [ ] **AC11 (agents header unchanged)**: `skills/apply/SKILL.md` frontmatter 的 `agents` 保留 `[coder, tester, reviewer]`；`skills/propose/SKILL.md` frontmatter 的 `agents` 保留 `[planner, researcher]`
- [ ] **AC12 (package.json)**: `package.json` 的 `files` 陣列包含 `"workflows"`
- [ ] **AC13 (review cap)**: apply SKILL.md Path A 包含最多 3 輪 review round 的明確上限
- [ ] **AC14 (dimension error handling)**: `workflows/adversarial-review.js` 中，單一 dimension agent 錯誤不阻擋其他維度，synthesis report 標注未完成維度
- [ ] **AC15 (drafter degradation)**: `workflows/judge-panel.js` 中，當只有 1 份 drafter 產出時，跳過 ranking 直接採用 + judge 仍驗證事實性
- [ ] **AC16 (no agentType in workflow scripts)**: 兩個 workflow script 中的 `agent()` 呼叫不指定 `agentType` 參數——使用 prompt-only agents
- [ ] **AC17 (evidence field)**: `adversarial-review.js` 的 dimension agent schema 包含 `evidence` 必填欄位（必須引用具體 diff hunk 或 spec AC）
- [ ] **AC18 (SKILL.md size)**: 替換前的 `skills/apply/SKILL.md` 大小不超過 10000 bytes，`skills/propose/SKILL.md` 不超過 8000 bytes（控制 per-prompt context injection 成本）
- [ ] **AC19 (static tests)**: `tests/unit/workflows/` 下存在靜態測試，assert 每個 workflow script 的 `export const meta` 存在、`name`/`phases` 正確、不含 `Date.now()`/`new Date()`/`Math.random()`
- [ ] **AC20 (keyword-detector test)**: `tests/unit/hooks/` 下存在 placeholder 替換測試，覆蓋 builtin path 有替換和 project-level override 無替換兩種情境
- [ ] **AC21 (skill consistency test)**: 靜態測試斷言兩個 SKILL.md 的 `{{ARCEUS_PLUGIN_ROOT}}` 出現次數等於 `scriptPath` 引用次數，且 byte size 在 AC18 限制內
- [ ] **AC22 (CLAUDE.md updated)**: `CLAUDE.md` 的 Evidence-Driven Verification 段落包含四層描述（L1 reminder / L2 stop gate / L3 multi-agent review / L4 check-spec audit），L3 標注 Workflow tool 不可用時 fallback 至單一 `arceus:reviewer`
- [ ] **AC23 (architecture doc updated)**: `docs/architecture/arceus-plugin-architecture.md` 包含 9.2 段落描述 Workflow 整合
- [ ] **AC24 (step 5.5 unchanged)**: `skills/apply/SKILL.md` 的 Step 5.5 (check-spec audit) 和 Step 6 (complete) 與改動前完全一致
- [ ] **AC25 (propose Step 2 unchanged)**: `skills/propose/SKILL.md` 的 Step 2 (Research) 與改動前完全一致
- [ ] **AC26 (verify green)**: `npm run verify` (typecheck + lint + test + build) 全綠
- [ ] **AC27 (dogfood citation)**: `proposal.md` 或 `decisions.md` 引用本提案自身被 judge-panel pattern 產出作為先例證據

## 技術假設

- Workflow tool 的 `scriptPath` 接受絕對路徑指向 plugin 目錄內的 `.js` 檔案——harness 不限制 script 來源必須在 `.claude/workflows/`
- `agent()` 呼叫支援不指定 `agentType` 的純 prompt agent（`agent(prompt, { label, schema })`），此為 workflow-internal 角色的主要呼叫方式
- `agent()` 的 `schema` 參數可指定 JSON schema，agent 的回傳值會被 schema-validated
- `parallel()` 是 barrier——所有 thunks 完成後才繼續；單一 thunk 失敗（agent error/timeout）由 harness 解析為 `null`，不 crash 整個 workflow。實作仍以 `.catch(() => null)` + 回傳值形狀檢查（`Array.isArray` 等）防禦未知 harness 版本的錯誤形狀（dogfood review 修正）
- `log(message)` 為 harness 提供的進度回報 global，與 `agent()` / `parallel()` / `phase()` 同層，可在 script body 中使用
- `args` global 可能以 JSON 字串形式到達（部分 harness 版本實測行為）——兩個 script 開頭以 `typeof args === "string" ? JSON.parse(args) : args` 正規化
- `export const meta` 必須是 PURE literal（不含函式呼叫、`new Date()`、`Math.random()` 等）
- `Date.now()` / `Math.random()` / `new Date()` 在 workflow script body 中會 throw（resume safety）
- Workflow script 無法直接 access filesystem 或 Node API——只能透過 `agent()` 委託 agent 使用 tools
- `process.env["CLAUDE_PLUGIN_ROOT"]` 在 Claude Code 啟動 plugin hooks 時一定會設定——若環境變數缺失（非 plugin context），`getPluginRoot()` fallback 到 `process.cwd()`
- `loadSkillContent()` 是 SKILL.md 注入的唯一入口（`keyword-detector.ts` 第 108-123 行），在此處加 placeholder 替換即可覆蓋所有 builtin skill 注入場景
- SKILL.md 被 keyword-detector 注入到 Claude 的對話 context 中（第 174-184 行的 `additionalContext` template）——skill 檔案越大，每次 prompt injection 的 context 成本越高。目前 apply SKILL.md 4898 bytes、propose SKILL.md 3168 bytes
- 既有 agent 定義（`agents/reviewer.md`、`agents/planner.md`）不需修改——fallback 路徑繼續使用 `arceus:reviewer` 和 `arceus:planner`
- workflow script 不能透過 `import()` 做單元測試（`agent()`/`phase()` 頂層呼叫會執行）——只能做靜態結構斷言
- `replaceAll` 可安全使用（Node 15+，project target 已滿足）
- 不支援 workflow script 內的並行 verify——workflow 內 agent 不應呼叫 `arceus change verify`；只有主對話迴圈的 Step 5.5 呼叫 check-spec
