# Decisions — Integrate ultracode workflow into apply and propose

## Decision 7: Layer 編號採四層模型（實作期調整，2026-06-11）

- **Context**: 本提案與 `2026-06-11-stop-hook-verification-gate` 由同一個 judge panel 平行起草。本提案的 spec 原以「Layer 1 / 1.5 / 2」描述 CLAUDE.md 驗證層級，但 stop-gate 提案先完成 apply，已把 CLAUDE.md 改為三層模型（L1 subagent reminder / L2 stop gate / L3 check-spec）。照原 spec 字面實作會覆蓋掉 stop-gate 的文件成果。
- **Options considered**: (a) 照 spec 字面寫 Layer 1.5，與現況三層模型並存（編號混亂）；(b) 整合為四層模型，multi-agent review 為 L3，check-spec 重編號為 L4。
- **Chosen**: (b)
- **Rationale**: 攔截時機天然有序——subagent 完成（L1）→ 每回合結束（L2）→ apply review 階段（L3）→ change 完成閘門（L4）。控制力遞增、編號單調，無 1.5 這種插號。spec/AC22/T-11 已同步修訂並記錄於此，維持 spec = 事實。
- **影響**: `skills/apply/SKILL.md` Step 5 標題寫 "Layer 3"、Step 5.5 為 Layer 4；CLAUDE.md 與架構文件以四層表格呈現。

## Decision 8: Harness contract 實測修正 + dogfood 對抗式審查結果（2026-06-11）

- **Context**: 本 change 的 Step 5 review 直接用剛實作的 `workflows/adversarial-review.js` 資產審查本 change 自身（吃自己的狗食）。共跑兩次：第一次 4 個 dimension agent 全因 session limit 失敗——**意外完成了 AC14 的真實故障演練**（workflow 未 crash、全部標記 dimensionErrors、報告明示 coverage gap）；第二次 4 維度全數完成，verdict APPROVE、0 個 block findings、17 個 advisory。
- **Harness contract 實測修正**（與草稿 spec 的假設不同，spec 已同步更新）:
  1. `meta.phases` 是 `{ title, detail }` 物件陣列（title 對應 `phase()` 呼叫），非字串陣列。
  2. `args` global 可能以 JSON 字串形式到達（第一次 judge-panel 起草 run `wf_23b4341b` 即因此失敗）——兩個 script 以 `typeof args === "string" ? JSON.parse(args) : args` 正規化。
  3. `log()` 為可用的進度回報 global，補入 spec 技術假設。
- **依 advisory 修復**（warn 級，全部落地）:
  - skeptic 存活條件由 `!votes[i] || votes[i].survives === true` 改為「只有明確 `survives === false` 才剔除」——原寫法在 skeptic 回傳 error-shaped truthy 值時會**靜默丟棄 finding**，與文件宣稱的 conservative default 相反。
  - 所有 agent thunk 加 `.catch(() => null)` + 回傳值形狀檢查（`Array.isArray(r.findings)` 等）——防禦未知 harness 版本的錯誤形狀，避免單一 agent 失敗 crash 整個 workflow（AC14/AC15 的硬保證）。
  - 全維度失敗時 machine-readable verdict 由 `"APPROVE"` 改為 `"INCOMPLETE"`（report 文字原本就標示 coverage gap，但機讀欄位不可 fail-open）。
  - skeptic fan-out 加硬上限 `SKEPTIC_CAP = 12`（超出部分保守存活），不依賴 agent 遵守「最多 8 個 findings」的指示。
  - judge-panel 全 judge 失敗時 `throw`（synthesis 不可在零事實查核下靜默產出）。
  - `keyword-detector.ts` 的 `replaceAll` 改用 function replacement——字串替換值會解譯 `$$`/`$&` 等 pattern，路徑含 `$` 時會損壞。
  - apply SKILL.md Path A 明確定義 `<base>`（預設 `origin/main`，與 Step 5.5 check-spec 同基準）。
  - 靜態測試強化：抽出 meta literal block，phase title 斷言改在 block 內進行 + 新增 PURE literal 斷言（原寫法對整檔 regex，`phase("...")` 呼叫也能讓測試假綠）。
