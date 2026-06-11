/**
 * PostToolUse hook — records tool execution results.
 */

import { readStdin, passThrough, getArceusDir } from "./utils.js";
import type { PostToolUseInput } from "./types.js";
import { logEvent } from "../state/index.js";

async function main(): Promise<void> {
  const input = await readStdin<PostToolUseInput>();
  const arceusDir = getArceusDir(input.cwd);

  // Log significant tool uses (skip noisy ones)
  const significantTools = [
    "Bash",
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "Agent",
  ];
  if (significantTools.includes(input.tool_name)) {
    const responseStr =
      typeof input.tool_response === "string"
        ? input.tool_response
        : JSON.stringify(input.tool_response ?? "");
    logEvent(arceusDir, input.session_id, {
      timestamp: new Date().toISOString(),
      event: "tool_use",
      data: {
        tool: input.tool_name,
        input: truncate(JSON.stringify(input.tool_input), 500),
        response: truncate(responseStr, 500),
      },
    });
  }

  classifyCodeEdit(arceusDir, input);
  classifyVerificationRun(arceusDir, input);

  passThrough();
}

function truncate(value: unknown, max: number): string {
  const str = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return str.length > max ? str.slice(0, max) + "..." : str;
}

// Verification command detection patterns (hardcoded per Decision 6 — not read from config).
const VERIFICATION_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  { kind: "verify", pattern: /\bnpm\s+run\s+verify\b/ },
  { kind: "typecheck", pattern: /\b(tsc\b|typecheck)/ },
  { kind: "lint", pattern: /\b(eslint|lint)\b/ },
  { kind: "test", pattern: /\b(vitest|jest|mocha|npm\s+(?:run\s+)?test)\b/ },
  { kind: "build", pattern: /\b(tsup|webpack|esbuild|npm\s+(?:run\s+)?build)\b/ },
];

// Failure markers used by the ok-heuristic (F1b).
// /\bERR!/ has no trailing \b — real npm output is "ERR! " (a space follows,
// never a word char, so a trailing \b can never fire). /[1-9]\d*/ excludes
// "0 errors" success summaries. /"exitCode":\s*[1-9]/ matches object-shaped
// tool_response after JSON.stringify (camelCase key has no space).
const FAILURE_MARKERS: RegExp[] = [
  /error\s+TS\d/i,
  /[1-9]\d*\s+errors?\b/i,
  /\bFAIL\b/,
  /\bERR!/,
  /exit code [1-9]/i,
  /"exitCode":\s*[1-9]/,
  /Command failed/i,
];

// Package-management segments must never be classified as verification runs —
// "npm install jest" would otherwise log a ghost verification_run (ok=true)
// that satisfies the strict gate without any tests running.
const PACKAGE_MANAGEMENT_GUARD =
  /\b(npm|pnpm|yarn|bun)\s+(install|i|uninstall|add|remove|link|ci)\b/;

/**
 * Emit a code_edit event when the tool is an edit-class tool.
 * file_path extraction follows F1a in spec. Own try/catch — failure does not affect passThrough.
 */
function classifyCodeEdit(arceusDir: string, input: PostToolUseInput): void {
  const editTools = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
  if (!editTools.has(input.tool_name)) return;
  try {
    let filePath: string;
    if (input.tool_name === "NotebookEdit") {
      filePath =
        typeof input.tool_input["notebook_path"] === "string"
          ? input.tool_input["notebook_path"]
          : "unknown";
    } else if (input.tool_name === "MultiEdit") {
      const top = input.tool_input["file_path"];
      if (typeof top === "string") {
        filePath = top;
      } else {
        const edits = input.tool_input["edits"] as unknown[] | undefined;
        const first = edits?.[0] as Record<string, unknown> | undefined;
        filePath =
          typeof first?.["file_path"] === "string"
            ? (first["file_path"] as string)
            : "unknown";
      }
    } else {
      // Edit or Write
      filePath =
        typeof input.tool_input["file_path"] === "string"
          ? (input.tool_input["file_path"] as string)
          : "unknown";
    }
    logEvent(arceusDir, input.session_id, {
      timestamp: new Date().toISOString(),
      event: "code_edit",
      data: {
        tool: input.tool_name,
        file_path: filePath,
      },
    });
  } catch {
    // Intentionally swallowed — classification failure must not affect passThrough.
  }
}

/**
 * Emit a verification_run event when the Bash command matches a known verification pattern.
 * Only emits when a pattern matches (non-verification Bash commands are skipped).
 * Own try/catch — failure does not affect passThrough.
 */
function classifyVerificationRun(
  arceusDir: string,
  input: PostToolUseInput,
): void {
  if (input.tool_name !== "Bash") return;
  try {
    const command =
      typeof input.tool_input["command"] === "string"
        ? (input.tool_input["command"] as string)
        : "";
    // Split compound commands so a package-management segment is never
    // classified ("npm install jest" must not count) while a verification
    // segment still counts ("npm install jest && npm test" → kind "test").
    const segments = command.split(/&&|\|\||[;|]/);
    let kind: string | null = null;
    for (const segment of segments) {
      if (PACKAGE_MANAGEMENT_GUARD.test(segment)) continue;
      for (const entry of VERIFICATION_PATTERNS) {
        if (entry.pattern.test(segment)) {
          kind = entry.kind;
          break;
        }
      }
      if (kind !== null) break;
    }
    if (kind === null) return; // Not a verification command — no event.

    const responseStr =
      typeof input.tool_response === "string"
        ? input.tool_response
        : JSON.stringify(input.tool_response ?? "");
    const ok = !FAILURE_MARKERS.some((m) => m.test(responseStr));

    logEvent(arceusDir, input.session_id, {
      timestamp: new Date().toISOString(),
      event: "verification_run",
      data: {
        kind,
        command: truncate(command, 200),
        ok,
      },
    });
  } catch {
    // Intentionally swallowed — classification failure must not affect passThrough.
  }
}

main().catch((err) => {
  process.stderr.write(`arceus post-tool-use hook error: ${err}\n`);
  process.exit(0);
});
