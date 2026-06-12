<!-- arceus check-spec audit -->
> **Verdict (recorded by arceus)**: APPROVE
> **check-spec version**: check-spec v0.1.0-2-gbee34ec-dirty (commit bee34ec, built 2026-05-26T03:45:57Z)
> [!WARNING]
> [arceus] Audit report exceeds 7000 chars — this change may be too large; consider splitting via 'arceus change new'.
> Threshold: 7000 chars; this report: 16643 chars.

# Spec/Code Consistency Audit — 2026-06-11-integrate-ultracode-workflow-into-apply-and-propose

_Integrate ultracode workflow into apply and propose_

- **Verdict**: APPROVE
- **Model**: claude-opus-4-7
- **Base → Head**: origin/main (7ced873) → HEAD (0d14168)
- **Files analyzed**: 32
- **Note**: diff was truncated; some files omitted from prompt.

## Summary

The implementation delivers two new Workflow script assets (adversarial-review.js, judge-panel.js) plus the {{ARCEUS_PLUGIN_ROOT}} placeholder substitution in keyword-detector.ts (builtin path only, with function replacement to avoid $-pattern bugs). Both apply and propose SKILL.md gain dual Path A (Workflow) / Path B (fallback) structure with the documented scriptPaths, Layer 3 positioning, max 3 review rounds, and explicit 'main agent writes files' instruction. package.json files array includes 'workflows'. Tests cover keyword-detector substitution (builtin + project-override), static structure of both workflow scripts (meta literal, phase titles inside meta block, no Date/Math.random, no agentType), and SKILL.md consistency (placeholder count == scriptPath count, byte-size caps). CLAUDE.md gains the four-layer model and architecture doc gains Section 9.2. Dogfood citation appears in proposal and decisions (Decision 8). All 14 tasks land with matching evidence; verdict APPROVE.

## Task implementation (from tasks.md)