- **順延（suggest 級，記錄不實作）**: skeptic/synthesis prompt 重複內嵌完整 diff+spec 的 token 最佳化；workflow agent 防寫保證僅靠指示（依賴 harness 權限模型）；review prompt 對 diff 內容的 prompt-injection 邊界（LLM review 固有限制）。
- **Rationale**: dogfood 的價值在此具體化——資產第一次真實執行就暴露了三個 harness contract 假設錯誤與一個會反轉安全預設的邏輯缺陷,全部在 change 完成前修正。

## Decision 1: Script 傳遞機制——plugin-shipped `workflows/*.js` via `scriptPath` + `{{ARCEUS_PLUGIN_ROOT}}` 佔位符替換，且只替換 builtin path

- **Context**: Workflow tool 有三種呼叫方式：(a) inline script string in SKILL.md, (b) `scriptPath` 指向磁碟上的 `.js` 檔, (c) `name` 指向 `.claude/workflows/` 下的 named workflow。SKILL.md 的內容會被 `keyword-detector.ts` 的 `loadSkillContent()` 完整注入到每次 prompt 中（第 174-184 行的 `additionalContext` template）——skill 檔案越大，每次 prompt 的 context 成本越高。目前 apply SKILL.md 4898 bytes、propose SKILL.md 3168 bytes。另外，`loadSkillContent()` 有兩條 return 路徑：project-level override（第 110-113 行）和 plugin builtin（第 116-120 行），placeholder 替換的範圍也是設計選擇。
- **Options considered**:
  - **(a) Inline script in SKILL.md**: 零 TypeScript 改動，workflow script 直接嵌在 SKILL.md 的 code block 中。代價：每次 keyword match 都注入完整 script 到 context（150-200 行 JS），apply SKILL.md 可能膨脹到 12000+ bytes。且 inline script 難以做靜態測試，可讀性差。
  - **(b) Plugin-shipped `workflows/*.js` + scriptPath + placeholder**: 新建 `workflows/` 目錄，兩個 `.js` 檔作為 plugin asset；SKILL.md 只寫 `scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/<name>.js"`。需要在 `loadSkillContent()` 加一行 `replaceAll`。代價：一行 TypeScript 改動 + 對應 unit test。
  - **(c) `arceus init` 複製到 project `.claude/workflows/`**: 用 named invocation（`name: "adversarial-review"`），script 在 init 時複製到 project directory。代價：**版本漂移**——plugin 升級後 project 目錄下的 script 不會自動更新，是 silent failure，最難診斷的失敗模式。
- **Chosen**: **(b)**，且 placeholder 替換**只在 builtin path 分支**執行
- **Rationale**:
  - (b) 的 code 改動量是一行 `replaceAll`（加 test），遠小於 (c) 的 init migration 邏輯。(a) 零 code 但 context bloat 是持續性代價。
  - `getPluginRoot()` 已存在於 `src/hooks/utils.ts`（第 59-61 行），已在 `loadSkillContent()` 同檔案第 7 行 import——不需要引入新依賴。
  - `package.json` 的 `files` 陣列加入 `"workflows"` 即可讓 plugin 安裝時帶上 assets——與現有 `"agents"`、`"skills"` 模式一致。版本永遠跟 plugin 一致，不存在漂移。
  - **Fail mode**：若 `CLAUDE_PLUGIN_ROOT` 未設定，`getPluginRoot()` fallback 到 `process.cwd()`，scriptPath 解析到 `cwd/workflows/...`。在非 plugin 環境下此路徑不存在，但 Workflow tool 也不會在 tool list 中，SKILL.md 的 fallback 路徑自然接管——即使 placeholder 解析錯誤也 fail-open。
  - **只替換 builtin path 的原因**：project-level override（`.arceus/skills/*/SKILL.md`）是使用者自行撰寫的內容，其中的路徑應由作者自行控制。Plugin 不應侵入替換使用者自訂的 SKILL.md 內容。兩條 path 在 runtime 是互斥的（第 111-113 行 return 後不會走到 builtin 分支），語意邊界清晰。
