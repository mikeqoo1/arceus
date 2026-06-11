/**
 * Preflight — git-state checks that gate the first code modification per session.
 *
 * Enforces:
 *   1. Not on a protected branch (main/master/develop/trunk by default).
 *   2. Local branch is not behind upstream (after a best-effort fetch).
 *
 * Once preflight passes for a session, a marker file is written so subsequent
 * Edit/Write tool calls skip the check.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface PreflightOptions {
  /** Branches that block code edits. Defaults to main/master/develop/trunk. */
  protectedBranches?: string[];
  /** Run `git fetch` before checking upstream divergence. Defaults to true. */
  fetch?: boolean;
  /** If true, behind-upstream blocks. Defaults to true. */
  requireUpstreamSynced?: boolean;
  /** Timeout for git fetch in ms. Defaults to 3s — must stay well under the
   *  PreToolUse hook timeout (hooks.json) so the remaining git calls fit. */
  fetchTimeoutMs?: number;
}

export interface PreflightResult {
  ok: boolean;
  reason?: string;
  suggestedBranch?: string;
  currentBranch?: string;
}

const DEFAULT_PROTECTED = ["main", "master", "develop", "trunk"];

function gitOutput(cwd: string, args: string[], timeoutMs?: number): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      ...(timeoutMs ? { timeout: timeoutMs } : {}),
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(cwd: string): boolean {
  return gitOutput(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

function suggestBranchName(): string {
  const datePart = new Date().toISOString().slice(0, 10);
  return `feature/${datePart}-task`;
}

export function runGitPreflight(
  cwd: string,
  options: PreflightOptions = {},
): PreflightResult {
  if (!isGitRepo(cwd)) {
    return { ok: true };
  }

  const protectedBranches = options.protectedBranches ?? DEFAULT_PROTECTED;
  const shouldFetch = options.fetch ?? true;
  const requireUpstreamSynced = options.requireUpstreamSynced ?? true;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? 3_000;

  const branch = gitOutput(cwd, ["branch", "--show-current"]) ?? "";

  // Detached HEAD — `git branch --show-current` returns empty. Block edits
  // because the work would be lost on the next checkout.
  if (branch === "") {
    const suggested = suggestBranchName();
    return {
      ok: false,
      currentBranch: "",
      suggestedBranch: suggested,
      reason: `Detached HEAD detected. Create a branch before editing — e.g. \`git checkout -b ${suggested}\`.`,
    };
  }

  if (protectedBranches.includes(branch)) {
    const suggested = suggestBranchName();
    return {
      ok: false,
      currentBranch: branch,
      suggestedBranch: suggested,
      reason: `On protected branch '${branch}'. Switch to a feature branch before editing — e.g. \`git checkout -b ${suggested}\`.`,
    };
  }

  if (requireUpstreamSynced) {
    if (shouldFetch) {
      // Best-effort; offline / no-remote shouldn't block.
      gitOutput(cwd, ["fetch", "--quiet"], fetchTimeoutMs);
    }

    const upstream = gitOutput(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{u}",
    ]);
    if (upstream) {
      const behindStr = gitOutput(cwd, [
        "rev-list",
        "--count",
        "HEAD..@{u}",
      ]);
      const behind = behindStr ? parseInt(behindStr, 10) : 0;
      if (behind > 0) {
        return {
          ok: false,
          currentBranch: branch,
          reason: `Local branch '${branch}' is ${behind} commit(s) behind ${upstream}. Pull or rebase before editing.`,
        };
      }
    }
  }

  return { ok: true, currentBranch: branch };
}

export function getPreflightMarkerPath(arceusDir: string, sessionId: string): string {
  return join(arceusDir, "sessions", sessionId, "preflight.ok");
}

export function isPreflightDone(arceusDir: string, sessionId: string): boolean {
  return existsSync(getPreflightMarkerPath(arceusDir, sessionId));
}

export function markPreflightDone(arceusDir: string, sessionId: string): void {
  const path = getPreflightMarkerPath(arceusDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date().toISOString(), "utf-8");
}

/**
 * Fetch-attempt marker — `git fetch` runs at most once per session. While
 * preflight is FAILING (e.g. protected branch) the gate re-runs on every
 * modifying tool call; without this marker each retry pays the network
 * fetch (up to fetchTimeoutMs) again.
 */
export function getFetchAttemptMarkerPath(
  arceusDir: string,
  sessionId: string,
): string {
  return join(arceusDir, "sessions", sessionId, "preflight.fetched");
}

export function hasFetchAttempted(
  arceusDir: string,
  sessionId: string,
): boolean {
  return existsSync(getFetchAttemptMarkerPath(arceusDir, sessionId));
}

export function markFetchAttempted(
  arceusDir: string,
  sessionId: string,
): void {
  const path = getFetchAttemptMarkerPath(arceusDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Date().toISOString(), "utf-8");
}