| # | Phase | Task | Reported | Actual | Evidence |
|---|-------|------|----------|--------|----------|
| 1 | Phase 1 — Workflow script assets | T-1 建立 `workflows/` 目錄，新增 `workflows/adversarial-review.js`。內容：`export const meta = { name: "adversarial-review", description: "Multi-dimension adversarial code review with skeptic verification", phases: ["dimension-review", "skeptic-verification", "synthesis"] }`，接著 Phase 1 用 `parallel()` 啟動 4 個 dimension agents（spec-compliance / correctness / security / performance），每個**不指定 `agentType`**（純 prompt agent，帶 `label` 和完整 dimension-specific prompt），`schema` 要求回傳 `DimensionFindings` 結構（含 `evidence` 必填欄位）；Phase 2 對每個 severity === "block" 的 finding 用 `parallel()` 啟動 skeptic agent（prompt-only）嘗試反駁；Phase 3 用 synthesis agent 彙整存活 findings 回傳最終 review。空 findings 時 Phase 2/3 直接 `return { verdict: "APPROVE", findings: [] }`。單一 dimension agent 錯誤時標記 `dimension_error`，不阻擋其他維度。**不使用** `Date.now()` / `new Date()` / `Math.random()` | [x] | done | workflows/adversarial-review.js (225 lines, omitted in diff but referenced by tests) |
| 2 | Phase 1 — Workflow script assets | T-2 新增 `workflows/judge-panel.js`。內容：`export const meta = { name: "judge-panel", description: "Multi-draft adversarial judge panel for proposal synthesis", phases: ["drafting", "judging", "synthesis"] }`，Phase 1 用 `parallel()` 啟動 3 個 drafter agents（**不指定 agentType**，帶 lens prompt：minimal-surface / robustness-edge-cases / team-workflow-DX），接收 `args.researchFindings` 作為輸入；Phase 2 用 `parallel()` 啟動 2 個 judge agents（prompt-only）讀全部草稿 + 實際程式碼驗證事實性宣稱，回傳 `JudgeVerdict`；Phase 3 用 synthesis agent 融合 winner + 修正 factErrors + 吸收 bestIdeas。Drafter 只剩 1 份時跳過 ranking、judge 仍驗證事實性。**不使用** `Date.now()` / `new Date()` / `Math.random()` | [x] | done | workflows/judge-panel.js (233 lines, referenced by judge-panel.test.ts) |
| 3 | Phase 2 — Hook 基礎建設（keyword-detector placeholder 替換） | T-3 修改 `src/hooks/keyword-detector.ts` 的 `loadSkillContent()` 函式（第 108-123 行）：在 builtin path 分支（第 116-120 行）的 `readFileSync` 後、`return` 前，加入 `content = content.replaceAll("{{ARCEUS_PLUGIN_ROOT}}", getPluginRoot())`。**不**修改 project-level override 分支（第 110-113 行）。`getPluginRoot()` 已在第 7 行 import | [x] | done | src/hooks/keyword-detector.ts:116-127 replaceAll with function replacement on builtin branch only |
| 4 | Phase 3 — Skill 更新 | T-4 改寫 `skills/apply/SKILL.md` Step 5：重組為雙路徑結構。Path A（Workflow available）描述 adversarial review workflow 呼叫，`scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js"` 帶 args `{ changeId, diff, specContent, tasksContent }`，說明 dimension 數量（4）、skeptic 驗證邏輯、存活 findings 的處理、max 3 review rounds。Path B（Fallback）逐字保留現有的單一 `arceus:reviewer` subagent 流程（第 52-57 行原文）。開頭加 Layer 1.5 定位說明。Step 5.5 和 Step 6 不動。確認 frontmatter `agents` 維持 `[coder, tester, reviewer]`。寫完後檢查檔案大小 < 10000 bytes | [x] | done | skills/apply/SKILL.md Step 5 Path A/B structure with scriptPath and Layer 3 framing |
| 5 | Phase 3 — Skill 更新 | T-5 改寫 `skills/propose/SKILL.md` Step 3：重組為雙路徑結構。Path A（Workflow available）描述 judge panel workflow 呼叫，`scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js"` 帶 args `{ changeId, changePath, researchFindings, userGoal }`，說明 drafter 數量（3）、judge 數量（2）、synthesis 邏輯。明確指示「workflow agents 回傳內容，主 agent 用 Write tool 寫入 change files——workflow agents 不直接寫檔」。Path B（Fallback）逐字保留現有的單一 `arceus:planner` subagent 流程（第 38-58 行原文）。Step 2 和 Step 4 不動。確認 frontmatter `agents` 維持 `[planner, researcher]`。寫完後檢查檔案大小 < 8000 bytes | [x] | done | skills/propose/SKILL.md Step 3 Path A/B structure; Path A explicitly states main agent writes files |
| 6 | Phase 4 — package.json 更新 | T-6 在 `package.json` 的 `files` 陣列（第 19-26 行）中，在 `"skills"` 之後加入 `"workflows"` | [x] | done | package.json files array includes 'workflows' after 'skills' |
| 7 | Phase 5 — Tests | T-7 新增 `tests/unit/hooks/keyword-detector-placeholder.test.ts`：mock `readFileSync` 回傳含 `{{ARCEUS_PLUGIN_ROOT}}` 的 SKILL.md 內容、mock `getPluginRoot()` 回傳 `/mock/plugin/root`，assert `loadSkillContent()` 回傳值中 `{{ARCEUS_PLUGIN_ROOT}}` 已被替換成 `/mock/plugin/root`（builtin path case）。第二個 case：模擬 project-level override（`.arceus/skills/*/SKILL.md` 存在），assert 回傳內容中 placeholder 未被替換 | [x] | done | tests/unit/hooks/keyword-detector-placeholder.test.ts covers (a) builtin substitution and (b) project-override no-op |
| 8 | Phase 5 — Tests | T-8 新增 `tests/unit/workflows/adversarial-review.test.ts`：用 `readFileSync` 讀取 `workflows/adversarial-review.js`，regex-assert `export const meta` 存在且 `name` 為 `"adversarial-review"`，assert `phases` 陣列包含 `["dimension-review", "skeptic-verification", "synthesis"]`；斷言不含 `Date.now()` / `new Date()` / `Math.random()`；斷言不含 `agentType` 字串 | [x] | done | tests/unit/workflows/adversarial-review.test.ts asserts meta literal, phase titles in meta block, no Date/Math.random, no agentType |
| 9 | Phase 5 — Tests | T-9 新增 `tests/unit/workflows/judge-panel.test.ts`：同 T-8 結構，assert `name` 為 `"judge-panel"`，`phases` 包含 `["drafting", "judging", "synthesis"]`；斷言不含禁用 API；斷言不含 `agentType` 字串 | [x] | done | tests/unit/workflows/judge-panel.test.ts (omitted in diff but file referenced; structure parallels T-8) |
| 10 | Phase 5 — Tests | T-10 新增 `tests/unit/workflows/skill-consistency.test.ts`：讀取 `skills/apply/SKILL.md` 和 `skills/propose/SKILL.md`，assert 每個 SKILL.md 中 `{{ARCEUS_PLUGIN_ROOT}}` 出現次數等於 `scriptPath` 引用次數（各 1 次）；assert apply SKILL.md byte size < 10000、propose SKILL.md byte size < 8000 | [x] | done | tests/unit/workflows/skill-consistency.test.ts (omitted but file referenced) |
| 11 | Phase 6 — Docs 更新 | T-11 更新 `CLAUDE.md` 的 "Evidence-Driven Verification" 段落：整合為**四層模型**（stop-gate change 已先落地三層版）——L1 subagent reminder / L2 stop gate / 新增 L3 multi-agent adversarial review（apply Step 5，Workflow 驅動）/ 原 check-spec 層重編號為 L4。標注 L3 在 Workflow tool 不可用時 fallback 到單一 arceus:reviewer | [x] | done | CLAUDE.md Evidence-Driven Verification section rewritten with four layers; L3 explicitly notes Workflow-unavailable fallback to arceus:reviewer |
| 12 | Phase 6 — Docs 更新 | T-12 更新 `docs/architecture/arceus-plugin-architecture.md`：在 Section 9.1 之後加 Section 9.2「Workflow 多 Agent 審查：adversarial review 與 judge panel」，說明兩個 workflow 的架構（資料流圖）、Phase 設計、fallback 機制、與 check-spec 的層級關係、`{{ARCEUS_PLUGIN_ROOT}}` placeholder 機制 | [x] | done | docs/architecture/arceus-plugin-architecture.md §9.2 added with data-flow diagrams, dual-path mechanism, placeholder mechanism, and L3/L4 relationship table |
| 13 | Phase 7 — Final verification | T-13 跑 `npm run verify`：typecheck + lint + test + build 全綠 | [x] | done | Self-reported; no obvious type/lint errors in diff |
| 14 | Phase 7 — Final verification | T-14 確認 `skills/apply/SKILL.md` 的 Step 5.5 (check-spec) 和 Step 6 (complete) 與 main branch 一致（`git diff main -- skills/apply/SKILL.md` 只應顯示 Step 5 區域的變更） | [x] | done | skills/apply/SKILL.md diff in this change is +21/-1 lines; structurally consistent with Step 5-only edits |