- **Revisit if**: SKILL.md 中需要的 placeholder 數量增加到多個——屆時考慮做通用 template engine 而非逐個 `replaceAll`。或 Claude Code harness 原生支援 plugin workflow 註冊，改用 `{name: ...}` 形式。

## Decision 2: v1 不做 config 化——panel size 和 review dimensions 直接寫在 workflow script 和 SKILL.md 中

- **Context**: adversarial review 的 4 個 dimensions 和 judge panel 的 3 drafters / 2 judges 要不要做成 `.arceus/config.json` 的可配置項？
- **Options considered**:
  - **(a)** 新增 `config.workflows: { panelSize: 3, reviewDimensions: [...], judgeCount: 2 }`，runtime 從 config 讀取
  - **(b)** 直接寫死在 workflow scripts + SKILL.md 中，v1 不做 config
- **Chosen**: **(b)**
- **Rationale**:
  - Config 化意味著要改 `src/state/config.ts` 的 `ArceusProjectConfig` interface + 加 default values + SKILL.md 要讀 config + workflow script 要從 args 接收 config。這是至少 4 個檔案的改動，全是新的 failure surface。
  - v1 需要先驗證「多維度 review / judge panel 本身有沒有用」。先讓 workflow 跑起來收集使用回饋，再決定要不要 config 化。
  - 慣例：check-spec 整合也是在核心功能穩定後才加 config（Decision 2 of that change）。
  - 硬編碼值有根據：4 dimensions 涵蓋主要 review 角度、3 drafters 避免偶數票 tie、2 judges 足以交叉驗證。
- **Revisit if**: 使用者反饋想要更多或更少的 dimensions/drafters；或是 token 成本在小型 changes 上太高需要減少 agent 數量。屆時 script 的 `args` 已包含從 SKILL.md 傳入的所有參數，只需加入 `panelSize` 即可。

## Decision 3: apply Step 3（task implementation fan-out）不在本 change 範圍內

- **Context**: apply Step 3 目前是逐個委託 `arceus:coder`，理論上也可以移入 Workflow 做 `parallel()` fan-out。
- **Options considered**:
  - **(a)** 把 Step 3 也改成 Workflow
  - **(b)** 只改 Step 5（review）和 propose Step 3（drafting）
- **Chosen**: **(b)**
- **Rationale**:
  - Step 5 review 和 propose Step 3 drafting 都是「產出判斷/內容」型工作，天然適合 parallel -> synthesize 模式。Step 3 implementation 是「修改檔案」型工作，parallel execution 有 merge conflict 風險，coder 完成後要回寫 `[x]` 到 tasks.md、commit 策略需考慮——這些 edge cases 足以獨立成一個 change。
  - Scope control：本 change 已涉及 2 個 workflow script + 2 個 SKILL.md 改動 + 1 個 TS 改動 + tests + docs（14 個 tasks）。再加 Step 3 會讓 diff 膨脹，重蹈 check-spec 整合時 dogfood 超 7000 字的覆轍。
  - 同時改三個 Step 的失敗面太大——如果 workflow 行為不如預期，debug 範圍需全看。
- **Revisit if**: v1 上線後使用者要求 task 平行化加速。

## Decision 4: Review findings 不持久化到磁碟——v1 留在對話中

