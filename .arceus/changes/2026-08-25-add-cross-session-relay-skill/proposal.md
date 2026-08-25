# Add cross-session relay skill

## 為什麼 (Why)

Claude Code 2.1.224 起，同一台機器上的多個 session 可以互相傳訊（`ListAgents` 找人、`SendMessage` 送話）。使用者常同時開好幾個專案的 session（tw-stock-ucore、alma、dinopanel…），現況是要交接或問進度只能靠人肉複製貼上。Arceus 沒有任何 skill 告訴 AI 什麼時候該用、訊息該長什麼樣、收到別人的訊息要怎麼對待，所以這個能力等於沒接進工作流。

另外有一個順手要修的洞：peer 送來的 `<cross-session-message>` 若含 `review` / `fix` 等字，`keyword-detector.ts` 會把它當成使用者下的魔法關鍵字（issue #7 同類問題）。

## 範圍 (Scope)

- **In scope**:
  - 新 skill `skills/cross-session/SKILL.md`：發現目標、訊息格式、`notify_when_idle`、收訊端規則、fallback
  - `keyword-detector.ts` 註冊關鍵字 `cross-session` / `跨 session` / `其他 session` / `另一個 session`
  - `SYSTEM_TEXT_MARKERS` 加 `<cross-session-message` 與 `[Cross-session idle notice]`
  - session-start 啟動清單、README / CLAUDE.md / 架構文件的關鍵字表
  - 單元測試：關鍵字觸發 + peer 訊息不觸發
- **Out of scope**:
  - 在 session log 記錄跨 session 訊息事件（沒有需求）
  - 任何新的 agent 定義；agents 若需要送訊就直接用內建工具
  - 跨機器 / Remote Control 的設定引導

## Stakeholders

- Owner：seaflower
- Reviewer：PR reviewer
- 受影響：所有裝了 Arceus 的專案（多一個關鍵字，其他行為不變）
