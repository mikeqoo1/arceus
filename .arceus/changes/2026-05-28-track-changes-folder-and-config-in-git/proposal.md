# Track changes folder and config in git

## 為什麼 (Why)

專案文件與實作之間有個直接矛盾：

- `CLAUDE.md` 的 "Change-Driven Team Collaboration" 段落寫：「Arceus persists AI plans as **git-trackable artifacts** under `.arceus/changes/<YYYY-MM-DD-slug>/`」
- 但 `.gitignore` 第 28 行：
  ```
  # Arceus runtime state (per-project, not committed)
  .arceus/
  ```
  把整個 `.arceus/` 都 ignore 了

結果：spec-driven workflow 的核心承諾（讓 AI 規劃可被 PR review）目前在新 repo 上是**做不到**的——使用者 propose 完，根本無法 `git add` 那些 markdown 檔。這個 bug 被姊妹 change `2026-05-28-integrate-check-spec-as-completion-gate` 在試圖 commit 時撞到。

矛盾根源：`.arceus/` 同時混了**兩種性質的檔案**：
1. **可審查的設計產物**：`changes/`（提案 / 規格 / 任務 / 決策）、`config.json`——這些是團隊應該共同擁有的
2. **每位開發者本機的 runtime state**：`notepad.md`（compaction-resistant 筆記）、`session-log/*.jsonl`、`.preflight`（per-session marker）等——這些不該進 repo

這個 change 把兩層分開：commit 第一類，繼續 ignore 第二類。

## 範圍 (Scope)

- **In scope**:
  - 修改 `.gitignore`：把 `.arceus/` 改成保留 `.arceus/changes/` 與 `.arceus/config.json` 可追蹤、其他子路徑繼續 ignore
  - 加 `.arceus/.gitkeep`（讓空的 .arceus/ 結構可以提交，但 runtime state 不外洩）
  - 在 `CLAUDE.md` 補一段「`.arceus/` 哪些 commit 哪些不 commit」說明
  - 在 `src/cli.ts` 的 `arceus init` 中，建立 `.arceus/` 時順便建好正確的 `.gitignore`（per-arceus-dir）保護 runtime state，獨立於專案 root 的 .gitignore
  - 對應測試：確保 `arceus init` 在新 repo 上跑完，`git status` 不會看到 runtime state（例如 notepad）

- **Out of scope**:
  - 不修改 changes.ts / notepad.ts / session-log.ts 的內部行為——它們寫到哪裡不變
  - 不引入 git submodule / 外部 changes repo
  - 不處理 `archive/` 該不該 commit（目前 archive 仍進 git，保留歷史；若未來 archive 太膨脹再另議）

## Stakeholders

- **Owner**: @mikeqoo1
- **Reviewer**: 任何想跑 spec-driven workflow 的協作者
- **Blocked by this**: `2026-05-28-integrate-check-spec-as-completion-gate`（必須等 .gitignore 修好才能 commit 進 git）