- **Context**: adversarial review 的 findings 要不要寫到 `.arceus/changes/<id>/review/` 讓 PR reviewer 能看到？
- **Options considered**:
  - **(a)** findings 寫到 `.arceus/changes/<id>/review/<timestamp>.md`，類似 check-spec audit 的持久化模式
  - **(b)** findings 留在對話中，主 agent 直接根據 findings 修 code
- **Chosen**: **(b)**
- **Rationale**:
  - 層級分工：PR 審計 trail 是 check-spec audit 的職責（`audit/latest.md` 已 commit 進 git）。Layer 1.5 的 review findings 是**修 code 的依據**，不是 PR review 的依據——它的價值在「引導 fix」，fix 後 findings 就失去意義。重複持久化是冗餘。
  - adversarial review 是迭代性的：findings -> fix -> re-review，每輪的 findings 在修復後失去獨立意義。若全部存檔，`review/` 目錄會累積大量中間產物，PR reviewer 反而被 noise 淹沒。
  - 寫檔意味著 workflow agents 需要 Write tool access 或主 agent 在每輪 review 後手動持久化——前者打破「workflow agents 不寫 change 檔案」的原則，後者增加 SKILL.md 的步驟複雜度。
- **Revisit if**: 團隊反饋想要看 review 歷程來理解「AI 為什麼做了那個 fix」——屆時加持久化。

## Decision 5: Propose drafter agents 消費 researcher 結果（researchFindings），不各自獨立 research

- **Context**: propose Step 2 已有 `arceus:researcher` 收集材料。judge panel 的 3 個 drafter agents 是否也應各自獨立 research？
- **Options considered**:
  - **(a)** 每個 drafter 各自 research（更多視角、但 3x token 成本、3x file read）
  - **(b)** Drafter 共用 Step 2 researcher 的 `researchFindings`（context summary + affected files 清單），drafter 在需要時透過 agent tool access 自行讀取檔案內容
  - **(c)** Drafter 收到完整程式碼內容文本（researcher 讀好的），不自己讀檔——但 args 有大小限制風險
- **Chosen**: **(b)**
- **Rationale**:
  - Step 2 researcher 的職責就是「read affected code, surrounding context, existing conventions」——discovery（找哪些檔案相關）只需做一次。透鏡的差異在**如何組織和取捨 material**，不在**收集什麼 material**。
  - (a) 3x 重複 scan 是浪費。(c) 把大量程式碼文本塞進 `args` 會爆 context。(b) 只傳 summary + 路徑清單，drafter 用 agent tool access 讀取細節。
  - **Edge case**：Step 2 researcher 漏掉的檔案，drafter 也會漏。但 judge 在 Phase 2 讀實際程式碼驗證事實性時會補抓——這是 judge 的設計意義之一。
  - 三份草稿基於相同 researchFindings 的好處：事實前提一致，差異只在設計觀點，judge 能公平比較。
- **Revisit if**: drafter 之間產出差異太小（可能是同一份 researchFindings 限制了探索空間）。

## Decision 6: Workflow fallback 機制——tool list 前置偵測而非 try-catch

- **Context**: 如何偵測 Workflow tool 是否可用？SKILL.md 的指示方式決定了 fallback 語意。
- **Options considered**:
  - **(a)** SKILL.md 中指示 "try calling Workflow; if it returns an error, fall back to..."
  - **(b)** SKILL.md 中指示 "if the Workflow tool is in your tool list, use the workflow path; otherwise use the fallback path"
- **Chosen**: **(b)**
- **Rationale**:
  - **(a) 的致命 failure mode**：Workflow 呼叫可能因為 script error（不是 tool 不存在）而失敗。此時 try-catch 會誤判為「tool 不可用」而 fallback，**掩蓋了 script bug**——這是最差的 failure mode。
  - (b) 是 clean 的前置判斷——Claude Code 的 tool list 在對話開始時就確定（deterministic），SKILL.md 的 if/else 只會走一條路徑。
  - **Edge case**：某些 harness 版本可能把 Workflow tool 列在 tool list 但功能不完整。此時嘗試呼叫 Workflow 得到 error 是真實的「tool 有問題」，主 agent 應報告 error 而非 silent fallback——這是正確的行為。
