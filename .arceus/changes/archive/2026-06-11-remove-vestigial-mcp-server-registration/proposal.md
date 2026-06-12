# Remove vestigial MCP server registration

## 為什麼 (Why)

`.mcp.json` 註冊的 `arceus-state` MCP server 指向 `$CLAUDE_PLUGIN_ROOT/dist/mcp-server.js`——**這個檔案從未存在過**：`src/` 沒有 mcp-server 原始碼、`tsup.config.ts` 沒有對應 entry、架構文件 12 節 Phase 3 的「MCP server 實作（dist/mcp-server.js）」checkbox 仍未勾選。這個註冊打從一開始就是壞的（Claude Code 每次載入都 spawn 失敗）。

雪上加霜的是使用者的安裝方式已改為 **local marketplace 軟連結**（`~/.claude/plugins/local-marketplace/plugins/arceus → /Projects/arceus`）：plugin root 與專案目錄是同一個實體目錄，根目錄的 `.mcp.json` 會被**讀兩次**——一次經 `plugin.json` 的 `"mcpServers": "./.mcp.json"` 引用（plugin 層），一次作為專案層 `.mcp.json`（Claude Code 的 project MCP config）。同一個壞註冊，雙倍失敗。

使用者目前的 workaround 是本機把 `.mcp.json` 清空但不 commit——代價是工作樹**永遠髒著**：每次 `git status`、每次 preflight 都看到它，每次 commit 都要手動排除（2026-06-11 的 autopilot session 即如此操作）。

本 change 根治：移除死註冊與雙重身分檔案，並以決策紀錄 + regression test 確保未來真正實作 arceus-state server 時用正確的方式註冊。

## 範圍 (Scope)

- **In scope**:
  - 移除 `.claude-plugin/plugin.json` 的 `"mcpServers": "./.mcp.json"` 欄位
  - 刪除 repo 根目錄 `.mcp.json`（git rm）
  - `package.json` `files` 陣列移除 `".mcp.json"`
  - 文件同步：`CLAUDE.md` 四層設計區塊、`docs/architecture/arceus-plugin-architecture.md`（12 節 Phase 3、13 節第 6 點）、`README.md` 結構圖
  - 新增 `tests/unit/plugin-manifest.test.ts`：manifest 完整性 + 死引用 regression guard
- **Out of scope**:
  - 實作真正的 arceus-state MCP server（架構文件 Phase 3 既有規劃，另案處理）
  - issue #5（PreToolUse matcher）等其他 hooks.json 修正

## Stakeholders

- **Owner**: @mikeqoo1
- **影響**: 使用 symlink/local-marketplace 安裝的開發者（工作樹從此乾淨）；未來實作 MCP server 的人（Decision 2 給了正確註冊方式）
