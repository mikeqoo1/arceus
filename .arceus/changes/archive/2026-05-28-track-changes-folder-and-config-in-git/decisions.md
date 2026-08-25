# Decisions — Track changes folder and config in git

## Decision 1: 兩層 .gitignore（root + nested），不只改 root

- **Context**: 修 `.gitignore` 讓 changes/ 可 commit，最小改動是只改 repo root 的 `.gitignore`。但這對「使用 Arceus 的別人專案」沒有保護——他們的 .gitignore 還是維持「整個 .arceus/ ignore」
- **Options considered**:
  - (a) 只改 repo root `.gitignore`
  - (b) 改 root + `arceus init` 自動建 nested `.arceus/.gitignore`
  - (c) 只靠 `arceus init` 寫 nested .gitignore，不動 root（讓使用者自己決定要 commit changes/ 不）
- **Chosen**: (b)
- **Rationale**:
  - (a) 只解決 Arceus 自己這個 repo 的問題，不解決它的使用者
  - (c) 是 (b) 的劣化版：當 root 不允許 .arceus/ 任何東西時，nested 怎麼設都沒用——git 在 root 層就過濾掉了
  - (b) 兩層互補：root 定 default（runtime state ignore + spec artifacts allow），nested 加保險（即使 root 被改壞、或新 repo 還沒升級，runtime state 仍被擋）
  - nested .gitignore 是 git 標準語意，不引入新概念

## Decision 2: nested .gitignore 不覆寫已存在的版本（idempotent）

- **Context**: 使用者可能客製化 `.arceus/.gitignore`（例如加自己的 internal-only artifacts），升級 Arceus 後重跑 `arceus init` 不該炸掉
- **Options considered**:
  - (a) 每次 init 都覆寫
  - (b) 不存在才建，存在就 no-op
  - (c) 存在則 merge（把 Arceus 預設條目跟使用者的合併）
- **Chosen**: (b)
- **Rationale**:
  - (a) 違反「使用者擁有自己的 config」原則
  - (c) merge 邏輯複雜（如何識別「我之前寫的」vs「使用者加的」？），且容易在邊界 case 出錯
  - (b) 是最小驚訝原則。若使用者刪掉 `.arceus/.gitignore` 想恢復預設，重跑 init 即可
- **Revisit if**: 預設清單需要演化（新增條目），使用者反映「我的舊版 nested .gitignore 漏了新條目」——這時可加 `arceus doctor` 子命令做 advisory diff，不強制覆寫

## Decision 3: 用 `.gitkeep` 而非靠 changes/ 子目錄存在來保留 .arceus/ 結構

- **Context**: 若一個 repo 從沒跑過 `arceus init`，commit 中需不需要先有 `.arceus/` 的骨架？
- **Options considered**:
  - (a) `.arceus/.gitkeep`：明示「這資料夾要存在」
  - (b) 靠 `.arceus/changes/` 第一個 change 出現時自然帶出資料夾
  - (c) `arceus init` 跑時順手建一個 placeholder change
- **Chosen**: (a)
- **Rationale**:
  - (b) 在「init 之後但還沒有任何 change」的 window 期，`.arceus/` 等於不存在於 git——若這時 push，協作者 pull 後沒有 .arceus 骨架
  - (c) 太魔法、會污染 changes 列表
  - (a) 是 git 約定俗成做法、零認知負擔
