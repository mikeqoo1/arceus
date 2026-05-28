/**
 * Arceus project config — stored in .arceus/config.json.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

export interface ArceusProjectConfig {
  /** Task sources to sync with */
  taskSources?: TaskSourceEntry[];
  /** Model preferences per agent type */
  modelPreferences?: Record<string, string>;
  /** Verification commands to run */
  verification?: {
    build?: string;
    test?: string;
    lint?: string;
    typecheck?: string;
  };
  /** Max retry rounds for verification failures */
  maxRetries?: number;
  /** Preflight check tuning (PreToolUse hook) */
  preflight?: {
    /** Disable the preflight gate entirely. */
    disabled?: boolean;
    /** Branches that block edits. Defaults to main/master/develop/trunk. */
    protectedBranches?: string[];
    /** Run `git fetch` before the upstream check. Defaults to true. */
    fetch?: boolean;
    /** Block when local branch is behind upstream. Defaults to true. */
    requireUpstreamSynced?: boolean;
    /** Timeout for `git fetch` in ms. Defaults to 10000. */
    fetchTimeoutMs?: number;
  };
}

export interface TaskSourceEntry {
  type: "github" | "gitlab" | "plane";
  token?: string;
  tokenEnv?: string;
  owner?: string;
  repo?: string;
  url?: string;
  workspace?: string;
  project?: string;
}

const CONFIG_FILE = "config.json";

function getConfigPath(arceusDir: string): string {
  return join(arceusDir, CONFIG_FILE);
}

export function readConfig(arceusDir: string): ArceusProjectConfig {
  const path = getConfigPath(arceusDir);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as ArceusProjectConfig;
  } catch {
    // Malformed config.json should not bring down hooks; treat as empty.
    return {};
  }
}

export function writeConfig(
  arceusDir: string,
  config: ArceusProjectConfig,
): void {
  const path = getConfigPath(arceusDir);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function ensureArceusDir(arceusDir: string): void {
  if (!existsSync(arceusDir)) {
    mkdirSync(arceusDir, { recursive: true });
  }
  // Ensure subdirectories
  for (const sub of ["memory", "sessions", "skills"]) {
    const dir = join(arceusDir, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

const GITIGNORE_FILE = ".gitignore";

const DEFAULT_ARCEUS_GITIGNORE = `# Runtime state — never committed.
notepad.md
session-log/
sessions/
.preflight
.session/
memory/

# Logs / temp
*.log
*.tmp

# Spec-driven artifacts — explicitly allowed (defense in depth even
# if the repo root .gitignore is misconfigured).
!changes/
!config.json
!.gitkeep
!.gitignore
`;

/**
 * Write a nested .gitignore inside .arceus/ that protects runtime state
 * (notepad, session logs, preflight markers) from being committed, while
 * explicitly allowing the spec-driven artifacts (changes/, config.json).
 *
 * Idempotent: a no-op when the file already exists, so user customizations
 * are preserved across `arceus init` upgrades.
 */
export function ensureArceusGitignore(arceusDir: string): void {
  const path = join(arceusDir, GITIGNORE_FILE);
  if (existsSync(path)) return;
  if (!existsSync(arceusDir)) {
    mkdirSync(arceusDir, { recursive: true });
  }
  writeFileSync(path, DEFAULT_ARCEUS_GITIGNORE, "utf-8");
}
