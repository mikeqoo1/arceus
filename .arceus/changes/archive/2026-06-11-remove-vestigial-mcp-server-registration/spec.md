# Spec — Remove vestigial MCP server registration

## 需求描述

### 使用者故事

身為用軟連結把 Arceus dev repo 直接掛進 local marketplace 的開發者，我希望 repo 裡不要有「指向不存在 entry point 的 MCP 註冊」，這樣 Claude Code 不會反覆 spawn 失敗、我也不必永遠維持一個 uncommitted 的本機 workaround。

### 功能列表

#### F1. `.claude-plugin/plugin.json` 移除死引用
刪除 `"mcpServers": "./.mcp.json"` 欄位（目前第 9 行）。其餘欄位（`name`/`version`/`description`/`author`/`skills`）不動。

#### F2. 刪除根目錄 `.mcp.json`
`git rm .mcp.json`。理由：(a) 內容只剩指向不存在的 `dist/mcp-server.js` 的死註冊；(b) 檔名在 symlink 安裝下有「plugin 設定 + 專案設定」雙重身分，留著（即使清空）就留著重蹈覆轍的入口。

#### F3. `package.json` files 陣列同步
移除 `".mcp.json"` 條目（檔案已不存在，留著是死引用）。

#### F4. 文件同步
- `CLAUDE.md`：Four-Layer Design 區塊移除 `.mcp.json` 一行，並註明 MCP server 目前未實作、未來以 plugin.json 內聯註冊（見 Decision 2）
- `docs/architecture/arceus-plugin-architecture.md`：12 節 Phase 3「MCP server 實作」項註明含正確註冊方式；13 節第 6 點「MCP tools → .mcp.json 在 plugin.json 中引用」更新為內聯註冊結論
- `README.md`：結構圖移除 `.mcp.json` 一行

#### F5. Manifest regression test（`tests/unit/plugin-manifest.test.ts`）
靜態測試：
1. `.claude-plugin/plugin.json` 可 parse，`name === "arceus"`、`version` 符合 semver
2. 若 `mcpServers` 欄位存在且為字串路徑 → 該檔案必須存在（防死引用重現）
3. repo 根目錄**不存在** `.mcp.json`（防雙重身分檔案重現；測試失敗訊息指向 decisions.md Decision 2）
4. `hooks/hooks.json` 每個 command 引用的 `dist/hooks/<name>.js` 都有對應的 `src/hooks/<name>.ts`（同類死引用的源頭層 guard，不依賴 build 產物）

## 驗收條件

- [ ] **AC1**: `.claude-plugin/plugin.json` 無 `mcpServers` 欄位，其餘欄位與改動前一致
- [ ] **AC2**: repo 無 `.mcp.json`（git tracked 與工作樹皆無）；使用者工作樹自此乾淨（無 perpetual dirty file）
- [ ] **AC3**: `package.json` files 陣列無 `".mcp.json"`
- [ ] **AC4**: `grep -rn "mcp-server\|\.mcp\.json" CLAUDE.md README.md docs/` 無「現在式」的死描述（歷史性段落如 12 節 roadmap 可保留，但須反映「未實作」事實）
- [ ] **AC5**: `tests/unit/plugin-manifest.test.ts` 存在且涵蓋 F5 四項斷言
- [ ] **AC6**: `npm run verify`（typecheck + lint + test + build）全綠
- [ ] **AC7**: Claude Code 重新載入 plugin 後 `/mcp` 無 arceus-state 失敗項（手動驗證，記錄於 PR）

## 技術假設

- 官方文件（code.claude.com/docs plugins-reference）確認：plugin 的 MCP 註冊支援 plugin.json `mcpServers` 欄位的**內聯物件**與**字串路徑**兩種形式，且 `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PROJECT_DIR}` 變數可用——未來實作真 server 時不需要根目錄 `.mcp.json`
- 正常（非 symlink）安裝時 plugin 檔案會被複製到 cache，不會發生雙重讀取——本 change 防的是 symlink/dev 場景，但移除死註冊對所有安裝方式都是淨改善
- 移除 `mcpServers` 欄位後 plugin 無 MCP server——與現狀（spawn 失敗 = 實質沒有）行為等價，無功能退化
- 本 change 基於 `propose/issue-4-followups` 分支（stacked）：`package.json` files 陣列與 PR #8 的修改相鄰，從 main 分出會產生無謂 conflict（見 Decision 3）；check-spec 稽核需用 `--base propose/issue-4-followups`
