# Spec — Track changes folder and config in git

## 需求描述

把 `.gitignore` 從「整個 `.arceus/` 都不 commit」改成「selectively commit 設計產物、ignore runtime state」，並把每個 `.arceus/` 子目錄自己也帶一份 nested `.gitignore` 做保險。

### 兩層 ignore 設計

**Repo root `.gitignore`**（這個 change 要改的）：
- ignore `.arceus/*`（預設不 commit `.arceus/` 下任何東西）
- exception `!.arceus/changes/`（changes 子樹要 commit）
- exception `!.arceus/config.json`（per-project 設定要 commit）
- exception `!.arceus/.gitkeep`（讓空 .arceus/ 也能存在於 repo）

**Nested `.arceus/.gitignore`**（`arceus init` 建立時自動寫入）：
- 顯式 ignore `notepad.md`、`session-log/`、`.preflight`、`.session/`、其他 runtime artifacts
- 用 inclusive allowlist `!changes/` 和 `!config.json` 作為防呆——即使 root .gitignore 被人改壞，這層還能擋住 runtime state 不外洩

雙重保險的理由：使用 Arceus 的 repo 不一定是這個 plugin repo，新 repo 的 `.gitignore` 可能還沒被升級。靠 `arceus init` 自動寫 nested gitignore 比較可靠。

## 驗收條件

- [ ] **AC1**: Repo root `.gitignore` 修改後，跑 `git check-ignore -v .arceus/changes/foo/proposal.md` 回報「not ignored」
- [ ] **AC2**: 同樣的 .gitignore 下，跑 `git check-ignore -v .arceus/notepad.md` 回報「ignored」
- [ ] **AC3**: `git check-ignore -v .arceus/config.json` 回報「not ignored」
- [ ] **AC4**: `arceus init` 在新 repo 跑完後，`.arceus/.gitignore` 存在且內容含預期條目（notepad.md / session-log/ / .preflight）
- [ ] **AC5**: 在新 repo 上 `arceus init` → 觸發 hook 寫 notepad → `git status` **不**列出 `.arceus/notepad.md`（被 nested gitignore 擋下）
- [ ] **AC6**: 同樣場景下，`arceus change new "foo"` 之後 `git status` **有**列出 `.arceus/changes/2026-XX-XX-foo/` 為 untracked
- [ ] **AC7**: `CLAUDE.md` 的 "Change-Driven Team Collaboration" 段落加一段子標題「哪些 commit、哪些不 commit」，列出兩類檔案
- [ ] **AC8**: `npm run verify` 全綠

## 技術假設

- 這個 change 不會嘗試遷移既有 repo 中已 commit 的 `.arceus/runtime-state`——假設沒有（因為一直被 ignore 著，根本沒進過）
- nested `.gitignore` 對 git 是 well-defined 行為：較深層的 .gitignore 對其覆蓋範圍生效，不需要特別語法
- 使用者升級 Arceus 後，`arceus init` 重跑時若 `.arceus/.gitignore` 已存在，**不**覆寫（避免炸掉使用者客製）；只在不存在時建立。實作時要 idempotent
