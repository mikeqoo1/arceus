/**
 * SessionStart hook — loads .arceus/ state and injects context on session start.
 */

import { readStdin, writeOutput, getArceusDir } from "./utils.js";
import type { SessionStartInput } from "./types.js";
import {
  readNotepad,
  readConfig,
  ensureArceusDir,
  logEvent,
  listChanges,
} from "../state/index.js";

async function main(): Promise<void> {
  const input = await readStdin<SessionStartInput>();
  const arceusDir = getArceusDir(input.cwd);

  ensureArceusDir(arceusDir);

  logEvent(arceusDir, input.session_id, {
    timestamp: new Date().toISOString(),
    event: "session_start",
    data: { source: input.source, model: input.model },
  });

  const config = readConfig(arceusDir);
  const notepad = readNotepad(arceusDir);

  // Build context to inject
  const contextParts: string[] = [];

  contextParts.push(`<arceus-plugin>
# Arceus — Multi-Agent Orchestration Plugin

You have the Arceus plugin active. Available magic keywords:
- **autopilot** — Full auto: plan → implement → test → review → complete
- **propose** / **提案** — Draft a change proposal into .arceus/changes/
- **apply** / **實作** — Implement an approved change proposal
- **review-change** / **審查** — Review a change proposal before implementation
- **plan** / **規劃** — Plan first, confirm with user, then execute
- **review** — Multi-perspective code review
- **test** / **tdd** — Test-driven development workflow
- **fix** / **debug** — Debug loop until tests pass
- **deep-dive** / **分析** — Deep code analysis
- **sync** / **同步** — Sync task status to Plane/GitLab/GitHub
- **cross-session** / **跨 session** — Relay to another live Claude Code session (ListAgents + SendMessage)

Available agents (use via subagent delegation):
- arceus:planner — Requirements analysis and task decomposition
- arceus:coder — Code implementation
- arceus:tester — Testing and verification
- arceus:reviewer — Code review (security, performance, style)
- arceus:task-syncer — External platform sync
- arceus:researcher — Investigation and analysis

All tasks require evidence-driven verification (build/test/lint must pass).
</arceus-plugin>`);

  // Surface active changes so AI starts the session knowing what's in-flight
  try {
    const drafts = listChanges(arceusDir, { status: "draft" });
    const actives = listChanges(arceusDir, { status: "active" });
    if (drafts.length > 0 || actives.length > 0) {
      const lines: string[] = ["<arceus-changes>", "Active change proposals:"];
      for (const c of actives) {
        lines.push(`- [active] ${c.id} — ${c.title}`);
      }
      for (const c of drafts) {
        lines.push(`- [draft]  ${c.id} — ${c.title}`);
      }
      lines.push(
        "",
        "Use `npx arceus change show <id>` to read a proposal, or invoke the `apply` / `review-change` skills.",
      );
      lines.push("</arceus-changes>");
      contextParts.push(lines.join("\n"));
    }
  } catch {
    // Non-fatal: missing/corrupt changes dir should not block session start
  }

  if (notepad) {
    contextParts.push(`<arceus-notepad>\n${notepad}\n</arceus-notepad>`);
  }

  if (config.taskSources && config.taskSources.length > 0) {
    const sources = config.taskSources
      .map((s) => `- ${s.type}: ${s.owner ?? s.workspace ?? ""}/${s.repo ?? s.project ?? ""}`)
      .join("\n");
    contextParts.push(`<arceus-config>\nTask sources:\n${sources}\n</arceus-config>`);
  }

  if (input.source === "compact") {
    contextParts.push(
      `<arceus-notice>Context was compacted. Check .arceus/notepad.md for preserved state.</arceus-notice>`,
    );
  }

  writeOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: contextParts.join("\n\n"),
    },
  });
}

main().catch((err) => {
  process.stderr.write(`arceus session-start hook error: ${err}\n`);
  process.exit(0); // Don't block Claude Code on hook errors
});
