---
name: apply
description: Implement an approved change proposal from .arceus/changes/<id>/
triggers: ["apply", "實作"]
agents: [coder, tester, reviewer]
verification: [typecheck, lint, test, build]
---

# Apply Workflow

You are running in **Apply mode**. Take an approved change proposal and implement it, following `tasks.md` as the source of truth.

## Execution Steps

### Step 0: Preflight — Check Branch State
- `git status`, `git log -5 --oneline`, `git diff` (if dirty)
- If the tree has modifications that don't look like yours, STOP and ask the user

### Step 1: Load the Change
Identify the target change id from the user's message. If the user didn't specify one:
```bash
npx arceus change list --status active
```
Ask the user which change to apply if more than one is active.

Read all four files:
- `proposal.md` — context and why
- `spec.md` — acceptance criteria
- `tasks.md` — the checklist to execute
- `decisions.md` — technical decisions to respect

### Step 2: Verify Approval Gate
- `meta.json` status must be `active` (not `draft`). If it's still `draft`, stop and tell the user to approve via `npx arceus change status <id> active` first.
- Confirm the task checklist is non-empty.

### Step 3: Execute Tasks (delegate to arceus:coder)
For each unchecked item in `tasks.md`:
1. Delegate the subtask to `arceus:coder`
2. After the coder reports completion, mark the item `[x]` in `tasks.md`
3. Commit or leave uncommitted per user preference (do NOT auto-commit unless user asks)
4. Continue to the next task

**Parallelize** independent tasks when possible (multiple subagent delegations in one turn).

### Step 4: Verify (delegate to arceus:tester)
Run full verification: typecheck → lint → test → build.

If any step fails:
- Fix and re-run (max 3 rounds)
- If still failing after 3 rounds, report to user with error details and stop

### Step 5: Review (Layer 3 — multi-agent adversarial review)

Layer position: this review does NOT replace Step 4 self-verification (Layers
1–2) nor the Step 5.5 check-spec audit (Layer 4) — it sits between them.
Choose the path with one check: **is the Workflow tool in your tool list?**

#### Path A — Workflow tool available (adversarial review)
1. Collect inputs: `git diff <base>...HEAD` — `<base>` is the change's base ref
   (default `origin/main`, the same base Step 5.5 check-spec uses) — plus full
   `spec.md` and `tasks.md` contents
2. Announce briefly: "Starting adversarial review: 4 dimension reviewers + up to N skeptics"
3. Call the plugin-shipped workflow (the placeholder below is substituted with
   the real plugin path at injection time):
   `Workflow({ scriptPath: "{{ARCEUS_PLUGIN_ROOT}}/workflows/adversarial-review.js", args: { changeId, diff, specContent, tasksContent } })`
4. Read the returned report. Dimensions marked INCOMPLETE are coverage gaps —
   re-run them or fall back to Path B for those aspects, never treat as a pass.
5. If any **surviving block findings**: fix them, re-run Step 4 verification,
   then re-run this review — **max 3 review rounds**, then stop and ask the user
6. When no block findings survive, continue to Step 5.5

#### Path B — Fallback (Workflow tool not in tool list; delegate to arceus:reviewer)
Review the implemented diff against `spec.md` acceptance criteria:
- Does the code satisfy every acceptance criterion?
- Any blocking correctness/security/performance issues?

Fix blocking issues, re-verify.

### Step 5.5: Audit via check-spec (independent third-party judge)
Run the independent spec/code audit:
```bash
npx arceus change verify <id>
```

This calls the `check-spec` binary (separate Go project — see
https://github.com/mikeqoo1/check-spec) which acts as a third-party judge:
it reads `proposal.md` / `spec.md` / `tasks.md` and the git diff, then
returns a structured verdict — `APPROVE`, `REQUEST_CHANGES`, or
`NEEDS_DISCUSSION`. The verdict, the HEAD SHA at audit time, and the
binary version are written into `meta.json`. The full report is saved to
`.arceus/changes/<id>/audit/<timestamp>.md` (and copied to `audit/latest.md`).

The gate's behavior in Step 6 depends on `checkSpec` config:

- **Strict mode** (`checkSpec.requireApprove=true`): completion is BLOCKED
  unless verdict is `APPROVE` **and** `verifiedSha` matches the current
  `HEAD` SHA. Use `--force` to bypass (logged to `audit/force-overrides.log`).
- **Advisory mode** (default): completion proceeds with a warning if the
  verdict is missing or non-APPROVE — the verdict is still recorded.

Verdict handling:
- `APPROVE`: proceed to Step 6.
- `REQUEST_CHANGES`: read `.arceus/changes/<id>/audit/latest.md`, fix the
  drift findings, commit, then re-run verify.
- `NEEDS_DISCUSSION`: stop and surface the report to the user.
- Maximum 3 re-verify rounds before stopping and asking the user.

**Audit size signal**: if the report exceeds 7000 characters, `change verify`
prints a warning that the change may be too large. Treat this as a hint to
split into smaller changes via `arceus change new`, not as a blocker.

**Missing binary / missing API key**: if `check-spec` is not installed or
`ANTHROPIC_API_KEY` is not set, `change verify` exits 2 with actionable
instructions. In strict mode this blocks Step 6; in advisory mode you can
proceed (the gate will print a warning that no verdict is recorded).

### Step 6: Complete
When all tasks are checked, verification passes, and check-spec verdict
is recorded (or advisory mode lets the gate through):
```bash
npx arceus change status <id> completed
```

Report to the user:
- Summary of what was done
- Files changed
- Verification results
- Suggest archiving (`npx arceus change archive <id>`) once the linked PR is merged

## Rules

- Never implement anything not listed in `tasks.md` — if scope creep is needed, update the spec and ask the user first
- Every task MUST pass verification before being marked complete
- If a task turns out to be wrong or infeasible, stop and update the spec/tasks with the user before proceeding
- Preserve the original `decisions.md` rationale; only append new decisions, never rewrite history
- The coder never modifies `meta.json` manually — use `npx arceus change status` CLI
