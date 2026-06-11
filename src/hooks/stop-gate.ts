/**
 * Stop gate predicate — pure module, no I/O.
 * Evaluates whether a session's code edits have been verified.
 */

import type { SessionEvent } from "../state/index.js";

export interface StopGateConfig {
  enabled: boolean;
  requireVerify: boolean;
  excludedPaths: string[];
}

export interface StopGateInput {
  events: SessionEvent[];
  config: StopGateConfig;
  stopHookActive: boolean;
}

export interface StopGateResult {
  action: "pass" | "warn" | "block";
  reason?: string;
  editedFiles: string[];
}

/**
 * Evaluate whether the session should be gated.
 *
 * Predicate (F2):
 * 1. enabled=false → pass
 * 2. stopHookActive → pass (loop protection)
 * 3. Collect code_edit events, filter via isExcludedPath
 * 4. No non-excluded edits → pass
 * 5. lastEditIndex = index of last non-excluded code_edit in events array
 * 6. Any verification_run with ok=true after lastEditIndex → pass
 * 7. Otherwise: strict→block, advisory→warn
 */
export function evaluateStopGate(input: StopGateInput): StopGateResult {
  const { events, config, stopHookActive } = input;

  // Step 1: master switch
  if (!config.enabled) {
    return { action: "pass", editedFiles: [] };
  }

  // Step 2: loop protection
  if (stopHookActive) {
    return { action: "pass", editedFiles: [] };
  }

  // Step 3: collect non-excluded code_edit events with their indices
  const editEntries: Array<{ index: number; filePath: string }> = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.event !== "code_edit") continue;
    const filePath = (ev.data?.["file_path"] as string | undefined) ?? "unknown";
    if (isExcludedPath(filePath, config.excludedPaths)) continue;
    editEntries.push({ index: i, filePath });
  }

  // Step 4: no non-excluded edits → pass
  if (editEntries.length === 0) {
    return { action: "pass", editedFiles: [] };
  }

  // Step 5: last non-excluded code_edit index
  const lastEditIndex = editEntries[editEntries.length - 1].index;

  // Step 6: find any ok verification_run after lastEditIndex
  const verified = events
    .slice(lastEditIndex + 1)
    .some(
      (ev) =>
        ev.event === "verification_run" &&
        (ev.data?.["ok"] as boolean | undefined) === true,
    );

  if (verified) {
    return { action: "pass", editedFiles: [] };
  }

  // Step 7: build editedFiles (deduplicated, max 10)
  const seen = new Set<string>();
  const editedFiles: string[] = [];
  for (const entry of editEntries) {
    if (!seen.has(entry.filePath)) {
      seen.add(entry.filePath);
      editedFiles.push(entry.filePath);
      if (editedFiles.length >= 10) break;
    }
  }

  if (config.requireVerify) {
    return {
      action: "block",
      reason:
        `[Arceus Stop Gate] Code was edited but no successful verification found after the last edit.\n` +
        `Unverified files: ${editedFiles.join(", ")}\n` +
        `Run verification before finishing: npm run verify (or: npm run typecheck && npm run lint && npm run test && npm run build).\n` +
        `驗證尚未通過，請先執行驗證指令再結束。`,
      editedFiles,
    };
  }

  return {
    action: "warn",
    reason:
      `[Arceus Stop Gate] Code was edited but no successful verification found after the last edit. Consider running 'npm run verify'.\n` +
      `Set stopGate.requireVerify=true in .arceus/config.json for hard gating.\n` +
      `程式碼已被修改但尚未通過驗證。`,
    editedFiles,
  };
}

/**
 * Test whether a file path matches an exclusion pattern (F6).
 *
 * Rules:
 * - "unknown" is never excluded (conservative strategy).
 * - Entry ending in "/" → prefix/substring match via includes (e.g. ".arceus/").
 * - Entry starting with "*" → suffix match via endsWith (e.g. "*.md").
 * - Otherwise → exact match.
 */
export function isExcludedPath(
  filePath: string,
  excludedPaths: string[],
): boolean {
  if (filePath === "unknown") return false;
  for (const pattern of excludedPaths) {
    if (pattern.endsWith("/")) {
      // Prefix/substring match — covers both ".arceus/foo.ts" and "src/.arceus/foo.ts"
      if (filePath.includes(pattern.slice(0, -1))) return true;
    } else if (pattern.startsWith("*")) {
      // Suffix match
      if (filePath.endsWith(pattern.slice(1))) return true;
    } else {
      // Exact match
      if (filePath === pattern) return true;
    }
  }
  return false;
}