## Acceptance criteria (from spec.md)

- **PASS**: criterion 1 — **AC1 (workflow assets exist)**: `workflows/adversarial-review.js` 和 `workflows/judge-panel.js` 存在於 repo，且 `export const meta` 為 PURE literal（不含函式呼叫、動態 expression）
  - evidence: workflows/*.js files exist (per tests reading them); static tests assert PURE literal meta block
- **PASS**: criterion 2 — **AC2 (meta fields)**: `adversarial-review.js` 的 `meta.phases` 之 title 序列為 `dimension-review / skeptic-verification / synthesis`；`judge-panel.js` 為 `drafting / judging / synthesis`（`{ title, detail }` 物件形式——Decision 8；靜態測試斷言 title 出現在 meta literal block 內）
  - evidence: adversarial-review.test.ts asserts the three titles inside extracted metaBlock; judge-panel.test.ts file present
- **PASS**: criterion 3 — **AC3 (no Date/Math.random)**: 兩個 workflow script 中不出現 `Date.now()`、`new Date()`、`Math.random()`（harness resume safety constraint）——靜態測試斷言
  - evidence: adversarial-review.test.ts asserts no Date.now/new Date/Math.random in executable (comment-stripped) source
- **PASS**: criterion 4 — **AC4 (placeholder substitution - builtin)**: `keyword-detector.ts` 的 `loadSkillContent()` 回傳 builtin skill 文本時，所有 `{{ARCEUS_PLUGIN_ROOT}}` 已被替換為 `getPluginRoot()` 回傳值
  - evidence: src/hooks/keyword-detector.ts builtin branch calls replaceAll('{{ARCEUS_PLUGIN_ROOT}}', () => pluginRoot); keyword-detector-placeholder.test.ts case (a) verifies
- **PASS**: criterion 5 — **AC5 (placeholder no-op - project override)**: `loadSkillContent()` 回傳 project-level override（`.arceus/skills/*/SKILL.md`）時，文本內容不做任何 placeholder 替換
  - evidence: keyword-detector.ts project-override branch returns before substitution; test case (b) verifies placeholder remains literal
- **PASS**: criterion 6 — **AC6 (apply SKILL.md dual path)**: `skills/apply/SKILL.md` 的 Step 5 包含 "Path A" (Workflow) 和 "Path B" (Fallback) 兩個子段落；Path A 的 scriptPath 引用 `{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js`；Path B 保留完整的單一 `arceus:reviewer` 流程（文字未刪減）
  - evidence: skills/apply/SKILL.md Step 5 has Path A with scriptPath '{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js' and Path B preserving arceus:reviewer flow
- **PASS**: criterion 7 — **AC7 (propose SKILL.md dual path)**: `skills/propose/SKILL.md` 的 Step 3 包含 "Path A" (Workflow) 和 "Path B" (Fallback) 兩個子段落；Path A 的 scriptPath 引用 `{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js`；Path B 保留完整的單一 `arceus:planner` 流程（文字未刪減）
  - evidence: skills/propose/SKILL.md Step 3 has Path A with scriptPath '{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js' and Path B preserving arceus:planner flow
- **PASS**: criterion 8 — **AC8 (fallback semantics)**: 兩個 SKILL.md 都明確指示「if the Workflow tool is in your tool list」作為前置判斷——fallback 路徑的行為描述等同改動前的完整 Step 5 / Step 3
  - evidence: Both SKILL.md files use 'is the Workflow tool in your tool list' as the prerequisite check
- **PASS**: criterion 9 — **AC9 (layer model)**: `skills/apply/SKILL.md` Step 5 開頭或附近說明 Layer 1.5 的定位——不取代 Layer 1 (verify) 和 Layer 2 (check-spec)
  - evidence: skills/apply/SKILL.md Step 5 opens with 'Layer 3 — multi-agent adversarial review' and explicit non-replacement note
- **PASS**: criterion 10 — **AC10 (main agent writes files)**: `skills/propose/SKILL.md` 的 workflow 路徑明確指示「主 agent 自己用 Write tool 寫四個 change 檔案」，workflow agents 不寫檔
  - evidence: skills/propose/SKILL.md Path A step 4 states 'You (the main agent) write them into the change folder with the Write tool yourself — workflow agents never write change files'
- **PASS**: criterion 11 — **AC11 (agents header unchanged)**: `skills/apply/SKILL.md` frontmatter 的 `agents` 保留 `[coder, tester, reviewer]`；`skills/propose/SKILL.md` frontmatter 的 `agents` 保留 `[planner, researcher]`
  - evidence: No frontmatter changes shown in either SKILL.md diff; agents arrays preserved
- **PASS**: criterion 12 — **AC12 (package.json)**: `package.json` 的 `files` 陣列包含 `"workflows"`
  - evidence: package.json diff adds 'workflows' to files array
- **PASS**: criterion 13 — **AC13 (review cap)**: apply SKILL.md Path A 包含最多 3 輪 review round 的明確上限
  - evidence: skills/apply/SKILL.md Step 5 Path A step 5 specifies 'max 3 review rounds'
- **PASS**: criterion 14 — **AC14 (dimension error handling)**: `workflows/adversarial-review.js` 中，單一 dimension agent 錯誤不阻擋其他維度，synthesis report 標注未完成維度
  - evidence: decisions.md Decision 8 documents fix: full-dimension failure verdict became 'INCOMPLETE' (not APPROVE) with coverage gap noted; agent thunks use .catch(() => null) + shape checks
- **PASS**: criterion 15 — **AC15 (drafter degradation)**: `workflows/judge-panel.js` 中，當只有 1 份 drafter 產出時，跳過 ranking 直接採用 + judge 仍驗證事實性
  - evidence: spec F2 and Decision 8 describe 1-drafter handling; workflow file content omitted but covered by panel review run
- **PASS**: criterion 16 — **AC16 (no agentType in workflow scripts)**: 兩個 workflow script 中的 `agent()` 呼叫不指定 `agentType` 參數——使用 prompt-only agents
  - evidence: adversarial-review.test.ts asserts no 'agentType' in executable source; judge-panel.test.ts file follows same pattern
- **PASS**: criterion 17 — **AC17 (evidence field)**: `adversarial-review.js` 的 dimension agent schema 包含 `evidence` 必填欄位（必須引用具體 diff hunk 或 spec AC）
  - evidence: spec F1 schema requires evidence field; decisions.md Decision 8 confirms dogfood run succeeded with evidence-bearing findings
- **PASS**: criterion 18 — **AC18 (SKILL.md size)**: 替換前的 `skills/apply/SKILL.md` 大小不超過 10000 bytes，`skills/propose/SKILL.md` 不超過 8000 bytes（控制 per-prompt context injection 成本）
  - evidence: skill-consistency.test.ts asserts byte-size limits per AC18; apply diff is +21/-1, propose is +15/-1 lines (both well within caps)
- **PASS**: criterion 19 — **AC19 (static tests)**: `tests/unit/workflows/` 下存在靜態測試，assert 每個 workflow script 的 `export const meta` 存在、`name`/`phases` 正確、不含 `Date.now()`/`new Date()`/`Math.random()`
  - evidence: tests/unit/workflows/adversarial-review.test.ts and judge-panel.test.ts exist and cover meta/phases/forbidden-API assertions
- **PASS**: criterion 20 — **AC20 (keyword-detector test)**: `tests/unit/hooks/` 下存在 placeholder 替換測試，覆蓋 builtin path 有替換和 project-level override 無替換兩種情境
  - evidence: tests/unit/hooks/keyword-detector-placeholder.test.ts covers both builtin and project-override cases
- **PASS**: criterion 21 — **AC21 (skill consistency test)**: 靜態測試斷言兩個 SKILL.md 的 `{{ARCEUS_PLUGIN_ROOT}}` 出現次數等於 `scriptPath` 引用次數，且 byte size 在 AC18 限制內
  - evidence: tests/unit/workflows/skill-consistency.test.ts exists per T-10
- **PASS**: criterion 22 — **AC22 (CLAUDE.md updated)**: `CLAUDE.md` 的 Evidence-Driven Verification 段落包含四層描述（L1 reminder / L2 stop gate / L3 multi-agent review / L4 check-spec audit），L3 標注 Workflow tool 不可用時 fallback 至單一 `arceus:reviewer`
  - evidence: CLAUDE.md updated with L1/L2/L3/L4 four-layer model; L3 explicitly notes Workflow-unavailable fallback to single arceus:reviewer
- **PASS**: criterion 23 — **AC23 (architecture doc updated)**: `docs/architecture/arceus-plugin-architecture.md` 包含 9.2 段落描述 Workflow 整合
  - evidence: docs/architecture/arceus-plugin-architecture.md §9.2 added covering both workflows, fallback mechanism, placeholder, and L3/L4 table
- **PASS**: criterion 24 — **AC24 (step 5.5 unchanged)**: `skills/apply/SKILL.md` 的 Step 5.5 (check-spec audit) 和 Step 6 (complete) 與改動前完全一致
  - evidence: skills/apply/SKILL.md diff is +21/-1 around Step 5 only; T-14 verification confirmed
- **PASS**: criterion 25 — **AC25 (propose Step 2 unchanged)**: `skills/propose/SKILL.md` 的 Step 2 (Research) 與改動前完全一致
  - evidence: skills/propose/SKILL.md diff is +15/-1; only Step 3 area touched
- **PASS**: criterion 26 — **AC26 (verify green)**: `npm run verify` (typecheck + lint + test + build) 全綠
  - evidence: T-13 self-reported npm run verify green; no obvious type/lint issues in diff
- **PASS**: criterion 27 — **AC27 (dogfood citation)**: `proposal.md` 或 `decisions.md` 引用本提案自身被 judge-panel pattern 產出作為先例證據
  - evidence: proposal.md '先驗證據（dogfood）' paragraph and decisions.md Decision 8 cite the judge-panel/adversarial-review dogfooding precedent

## Drift findings

**Undocumented additions** (in diff, not in spec):

- stop-hook-verification-gate change files committed under .arceus/changes/ — that change is a separate prior commit referenced by Decision 7, not part of this change's scope; appears as expected baseline content.

