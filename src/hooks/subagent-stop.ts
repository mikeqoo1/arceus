/**
 * SubagentStop hook — collects subagent results and updates state.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { readStdin, writeOutput, passThrough, getArceusDir } from "./utils.js";
import type { SubagentStopInput } from "./types.js";
import { logEvent } from "../state/index.js";

/** One-shot reminder marker — .arceus/sessions/<sid>/reminders/<agent_id>. */
function reminderMarkerPath(
  arceusDir: string,
  sessionId: string,
  agentId: string,
): string {
  return join(arceusDir, "sessions", sessionId, "reminders", agentId);
}

/**
 * Encode an untrusted id for use as a single path segment — ids arrive raw on
 * hook stdin, and path.join() does not neutralize ".." or separators.
 */
function safePathSegment(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

async function main(): Promise<void> {
  const input = await readStdin<SubagentStopInput>();

  // Only track arceus agents
  if (!input.agent_type?.startsWith("arceus:")) {
    passThrough();
    return;
  }

  const arceusDir = getArceusDir(input.cwd);
  const agentName = input.agent_type.replace("arceus:", "");

  logEvent(arceusDir, input.session_id, {
    timestamp: new Date().toISOString(),
    event: "subagent_complete",
    agent: agentName,
    data: {
      agent_id: input.agent_id,
      result_preview: input.last_assistant_message?.slice(0, 500),
    },
  });

  // Inject reminder about verification after coder/debugger agents — at most
  // ONCE per agent: SubagentStop re-fires on every subsequent response the
  // reminder itself provokes, so an unconditional injection loops until the
  // agent gives up (issue #6).
  if (agentName === "coder" || agentName === "debugger") {
    // Dedup bookkeeping must never break (or silently drop) the reminder:
    // a missing agent_id, hostile-looking ids, or fs errors all degrade to
    // "remind anyway" — reminding twice beats never reminding.
    try {
      if (input.agent_id) {
        const marker = reminderMarkerPath(
          arceusDir,
          safePathSegment(input.session_id),
          safePathSegment(input.agent_id),
        );
        if (existsSync(marker)) {
          passThrough();
          return;
        }
        mkdirSync(dirname(marker), { recursive: true });
        writeFileSync(marker, new Date().toISOString(), "utf-8");
      }
    } catch {
      // Fall through to inject.
    }
    writeOutput({
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SubagentStop",
        additionalContext: `<arceus-verification-reminder>
The ${agentName} agent has completed. Before marking this task as done:
1. Run typecheck: npm run typecheck (or tsc --noEmit)
2. Run lint: npm run lint
3. Run tests: npm run test
4. Run build: npm run build

Do NOT mark the task complete until all verification steps pass.
</arceus-verification-reminder>`,
      },
    });
    return;
  }

  passThrough();
}

main().catch((err) => {
  process.stderr.write(`arceus subagent-stop hook error: ${err}\n`);
  process.exit(0);
});
