# Decisions — Add cross-session relay skill

## Decision 1: 只加 skill + 關鍵字，不加 agent、不記 log

- **Context**: 跨 session 溝通的能力是 Claude Code 內建工具（ListAgents / SendMessage），Arceus 能加的價值是「什麼時候用、怎麼寫、收到怎麼辦」。
- **Options considered**: (a) 純 SKILL.md 指引；(b) 另加 `arceus:relay` agent 專責送訊；(c) 在 post-tool-use 把 SendMessage 記進 session log。
- **Chosen**: (a)
- **Rationale**: (b) 多一層 subagent 反而拿不到主對話的上下文，訊息品質更差；(c) 目前沒有人要讀這個 log。之後有需求再加。

## Decision 2: peer 訊息整段當系統文字，不做關鍵字偵測

- **Context**: issue #7 的教訓——harness 產生的文字含 review/fix 會誤觸 skill。peer 訊息是另一個 agent 寫的，同樣不是使用者指令。
- **Options considered**: (a) 加進 `SYSTEM_TEXT_MARKERS`（整段跳過）；(b) 只剝掉 `<cross-session-message>` 區塊再偵測剩餘文字。
- **Chosen**: (a)
- **Rationale**: 官方說訊息是在 tool round 之間送達，不一定會經過 UserPromptSubmit；就算會，一段 prompt 裡同時有 peer 訊息又有使用者新指令的情境極少。一行搞定，和既有 marker 行為一致。

## Decision 3: 關鍵字不收 `peer`、`session` 單字

- **Context**: `peer review`、`這個 session` 在日常對話很常見。
- **Chosen**: 只收 `cross-session`、`跨 session`、`其他 session`、`另一個 session`。
- **Rationale**: 寧可少觸發，不要誤觸發（`review` 已經夠常誤觸了）。

## Decision 4: 不導入外部 cross-session skill，只借兩條實戰經驗

- **Context**: 2026-08-25 調查網路上的跨 session 技能包。功能 8/7 才上線，生態未定型。候選：ray-amjad/peer-sessions（19★，主體是用 cmux 開一排 session）、kpango/dotfiles swarm-relay（個人協定規格，日文）、Arch1eSUN/Arcgentic session-broker（角色 session + broker 框架）、PeterSR/claude-code-socket-transport（Go，讓非 Claude 程式塞訊息進 socket，協定從 v2.1.233 反推）、davila7 session-handoff / PatilShreyas session-bridge（檔案式，功能上線前的產物）。
- **Options considered**: (a) 裝 peer-sessions 取代自寫 skill；(b) 自寫，借用外部的實戰經驗；(c) 兩者並存。
- **Chosen**: (b)
- **Rationale**: 使用者的用法是一個專案一個 session、本來就在跑，只需要「找到、送話、收話」，fleet spawn 用不到；Arcgentic 與 Arceus agents 重疊；socket-transport 協定未公開會隨版本壞；檔案式交接 `.arceus/changes/` + notepad 已經在做。功能太新，多裝一個就多養一個依賴。從 peer-sessions 借了「純名字送被彈回 re-send with the ref 是確認」與 alphalab 的「SendMessage / handover / PR 三通道分工」兩句寫進 SKILL.md。等官方行為穩定、真有 CI 主動通知 session 的需求時再回頭看 socket-transport。
