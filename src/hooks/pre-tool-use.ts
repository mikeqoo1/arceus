/**
 * PreToolUse hook — safety checks + git preflight before tool execution.
 */

import { readStdin, writeOutput, passThrough, getArceusDir } from "./utils.js";
import type { PreToolUseInput } from "./types.js";
import {
  readConfig,
  runGitPreflight,
  isPreflightDone,
  markPreflightDone,
  hasFetchAttempted,
  markFetchAttempted,
} from "../state/index.js";

// Tools that mutate the working tree — gated by preflight.
const MODIFYING_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

// Dangerous command patterns to warn about (Bash only).
const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+[/~]/,
  /\bgit\s+push\s+--force/,
  /\bgit\s+reset\s+--hard/,
  /\bdrop\s+(?:table|database)/i,
  /\bformat\s+[a-z]:/i,
];

function denyEdit(reason: string, suggestedBranch?: string): void {
  const guidance = suggestedBranch
    ? `\n\nSuggested: \`git checkout -b ${suggestedBranch}\` then retry.`
    : "";
  writeOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: `[Arceus Preflight] ${reason}`,
      additionalContext: `${reason}${guidance}\n\n處理完之後再嘗試這次編輯。`,
    },
  });
}

async function main(): Promise<void> {
  const input = await readStdin<PreToolUseInput>();

  // Branch 1: dangerous Bash commands
  if (input.tool_name === "Bash") {
    const command = (input.tool_input["command"] as string) ?? "";
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(command)) {
        writeOutput({
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: `[Arceus Safety] Potentially dangerous command detected: ${command.slice(0, 100)}`,
            additionalContext:
              "Arceus flagged this command as potentially dangerous. Please confirm before proceeding.",
          },
        });
        return;
      }
    }
    passThrough();
    return;
  }

  // Branch 2: git preflight gate on first modifying tool call per session
  if (!MODIFYING_TOOLS.has(input.tool_name)) {
    passThrough();
    return;
  }

  const arceusDir = getArceusDir(input.cwd);

  if (isPreflightDone(arceusDir, input.session_id)) {
    passThrough();
    return;
  }

  const config = readConfig(arceusDir);
  if (config.preflight?.disabled) {
    markPreflightDone(arceusDir, input.session_id);
    passThrough();
    return;
  }

  // git fetch at most once per session: while preflight is FAILING the gate
  // re-runs on every modifying tool call, and paying the network fetch each
  // retry costs seconds. Retries re-check branch state with local git only.
  const fetchAllowed =
    config.preflight?.fetch !== false &&
    !hasFetchAttempted(arceusDir, input.session_id);
  if (fetchAllowed) {
    markFetchAttempted(arceusDir, input.session_id);
  }

  const result = runGitPreflight(input.cwd, {
    ...(config.preflight?.protectedBranches !== undefined
      ? { protectedBranches: config.preflight.protectedBranches }
      : {}),
    fetch: fetchAllowed,
    ...(config.preflight?.requireUpstreamSynced !== undefined
      ? { requireUpstreamSynced: config.preflight.requireUpstreamSynced }
      : {}),
    ...(config.preflight?.fetchTimeoutMs !== undefined
      ? { fetchTimeoutMs: config.preflight.fetchTimeoutMs }
      : {}),
  });

  if (!result.ok) {
    denyEdit(result.reason ?? "Preflight failed.", result.suggestedBranch);
    return;
  }

  markPreflightDone(arceusDir, input.session_id);
  passThrough();
}

main().catch((err) => {
  process.stderr.write(`arceus pre-tool-use hook error: ${err}\n`);
  process.exit(0);
});
