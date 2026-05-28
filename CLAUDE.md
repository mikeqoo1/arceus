# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arceus is a **Claude Code plugin** that provides multi-agent orchestration through hooks, magic keywords, skills, and subagent delegation. Named after the Pokémon that created the world with all types — a universal AI collaboration engine.

Architecture reference: `docs/architecture/arceus-plugin-architecture.md`

## Language Rules

- Respond in **Traditional Chinese** (繁體中文)
- Code: **TypeScript** (English variable names, comments)
- Documentation (docs/): **Traditional Chinese**

## Build / Test / Lint Commands

```bash
npm run build        # tsup → dist/ (ESM, hooks bundled standalone)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint src/
npm run lint:fix     # eslint src/ --fix
npm run test         # vitest run
npm run test:watch   # vitest (watch mode)
npm run verify       # typecheck + lint + test + build (all in sequence)
```

CLI: `node dist/cli.js --version`

## Plugin Architecture

### Four-Layer Design (Hooks → Skills → Agents → State)

```
.claude-plugin/plugin.json    # Plugin manifest
hooks/hooks.json              # Hook registrations (lifecycle events)
agents/*.md                   # Agent definitions (markdown + YAML frontmatter)
skills/*/SKILL.md             # Skill workflow definitions
.mcp.json                     # MCP server for state tools
```

### Source Structure

```
src/
├── hooks/                    # Hook implementations (each is a standalone entry point)
│   ├── types.ts              # Hook stdin/stdout protocol types
│   ├── utils.ts              # Shared hook utilities (readStdin, writeOutput)
│   ├── session-start.ts      # SessionStart: load .arceus/ state + active changes
│   ├── keyword-detector.ts   # UserPromptSubmit: magic keyword detection + skill injection
│   ├── pre-tool-use.ts       # PreToolUse: safety checks on dangerous commands
│   ├── post-tool-use.ts      # PostToolUse: log tool execution results
│   ├── subagent-stop.ts      # SubagentStop: collect results, inject verification reminders
│   └── stop.ts               # Stop: save state before session ends
├── state/                    # .arceus/ state management
│   ├── notepad.ts            # Compaction-resistant persistent notes
│   ├── session-log.ts        # JSONL event log per session
│   ├── config.ts             # Project config (.arceus/config.json)
│   └── changes.ts            # Change proposal CRUD (.arceus/changes/<id>/)
├── index.ts                  # Main exports (state API + types)
└── cli.ts                    # CLI (arceus init/status, arceus change new/list/show/status/archive)
```

### Hook Protocol

Hooks receive JSON on stdin from Claude Code and output JSON to stdout:
- Input: `{ session_id, cwd, prompt, tool_name, ... }` (varies by event)
- Output: `{ continue, hookSpecificOutput: { additionalContext } }` to inject context

### Magic Keywords

| Keyword | Skill | Effect |
|---------|-------|--------|
| autopilot | autopilot | Full auto: plan → implement → test → review |
| propose / 提案 | propose | Draft a change proposal into `.arceus/changes/<id>/` |
| apply / 實作 | apply | Implement an approved change proposal |
| review-change / 審查 | review-change | Review a change proposal before implementation |
| plan / 規劃 | plan-and-execute | Plan first, confirm, then execute |
| review | code-review | Multi-perspective code review |
| fix / debug | debug-loop | Iterative fix until tests pass |
| sync / 同步 | task-sync | Sync task status to platforms |
| deep-dive / 分析 | deep-analysis | Deep code investigation |

### Change-Driven Team Collaboration

Arceus persists AI plans as git-trackable artifacts under `.arceus/changes/<YYYY-MM-DD-slug>/`:

```
.arceus/changes/2026-04-22-add-auth/
├── proposal.md    # why — problem, goal, scope, stakeholders
├── spec.md        # what — requirements + acceptance criteria (free markdown)
├── tasks.md       # how — implementation checklist (AI ticks as it goes)
├── decisions.md   # technical decisions + rationale
└── meta.json      # id, status (draft/active/completed/archived), author, timestamps
└── archive/       # completed changes move here
```

Typical flow:
1. `propose` → AI creates skeleton + drafts content → human reviews via git → approves
2. `npx arceus change status <id> active`
3. `apply` → AI implements tasks.md → verifies → marks completed
4. `npx arceus change archive <id>` once the linked PR merges

CLI commands: `arceus change new|list|show|status|archive`

#### 哪些 `.arceus/` 檔案 commit、哪些不 commit

`.arceus/` 同時混了「團隊共享的設計產物」與「每位開發者的 runtime state」，兩層用 nested `.gitignore` 區分：

**Commit 進 git**（PR review 對象）：
- `.arceus/changes/` — 所有提案、規格、任務、決策
- `.arceus/config.json` — 專案層級設定（taskSources、verification、preflight 等）
- `.arceus/.gitkeep` — 骨架保留
- `.arceus/.gitignore` — 這層 ignore 規則本身

**不 commit**（per-developer runtime）：
- `.arceus/notepad.md` — compaction-resistant 筆記
- `.arceus/session-log/`、`.arceus/sessions/` — 對話 / 事件 log
- `.arceus/.preflight`、`.arceus/.session/` — per-session marker
- `.arceus/memory/` — 本機 memory 系統

雙層 .gitignore 設計：repo root 用 `.arceus/*` + `!.arceus/changes/` 等 allowlist 控制；`.arceus/.gitignore`（由 `arceus init` 寫入）作為防呆，即便 root 配置壞掉也擋住 runtime state 外洩。

### Agents (subagent delegation)

Agents are defined as markdown files in `agents/`. Used via Claude Code's Task/Agent system with `subagent_type="arceus:<name>"`.

`arceus:planner` knows how to write proposals into `.arceus/changes/<id>/` when invoked from the `propose` skill.
`arceus:reviewer` knows how to review proposals (not just code) when invoked from `review-change`.

### Evidence-Driven Verification

All code changes must pass: typecheck → lint → test → build before completion.
