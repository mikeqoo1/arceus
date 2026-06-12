# Integrate ultracode workflow into apply and propose

## 為什麼 (Why)

目前 `apply` 和 `propose` 兩個核心 skill 的品質把關都依賴**單一 subagent**：

- `skills/apply/SKILL.md` Step 5 把 review 委託給一個 `arceus:reviewer`（第 52-57 行）。一個 reviewer 只有一個視角——它的盲點就是流程的盲點。而且 reviewer 的 finding 沒有被獨立驗證：如果 reviewer 幻覺出一個不存在的 bug，主 agent 就浪費時間「修」不存在的問題；反之如果 reviewer 遺漏了真正的問題，在 check-spec 外部稽核（Step 5.5 / Layer 2）之前，沒有任何機制過濾低品質 findings。
- `skills/propose/SKILL.md` Step 3 把提案草稿委託給一個 `arceus:planner`（第 38-58 行）。一個 planner 只能從一個設計透鏡看問題——它不會自然地考慮替代設計、邊界條件、或 DX 取捨。

Claude Code 的 **Workflow tool**（deterministic multi-agent orchestration）正好解決這兩個問題：

- **apply Step 5 可以變成多維度對抗式 review**：平行啟動多個 dimension agent（spec-compliance、correctness、security、performance），每個 dimension 的 findings 再由獨立的 skeptic agent 嘗試**反駁**——只有存活的 findings 才 block completion。這消除了 reviewer 幻覺的問題。
- **propose Step 3 可以變成 judge panel**：平行產生 3 個來自不同透鏡的草稿，再由對抗式 judges 讀程式碼驗證草稿中的聲稱，最後由 synthesis agent 融合最佳部分。這消除了單一視角的問題。

**先驗證據（dogfood）**：本提案自身就是透過 judge-panel 模式產出的——多份草稿、對抗式評審、合成最終版本。這證明模式在 propose 場景下可運作。

**向下相容原則**：Workflow tool 不保證在所有環境都可用（舊版 Claude Code、其他 harness）。兩個 skill 都必須保留完整的 fallback 路徑——當 tool list 中沒有 Workflow tool 時，退回現有的單一 subagent 流程，行為等同今天。

### 設計原則

- **MINIMAL SURFACE**：最小可能的 diff、最大程度重用現有機制，最低回歸風險，最快可交付。積極砍 nice-to-have，可延後的一律延後。
- **不取代 check-spec**：workflow 多維度 review 是 Layer 1.5（內部多 agent），check-spec 是 Layer 2（外部獨立 binary）。兩層都跑，三層共存互不取代。
- **Workflow agents 不寫 change files**：workflow 內的 agent 回傳內容（structured JSON 或文字），主 agent 負責寫入 `.arceus/changes/<id>/`——維持 PreToolUse preflight 和 human-gate 語意在主迴圈中。
- **Tool list 前置偵測**：SKILL.md 指示「if the Workflow tool is in your tool list」做前置判斷，不使用 try-catch fallback——避免 script error 被誤判為 tool 不存在，掩蓋 script bug。
- **Prompt-only workflow agents**：workflow 內部的 dimension / skeptic / drafter / judge / synthesis 角色不指定 `agentType`，使用 `agent(prompt, { label })` 帶完整 prompt。原因是 `agents/reviewer.md` 的 system prompt 要求「同時審查 Correctness / Security / Performance / Style 四維度」（第 14-17 行），與 dimension agent 只需單一維度 focused review 的設計直接衝突。

### 層級模型重述

| Layer | 名稱 | 機制 | 目的 |
|---|---|---|---|
| Layer 1 | Self-verification | `npm run verify` (typecheck/lint/test/build) | 證明程式碼能編譯且測試通過 |
| **Layer 1.5** | **Workflow adversarial review** | Workflow tool 多維度 review + skeptic 反駁 | **證明 review findings 是真實的，消除 reviewer 幻覺** |
| Layer 2 | Independent audit (check-spec) | 外部 Go binary 作為第三方 judge | 證明程式碼有解決 spec 寫的問題 |

## 範圍 (Scope)

- **In scope**:
  - 新增 `workflows/` 目錄存放兩個 Workflow script assets：`adversarial-review.js`（apply Step 5）、`judge-panel.js`（propose Step 3）
  - `package.json` 的 `files` 陣列（第 19-26 行）加入 `"workflows"`
  - 修改 `src/hooks/keyword-detector.ts` 的 `loadSkillContent()` 函式（第 108-123 行）：在 builtin path 分支回傳前，將文字中的 `{{ARCEUS_PLUGIN_ROOT}}` 佔位符替換成 `getPluginRoot()` 回傳的絕對路徑；project-level override 分支不做替換
  - 修改 `skills/apply/SKILL.md`：Step 5 重寫為「若 Workflow tool 在 tool list 中則呼叫 `adversarial-review.js`；否則 fallback 到現有 `arceus:reviewer` 單一 subagent 流程（完整保留）」
  - 修改 `skills/propose/SKILL.md`：Step 3 重寫為「若 Workflow tool 在 tool list 中則呼叫 `judge-panel.js`；否則 fallback 到現有 `arceus:planner` 單一 subagent 流程（完整保留）」
  - 兩個 SKILL.md 中的 `scriptPath` 使用 `{{ARCEUS_PLUGIN_ROOT}}/workflows/<name>.js`
  - 對 keyword-detector 佔位符替換的 unit test（含 builtin 有替換、project-level override 無替換兩種情境）
  - 對 workflow script assets 的靜態測試（regex-assert `export const meta` 存在、禁用 API 不出現）
  - SKILL.md 的 placeholder 一致性測試和 byte size 測試
  - 更新 `CLAUDE.md`：Evidence-Driven Verification 段落加入 Layer 1.5 說明
  - 更新 `docs/architecture/arceus-plugin-architecture.md`：加入 Workflow 整合段落

- **Out of scope**（留給後續 changes）:
  - apply Step 3（task implementation fan-out）移入 Workflow——目前的單一 `arceus:coder` + 手動平行化夠用，diff 收益不足
  - `.arceus/config.json` 新增 `workflows` config block（panel size、review dimensions 等）——v1 直接在 SKILL.md 和 workflow script 中寫死預設值，觀察使用後再決定需不需要 config 化
  - 將 review findings 持久化到 `.arceus/changes/<id>/review/` 資料夾——v1 findings 留在對話中，主 agent 依據 findings 修改程式碼即可
  - Workflow script 的 runtime 測試（`agent()`/`phase()` 在 import 時就 top-level 執行，無法 dynamic import 做 unit test）——僅做靜態測試
  - 新的 agent 定義（`agents/skeptic.md`、`agents/drafter.md` 等）——v1 用 prompt-only agents
  - `review-change` skill 的 workflow 化
  - Agent 數量動態縮放（依 change 大小調整維度數）——v1 固定 4 dimensions / 3 drafters / 2 judges

## Stakeholders

- **Owner**: @mikeqoo1（Arceus 專案作者）
- **Primary user**: 所有使用 `apply` 和 `propose` skill 的 Arceus 使用者
- **Affected contract**: Workflow tool 的 `scriptPath` + `agent()` + `parallel()` API 是 Claude Code harness 提供的 contract；若 API 改變需同步調整
- **External dependency**: 無新增外部 binary（不同於 check-spec 整合）；Workflow tool 由 Claude Code harness 內建
