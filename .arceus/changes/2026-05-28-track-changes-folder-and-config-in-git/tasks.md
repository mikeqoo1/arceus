# Tasks — Track changes folder and config in git

_實作階段的 checklist。每一項都應該是可獨立驗證的最小步驟。_

## Phase 1 — Repo root .gitignore

- [x] T-1 修改 `/Projects/arceus/.gitignore`：把 `.arceus/` 那一行改成：
  ```
  # Arceus state — selectively committed
  .arceus/*
  !.arceus/changes/
  !.arceus/config.json
  !.arceus/.gitkeep
  ```
  並更新前面的註解，描述「設計產物 commit、runtime state ignore」

- [x] T-2 建立空檔案 `/Projects/arceus/.arceus/.gitkeep`（即使資料夾被 ignore 規則覆蓋時，仍能保留資料夾骨架在 repo 中）

## Phase 2 — Nested .arceus/.gitignore（自動寫入）

- [x] T-3 在 `src/state/index.ts`（或對應 init 邏輯處）新增 `ensureArceusGitignore(arceusDir)` 函式：若 `.arceus/.gitignore` 不存在，寫入下面的內容；存在則 no-op：
  ```
  # Runtime state — never commit
  notepad.md
  session-log/
  .preflight
  .session/

  # Build artifacts
  *.log

  # Spec-driven artifacts — explicitly allowed
  !changes/
  !config.json
  ```

- [x] T-4 修改 `src/cli.ts` 的 `init` 子命令：在 `ensureArceusDir(arceusDir)` 之後呼叫 `ensureArceusGitignore(arceusDir)`

- [x] T-5 在現有 `.arceus/` 補上 nested `.gitignore`（手動，作為本 change 自身的 dogfood：跑一次 `arceus init` 應該要把它建出來，或直接 commit 內容相同的版本）

## Phase 3 — 文件

- [x] T-6 修改 `CLAUDE.md` 的 "Change-Driven Team Collaboration" 段落，加子標題「哪些檔案 commit / 哪些不 commit」與兩個列表

## Phase 4 — 測試

- [x] T-7 在 `src/state/index.test.ts`（或新增）測 `ensureArceusGitignore` 的 idempotency：跑兩次後檔案內容相同、沒被覆寫
- [x] T-8 整合測試：mock 一個新 repo，跑 `arceus init`，斷言 `.arceus/.gitignore` 含預期條目；再跑 `arceus change new "foo"` 並用 `git check-ignore` 確認 changes/ 不被 ignore、notepad.md 被 ignore
- [x] T-9 `npm run verify` 全綠

## Phase 5 — 端到端驗證（dogfood）

- [x] T-10 重新跑 `git status`：本 change 自己的 `.arceus/changes/2026-05-28-track-changes-folder-and-config-in-git/*` 必須被列為 untracked（可被 `git add` 進來）；同時 `.arceus/notepad.md`（若存在）必須不在 list 中
