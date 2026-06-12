# Tasks — Integrate ultracode workflow into apply and propose

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。每一項都應該是可獨立驗證的最小步驟。_

## Phase 1 — Workflow script assets

- [x] T-1 建立 `workflows/` 目錄，新增 `workflows/adversarial-review.js`。內容：`export const meta = { name: "adversarial-review", description: "Multi-dimension adversarial code review with skeptic verification", phases: ["dimension-review", "skeptic-verification", "synthesis"] }`，接著 Phase 1 用 `parallel()` 啟動 4 個 dimension agents（spec-compliance / correctness / security / performance），每個**不指定 `agentType`**（純 prompt agent，帶 `label` 和完整 dimension-specific prompt），`schema` 要求回傳 `DimensionFindings` 結構（含 `evidence` 必填欄位）；Phase 2 對每個 severity === "block" 的 finding 用 `parallel()` 啟動 skeptic agent（prompt-only）嘗試反駁；Phase 3 用 synthesis agent 彙整存活 findings 回傳最終 review。空 findings 時 Phase 2/3 直接 `return { verdict: "APPROVE", findings: [] }`。單一 dimension agent 錯誤時標記 `dimension_error`，不阻擋其他維度。**不使用** `Date.now()` / `new Date()` / `Math.random()`
- [x] T-2 新增 `workflows/judge-panel.js`。內容：`export const meta = { name: "judge-panel", description: "Multi-draft adversarial judge panel for proposal synthesis", phases: ["drafting", "judging", "synthesis"] }`，Phase 1 用 `parallel()` 啟動 3 個 drafter agents（**不指定 agentType**，帶 lens prompt：minimal-surface / robustness-edge-cases / team-workflow-DX），接收 `args.researchFindings` 作為輸入；Phase 2 用 `parallel()` 啟動 2 個 judge agents（prompt-only）讀全部草稿 + 實際程式碼驗證事實性宣稱，回傳 `JudgeVerdict`；Phase 3 用 synthesis agent 融合 winner + 修正 factErrors + 吸收 bestIdeas。Drafter 只剩 1 份時跳過 ranking、judge 仍驗證事實性。**不使用** `Date.now()` / `new Date()` / `Math.random()`

## Phase 2 — Hook 基礎建設（keyword-detector placeholder 替換）

- [x] T-3 修改 `src/hooks/keyword-detector.ts` 的 `loadSkillContent()` 函式（第 108-123 行）：在 builtin path 分支（第 116-120 行）的 `readFileSync` 後、`return` 前，加入 `content = content.replaceAll("{{ARCEUS_PLUGIN_ROOT}}", getPluginRoot())`。**不**修改 project-level override 分支（第 110-113 行）。`getPluginRoot()` 已在第 7 行 import

## Phase 3 — Skill 更新

- [x] T-4 改寫 `skills/apply/SKILL.md` Step 5：重組為雙路徑結構。Path A（Workflow available）描述 adversarial review workflow 呼叫，`scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js"` 帶 args `{ changeId, diff, specContent, tasksContent }`，說明 dimension 數量（4）、skeptic 驗證邏輯、存活 findings 的處理、max 3 review rounds。Path B（Fallback）逐字保留現有的單一 `arceus:reviewer` subagent 流程（第 52-57 行原文）。開頭加 Layer 1.5 定位說明。Step 5.5 和 Step 6 不動。確認 frontmatter `agents` 維持 `[coder, tester, reviewer]`。寫完後檢查檔案大小 < 10000 bytes
- [x] T-5 改寫 `skills/propose/SKILL.md` Step 3：重組為雙路徑結構。Path A（Workflow available）描述 judge panel workflow 呼叫，`scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js"` 帶 args `{ changeId, changePath, researchFindings, userGoal }`，說明 drafter 數量（3）、judge 數量（2）、synthesis 邏輯。明確指示「workflow agents 回傳內容，主 agent 用 Write tool 寫入 change files——workflow agents 不直接寫檔」。Path B（Fallback）逐字保留現有的單一 `arceus:planner` subagent 流程（第 38-58 行原文）。Step 2 和 Step 4 不動。確認 frontmatter `agents` 維持 `[planner, researcher]`。寫完後檢查檔案大小 < 8000 bytes

## Phase 4 — package.json 更新

- [x] T-6 在 `package.json` 的 `files` 陣列（第 19-26 行）中，在 `"skills"` 之後加入 `"workflows"`

## Phase 5 — Tests

- [x] T-7 新增 `tests/unit/hooks/keyword-detector-placeholder.test.ts`：mock `readFileSync` 回傳含 `{{ARCEUS_PLUGIN_ROOT}}` 的 SKILL.md 內容、mock `getPluginRoot()` 回傳 `/mock/plugin/root`，assert `loadSkillContent()` 回傳值中 `{{ARCEUS_PLUGIN_ROOT}}` 已被替換成 `/mock/plugin/root`（builtin path case）。第二個 case：模擬 project-level override（`.arceus/skills/*/SKILL.md` 存在），assert 回傳內容中 placeholder 未被替換
- [x] T-8 新增 `tests/unit/workflows/adversarial-review.test.ts`：用 `readFileSync` 讀取 `workflows/adversarial-review.js`，regex-assert `export const meta` 存在且 `name` 為 `"adversarial-review"`，assert `phases` 陣列包含 `["dimension-review", "skeptic-verification", "synthesis"]`；斷言不含 `Date.now()` / `new Date()` / `Math.random()`；斷言不含 `agentType` 字串
- [x] T-9 新增 `tests/unit/workflows/judge-panel.test.ts`：同 T-8 結構，assert `name` 為 `"judge-panel"`，`phases` 包含 `["drafting", "judging", "synthesis"]`；斷言不含禁用 API；斷言不含 `agentType` 字串
- [x] T-10 新增 `tests/unit/workflows/skill-consistency.test.ts`：讀取 `skills/apply/SKILL.md` 和 `skills/propose/SKILL.md`，assert 每個 SKILL.md 中 `{{ARCEUS_PLUGIN_ROOT}}` 出現次數等於 `scriptPath` 引用次數（各 1 次）；assert apply SKILL.md byte size < 10000、propose SKILL.md byte size < 8000

## Phase 6 — Docs 更新

- [x] T-11 更新 `CLAUDE.md` 的 "Evidence-Driven Verification" 段落：整合為**四層模型**（stop-gate change 已先落地三層版）——L1 subagent reminder / L2 stop gate / 新增 L3 multi-agent adversarial review（apply Step 5，Workflow 驅動）/ 原 check-spec 層重編號為 L4。標注 L3 在 Workflow tool 不可用時 fallback 到單一 arceus:reviewer
- [x] T-12 更新 `docs/architecture/arceus-plugin-architecture.md`：在 Section 9.1 之後加 Section 9.2「Workflow 多 Agent 審查：adversarial review 與 judge panel」，說明兩個 workflow 的架構（資料流圖）、Phase 設計、fallback 機制、與 check-spec 的層級關係、`{{ARCEUS_PLUGIN_ROOT}}` placeholder 機制

## Phase 7 — Final verification

- [x] T-13 跑 `npm run verify`：typecheck + lint + test + build 全綠
- [x] T-14 確認 `skills/apply/SKILL.md` 的 Step 5.5 (check-spec) 和 Step 6 (complete) 與 main branch 一致（`git diff main -- skills/apply/SKILL.md` 只應顯示 Step 5 區域的變更）