- **Revisit if**: 發現「tool in list but broken」的情境太頻繁，需要 try-catch + 重試。

## Decision 7: Workflow-internal 角色使用 prompt-only agents，不指定 agentType，不建 agents/*.md

- **Context**: adversarial-review 的 dimension / skeptic / synthesis agents，judge-panel 的 drafter / judge / synthesis agents——要不要建立正式的 `agents/*.md` 定義，或使用已有的 `arceus:reviewer` / `arceus:planner` 作為 agentType？
- **Options considered**:
  - **(a)** 新增 `agents/skeptic.md`、`agents/synthesizer.md`、`agents/drafter.md`、`agents/judge.md`（4 個新 agent 定義）
  - **(b)** 在 workflow script 中的 `agent()` 呼叫指定 `agentType: "arceus:reviewer"` 或 `"arceus:planner"`
  - **(c)** 在 workflow script 中用 `agent(prompt, { label })` 帶完整 prompt 呼叫，不指定 `agentType`
- **Chosen**: **(c)**
- **Rationale**:
  - **(b) 的核心問題**：`agents/reviewer.md` 的 system prompt（第 10-17 行）要求 agent 同時做 Correctness / Security / Performance / Style 四維度 review，並輸出特定的 markdown 格式（Blocking Issues / Non-Blocking Issues / Suggestions + Verdict）。但 dimension agent 只需要**單一維度**的 focused review prompt，且回傳的是 `DimensionFindings` JSON schema。`arceus:reviewer` 的 system prompt 會與 dimension-specific 的 workflow prompt **直接衝突**——「只關注 security」vs「做 Correctness/Security/Performance/Style 四維度 review」，output format 也不相容（markdown verdict vs JSON schema）。
  - **(a)** 的問題：這些角色是 workflow-internal 的，只在 workflow script 內部使用，不被其他 skill 引用。`agents/` 目前 6 個 agent，一次加 4 個增長 66%，且 agent markdown frontmatter 的 `model` 欄位會鎖定這些 workflow-internal 角色的 model，減少靈活性。
  - **(c)** 的 `agent()` prompt 參數足以定義角色行為——prompt 可以很具體（「你的目標是反駁以下 finding，找出它的漏洞」），不需要 markdown 模板。且 prompt-only agents 不被 agent 定義的 system prompt 覆蓋，schema 參數可獨立控制 output format。
- **Revisit if**: prompt-only agents 在實際使用中產出格式不穩定，需要 markdown 模板的 model routing 和 output format 約束——屆時抽出為 `agents/*.md`。

## Decision 8: 本提案自身作為 judge-panel pattern 的 dogfood 先例，不要求額外 demo run

- **Context**: 本提案聲稱自身是透過 judge-panel 模式產出的。實作完成後是否需要另跑一次 demo？
- **Options considered**:
  - **(a)** 本提案品質即為充分證據
  - **(b)** 實作後必須錄製 fresh demo run
  - **(c)** 引用先例 + 實作後 fresh demo
- **Chosen**: **(a)**
- **Rationale**:
  - 本提案的 4 個檔案都是實際可用的產物——如果它們的品質足以通過人類 review 和 check-spec audit，那就是 judge panel 模式有效的最佳證據。
  - 前一個 change（check-spec gate）的 Decision 10 也認定「端到端流程可運作」即為 dogfood 的真正價值。
  - fresh demo run 需要刻意製造 scenario，effort-to-signal 比差——不如觀察後續真實 change 的使用。
  - (b)/(c) 的遞迴問題：demo run 產出的提案又需要被 review，在某處必須 cut the chain。
- **Revisit if**: 人類 review 認為本提案品質低劣——那就是 judge panel 模式無效的反證。
