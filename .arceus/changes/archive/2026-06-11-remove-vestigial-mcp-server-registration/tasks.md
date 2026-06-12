# Tasks — Remove vestigial MCP server registration

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。_

- [x] T-1 `.claude-plugin/plugin.json`：移除 `"mcpServers": "./.mcp.json"` 欄位（注意上一行行尾逗號）
- [x] T-2 `git rm -f .mcp.json`（-f 因工作樹有本機修改）
- [x] T-3 `package.json`：files 陣列移除 `".mcp.json"`
- [x] T-4 `CLAUDE.md`：Four-Layer Design 區塊移除 `.mcp.json` 行、補一行「MCP server 未實作；未來以 plugin.json 內聯註冊」
- [x] T-5 `docs/architecture/arceus-plugin-architecture.md`：更新 12 節 Phase 3 該項與 13 節第 6 點（內聯註冊 + entry 必須存在）
- [x] T-6 `README.md`：結構圖移除 `.mcp.json` 行
- [x] T-7 新增 `tests/unit/plugin-manifest.test.ts`（spec F5 四項斷言）
- [x] T-8 `npm run verify` 全綠
