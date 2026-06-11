# Decisions — Remove vestigial MCP server registration

## Decision 1: 移除殘骸，而非保留空檔或補實作

- **Context**: `.mcp.json` 註冊的 `dist/mcp-server.js` 從未被實作（無 src、無 tsup entry、架構文件 Phase 3 checkbox 未勾）。三個選項。
- **Options considered**:
  - (a) 保留空的 `.mcp.json`（commit 使用者目前的本機清空版）+ plugin.json 維持引用
  - (b) 趁機實作真正的 arceus-state MCP server
  - (c) 移除 `.mcp.json` 與 plugin.json 的引用，留決策紀錄 + regression test
- **Chosen**: (c)
- **Rationale**: (a) 留下雙重身分檔案——任何人往裡面加 server 就重現 symlink 雙重讀取問題，且空檔案本身就是困惑來源。(b) 是架構文件 Phase 3 的既有規劃，scope 完全不同（需要設計 state tools API），不該搭便車。(c) 讓 repo 反映事實：目前沒有 MCP server。

## Decision 2: 未來的 MCP server 必須用 plugin.json 內聯註冊，不得復活根目錄 `.mcp.json`

- **Context**: 官方 plugins 文件確認 `plugin.json` 的 `mcpServers` 欄位接受內聯物件（含 `${CLAUDE_PLUGIN_ROOT}` 變數）。根目錄 `.mcp.json` 在 symlink/dev 安裝下有 plugin 設定 + 專案設定雙重身分。
- **Chosen**: 將來實作 arceus-state server 時，在 `.claude-plugin/plugin.json` 內聯：
  ```json
  "mcpServers": {
    "arceus-state": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js"],
      "env": { "ARCEUS_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}" }
    }
  }
  ```
  且 tsup 必須有對應 entry、`tests/unit/plugin-manifest.test.ts` 的死引用 guard 必須同步更新。
- **Rationale**: 內聯形式不佔用專案層檔名，symlink 安裝免疫雙重讀取；regression test 會在根目錄 `.mcp.json` 重現時失敗並指向本決策。

## Decision 3: Stacked branch（基於 propose/issue-4-followups），不從 main 分出

- **Context**: 本 change 修改 `package.json` files 陣列；PR #8 在同一個陣列相鄰行加了 `"workflows"`。
- **Options considered**: (a) 從 main 分出（兩個 PR 在 files 陣列產生 textual conflict）；(b) stacked 在 PR #8 分支上。
- **Chosen**: (b)。PR base 設為 `propose/issue-4-followups`，#8 merge 後 GitHub 自動 retarget 到 main。check-spec 稽核以 `--base propose/issue-4-followups` 取 diff，避免把 #8 的內容算進本 change。
- **Rationale**: 避免無謂 conflict;合併順序自然（#8 先進）。

## Decision 4: 審查比例原則——不開 4 維度對抗式 workflow

- **Context**: apply skill Step 5 Path A 預設 4 dimension reviewers + skeptics（≈10+ agents）。本 change 是 ~30 行的設定/文件移除 + 一個靜態測試。
- **Chosen**: 單一 `arceus:reviewer` 審查（Path A 的精神是把火力配給風險；對這個 diff 開全板是浪費 token）+ check-spec 第三方稽核照跑。
- **Rationale**: 使用者今日已觸頂一次 session limit；Layer 4（check-spec）照常把關，風險低。若 reviewer 發現結構性問題再升級。
