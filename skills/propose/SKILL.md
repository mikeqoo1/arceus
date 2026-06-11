---
name: propose
description: Draft a new change proposal (proposal + spec + tasks) into .arceus/changes/
triggers: ["propose", "提案"]
agents: [planner, researcher]
---

# Propose Workflow

You are running in **Propose mode**. Your job is to produce a **persistent change proposal** that the team can review in git **before** any code is written.

The output lives in `.arceus/changes/<id>/` — four files that become part of the repository.

## Execution Steps

### Step 0: Preflight — Check Branch State
Before anything, inspect the working tree:
- `git status`, `git log -5 --oneline`, `git diff` (if dirty)

If there is unexpected WIP, surface it before proposing.

### Step 1: Create the Change Skeleton
Run the CLI to scaffold the folder:

```bash
npx arceus change new "<short title>"
```

This creates `.arceus/changes/YYYY-MM-DD-<slug>/` with `proposal.md`, `spec.md`, `tasks.md`, `decisions.md`, and `meta.json` (status=draft).

Note the `id` it prints — you'll need it for subsequent steps.

### Step 2: Research (delegate to arceus:researcher if needed)
- Read affected code, surrounding context, existing conventions
- Identify stakeholders, dependencies, and risks
- Gather enough material to write a **specific**, not generic, proposal

### Step 3: Draft Artifacts (judge panel when available)

Choose the path with one check: **is the Workflow tool in your tool list?**

#### Path A — Workflow tool available (judge panel)
1. Prepare `researchFindings` (the Step 2 researcher output: context summary +
   affected files) and the user's goal statement
2. Announce briefly: "Starting judge panel: 3 drafters + 2 judges + 1 synthesizer"
3. Call the plugin-shipped workflow (placeholder substituted at injection time):
   `Workflow({ scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/judge-panel.js", args: { changeId, changePath, researchFindings, userGoal } })`
4. The workflow returns the four file contents. **You (the main agent) write
   them into the change folder with the Write tool yourself** — workflow agents
   never write change files. Then continue to Step 4 below (human gate).

#### Path B — Fallback (Workflow tool not in tool list; delegate to arceus:planner)
Use the Write tool to fill in each file. **Be concrete** — cite file paths, function names, real examples. Generic proposals are useless for team review.

**proposal.md** — Why this change exists:
- Problem statement (what's broken / missing)
- Goal (what "done" looks like)
- Scope (in / out)
- Stakeholders

**spec.md** — What the change must do (free markdown):
- Functional requirements
- Acceptance criteria as checklist
- Technical assumptions and constraints

**tasks.md** — Checklist the coder will follow:
- One task per line, each independently verifiable
- Order matters (dependencies first)
- Small enough that completing one is a meaningful step

**decisions.md** — Any non-obvious technical calls:
- Only fill in if there are real choices; otherwise leave the template as-is
- Record: Context, Options considered, Chosen, Rationale

### Step 4: Present for Review
Print a summary to the user:
- Change id and folder path
- One-line summary of the proposal
- Open questions requiring human decision

**WAIT FOR USER CONFIRMATION.** Do NOT run `apply` in the same turn. The user should:
1. Read the files (or `npx arceus change show <id>`)
2. Commit them to git if the team flow requires peer review first
3. Explicitly approve before implementation begins

### Step 5: Mark Active (only after approval)
When the user approves, transition:
```bash
npx arceus change status <id> active
```

## Rules

- Every proposal MUST cite specific files / functions / APIs — no vague "improve X" language
- Tasks.md items MUST be verifiable (something you could mark checked with evidence)
- If the request is too vague to propose concretely, ask clarifying questions before scaffolding
- Never skip Step 4 (human review gate) — this is the point of the whole workflow
- Do not implement any code in propose mode; that is `apply`'s job
