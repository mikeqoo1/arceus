/**
 * Change — persistent spec-driven artifacts under .arceus/changes/.
 *
 * Each change is a folder containing proposal, spec, tasks, decisions
 * and meta.json. The whole folder is git-committable so team members can
 * review each other's AI-produced plans before implementation.
 */

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readConfig } from "./config.js";

export type ChangeStatus = "draft" | "active" | "completed" | "archived";

export interface ChangeMeta {
  id: string;
  title: string;
  status: ChangeStatus;
  createdAt: string;
  updatedAt: string;
  author?: string;
  linkedPr?: string;
  linkedBranch?: string;
  /** Latest check-spec verdict, if any. */
  verdict?: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  /** HEAD SHA at the time the verdict was recorded — used by strict gate for freshness. */
  verifiedSha?: string;
  /** ISO timestamp when the verdict was recorded. */
  verifiedAt?: string;
  /** Base ref used in the verification (e.g. "origin/main"). */
  verifiedBase?: string;
  /** LLM model id used by check-spec (e.g. "claude-opus-4-7"). */
  verificationModel?: string;
  /** check-spec binary version recorded for diagnostic traceability. */
  verificationBinaryVersion?: string;
}

export interface Change extends ChangeMeta {
  dir: string;
  files: {
    proposal: string;
    spec: string;
    tasks: string;
    decisions: string;
  };
}

export interface ChangeSummary extends ChangeMeta {
  dir: string;
}

export interface CreateChangeOptions {
  author?: string;
  now?: Date;
}

const CHANGES_DIR = "changes";
const ARCHIVE_DIR = "archive";
const META_FILE = "meta.json";
const FILES = {
  proposal: "proposal.md",
  spec: "spec.md",
  tasks: "tasks.md",
  decisions: "decisions.md",
} as const;

// --- Path helpers ---

function getChangesRoot(arceusDir: string): string {
  return join(arceusDir, CHANGES_DIR);
}

function getArchiveRoot(arceusDir: string): string {
  return join(arceusDir, CHANGES_DIR, ARCHIVE_DIR);
}

function getChangeDir(arceusDir: string, id: string, archived = false): string {
  return archived
    ? join(getArchiveRoot(arceusDir), id)
    : join(getChangesRoot(arceusDir), id);
}

const AUDIT_DIR = "audit";
const AUDIT_LATEST = "latest.md";
const FORCE_OVERRIDES_LOG = "force-overrides.log";

export function getAuditDir(arceusDir: string, id: string, archived = false): string {
  return join(getChangeDir(arceusDir, id, archived), AUDIT_DIR);
}

export function getAuditLatestPath(arceusDir: string, id: string, archived = false): string {
  return join(getAuditDir(arceusDir, id, archived), AUDIT_LATEST);
}

export function getForceOverridesLogPath(arceusDir: string, id: string, archived = false): string {
  return join(getAuditDir(arceusDir, id, archived), FORCE_OVERRIDES_LOG);
}

// --- Slug / id generation ---

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s一-鿿-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function uniqueId(arceusDir: string, baseId: string): string {
  const root = getChangesRoot(arceusDir);
  const archive = getArchiveRoot(arceusDir);
  let candidate = baseId;
  let n = 2;
  while (existsSync(join(root, candidate)) || existsSync(join(archive, candidate))) {
    candidate = `${baseId}-${n}`;
    n += 1;
  }
  return candidate;
}

// --- Templates ---

function proposalTemplate(title: string): string {
  return `# ${title}

## 為什麼 (Why)

_說明為什麼要做這個 change。問題是什麼、現況痛點、期望效益。_

## 範圍 (Scope)

_明確列出包含 / 不包含的項目。_

- **In scope**:
- **Out of scope**:

## Stakeholders

_誰是這個 change 的 owner / reviewer / 受影響的人。_
`;
}

function specTemplate(title: string): string {
  return `# Spec — ${title}

## 需求描述

_自由格式描述需求，可以寫 user story、功能列表、畫面示意等。_

## 驗收條件

_這個 change 被認為完成的條件。_

- [ ]
- [ ]

## 技術假設

_依賴的前提、外部系統、現有架構限制。_
`;
}

function tasksTemplate(title: string): string {
  return `# Tasks — ${title}

_實作階段的 checklist。arceus:coder 會依序處理並打勾回報。_

- [ ]
- [ ]
- [ ]
`;
}

function decisionsTemplate(title: string): string {
  return `# Decisions — ${title}

_記錄技術選擇與替代方案，避免未來重新爭論同樣的問題。_

## Decision 1:

- **Context**:
- **Options considered**:
- **Chosen**:
- **Rationale**:
`;
}

// --- Core operations ---

export function ensureChangesDir(arceusDir: string): void {
  const root = getChangesRoot(arceusDir);
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const archive = getArchiveRoot(arceusDir);
  if (!existsSync(archive)) mkdirSync(archive, { recursive: true });
}

export function createChange(
  arceusDir: string,
  title: string,
  options: CreateChangeOptions = {},
): Change {
  if (!title.trim()) {
    throw new Error("Change title cannot be empty");
  }

  ensureChangesDir(arceusDir);

  const now = options.now ?? new Date();
  const datePart = formatDate(now);
  const slug = slugify(title);
  if (!slug) {
    throw new Error(`Cannot derive slug from title: "${title}"`);
  }
  const id = uniqueId(arceusDir, `${datePart}-${slug}`);
  const dir = getChangeDir(arceusDir, id);

  mkdirSync(dir, { recursive: true });

  const meta: ChangeMeta = {
    id,
    title: title.trim(),
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...(options.author ? { author: options.author } : {}),
  };

  writeFileSync(
    join(dir, META_FILE),
    JSON.stringify(meta, null, 2) + "\n",
    "utf-8",
  );
  writeFileSync(join(dir, FILES.proposal), proposalTemplate(meta.title), "utf-8");
  writeFileSync(join(dir, FILES.spec), specTemplate(meta.title), "utf-8");
  writeFileSync(join(dir, FILES.tasks), tasksTemplate(meta.title), "utf-8");
  writeFileSync(
    join(dir, FILES.decisions),
    decisionsTemplate(meta.title),
    "utf-8",
  );

  return {
    ...meta,
    dir,
    files: {
      proposal: join(dir, FILES.proposal),
      spec: join(dir, FILES.spec),
      tasks: join(dir, FILES.tasks),
      decisions: join(dir, FILES.decisions),
    },
  };
}

function readMeta(dir: string): ChangeMeta | null {
  const metaPath = join(dir, META_FILE);
  if (!existsSync(metaPath)) return null;
  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as ChangeMeta;
  } catch {
    return null;
  }
}

function toChange(dir: string, meta: ChangeMeta): Change {
  return {
    ...meta,
    dir,
    files: {
      proposal: join(dir, FILES.proposal),
      spec: join(dir, FILES.spec),
      tasks: join(dir, FILES.tasks),
      decisions: join(dir, FILES.decisions),
    },
  };
}

export function getChange(arceusDir: string, id: string): Change | null {
  const activeDir = getChangeDir(arceusDir, id, false);
  if (existsSync(activeDir)) {
    const meta = readMeta(activeDir);
    if (meta) return toChange(activeDir, meta);
  }
  const archivedDir = getChangeDir(arceusDir, id, true);
  if (existsSync(archivedDir)) {
    const meta = readMeta(archivedDir);
    if (meta) return toChange(archivedDir, meta);
  }
  return null;
}

export interface ListChangesOptions {
  status?: ChangeStatus | ChangeStatus[];
  includeArchived?: boolean;
}

export function listChanges(
  arceusDir: string,
  options: ListChangesOptions = {},
): ChangeSummary[] {
  const root = getChangesRoot(arceusDir);
  if (!existsSync(root)) return [];

  const results: ChangeSummary[] = [];
  const statusFilter = options.status
    ? new Set(Array.isArray(options.status) ? options.status : [options.status])
    : null;

  const collectFrom = (parent: string) => {
    if (!existsSync(parent)) return;
    for (const name of readdirSync(parent)) {
      if (name === ARCHIVE_DIR) continue;
      const dir = join(parent, name);
      if (!statSync(dir).isDirectory()) continue;
      const meta = readMeta(dir);
      if (!meta) continue;
      if (statusFilter && !statusFilter.has(meta.status)) continue;
      results.push({ ...meta, dir });
    }
  };

  collectFrom(root);
  if (options.includeArchived) {
    collectFrom(getArchiveRoot(arceusDir));
  }

  results.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return results;
}

export interface UpdateChangeStatusOptions {
  /** Override repo root for git rev-parse HEAD (testing). Defaults to process.cwd(). */
  gitCwd?: string;
  /** Strict mode escape hatch: bypass the APPROVE/SHA gate (writes a force-overrides.log entry). */
  force?: boolean;
  /** Free-text reason recorded with --force entries (e.g. "deadline"). */
  forceReason?: string;
  /** Identity recorded with --force entries. Defaults to git config user.name or $USER. */
  forceActor?: string;
  /** Skip the gate entirely (intended for tests that don't exercise gate logic). */
  skipGate?: boolean;
  /** Logger for warnings. Defaults to writing to stderr. */
  warn?: (msg: string) => void;
}

function defaultWarn(msg: string): void {
  process.stderr.write(msg.endsWith("\n") ? msg : `${msg}\n`);
}

function resolveHeadSha(cwd: string): { sha: string | null; reason: string | null } {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" });
  if (result.status === 0 && result.stdout) {
    return { sha: result.stdout.trim(), reason: null };
  }
  const stderr = (result.stderr ?? "").toString();
  // Distinguish "no commits yet" from "not a git repo" for clearer messages.
  if (/ambiguous argument 'HEAD'|unknown revision/i.test(stderr) || /Needed a single revision/i.test(stderr)) {
    return { sha: null, reason: "zero-commit repo (HEAD is unborn)" };
  }
  if (/not a git repository/i.test(stderr)) {
    return { sha: null, reason: "not a git repository" };
  }
  return { sha: null, reason: stderr.trim() || `git rev-parse HEAD exited ${result.status}` };
}

function resolveForceActor(explicit: string | undefined, cwd: string): string {
  if (explicit) return explicit;
  const fromGit = spawnSync("git", ["config", "user.name"], { cwd, encoding: "utf-8" });
  if (fromGit.status === 0 && fromGit.stdout?.trim()) {
    return fromGit.stdout.trim();
  }
  return process.env["USER"] ?? process.env["USERNAME"] ?? "unknown";
}

function writeForceOverride(
  arceusDir: string,
  changeDir: string,
  id: string,
  meta: ChangeMeta,
  options: UpdateChangeStatusOptions,
): void {
  void arceusDir;
  void id;
  const auditDir = join(changeDir, AUDIT_DIR);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const actor = resolveForceActor(options.forceActor, options.gitCwd ?? process.cwd());
  const reason = options.forceReason ?? "(no reason given)";
  const line =
    `${new Date().toISOString()} actor=${actor} reason="${reason.replace(/"/g, "'")}" ` +
    `verdict=${meta.verdict ?? "none"} verifiedSha=${meta.verifiedSha ?? "none"}\n`;
  appendFileSync(join(auditDir, FORCE_OVERRIDES_LOG), line, "utf-8");
}

/**
 * Enforce the check-spec completion gate when transitioning to `completed`.
 *
 * Three modes — see CLAUDE.md and spec.md F3:
 *   - disabled: bypass entirely.
 *   - advisory (default when enabled): emit a warning if verdict is missing
 *     or non-APPROVE, but allow the transition.
 *   - strict (requireApprove=true): require APPROVE verdict + matching HEAD
 *     SHA. `--force` bypasses with an audit log entry.
 *
 * Throws Error for blocking failures so the CLI can map to non-zero exit.
 */
function enforceCompletionGate(
  arceusDir: string,
  change: Change,
  options: UpdateChangeStatusOptions,
): void {
  const config = readConfig(arceusDir);
  const checkSpec = config.checkSpec ?? {};
  const enabled = checkSpec.enabled !== false;       // default true
  const requireApprove = checkSpec.requireApprove === true;  // default false
  const warn = options.warn ?? defaultWarn;

  if (!enabled) return;

  if (!requireApprove) {
    // Advisory mode.
    if (options.force) {
      warn("[arceus] --force has no effect in advisory mode; gate is already non-blocking.");
    }
    if (change.verdict !== "APPROVE") {
      warn(
        `[arceus] No APPROVE verdict for ${change.id} ` +
        `(current: ${change.verdict ?? "none"}). Marking completed anyway — ` +
        `run 'arceus change verify ${change.id}' for an independent audit, ` +
        `or set checkSpec.requireApprove=true for hard gating.`,
      );
    }
    return;
  }

  // Strict mode.
  if (options.force) {
    writeForceOverride(arceusDir, change.dir, change.id, change, options);
    warn(`[arceus] Strict gate bypassed via --force for ${change.id}.`);
    return;
  }

  if (change.verdict !== "APPROVE") {
    throw new Error(
      `No APPROVE verdict for ${change.id} (current: ${change.verdict ?? "none"}). ` +
      `Run 'arceus change verify ${change.id}' first, or pass --force.`,
    );
  }

  const { sha, reason } = resolveHeadSha(options.gitCwd ?? process.cwd());
  if (!sha) {
    throw new Error(
      `Cannot resolve HEAD (${reason ?? "unknown"}). ` +
      `Strict gate cannot verify SHA freshness — please commit at least once before marking completed.`,
    );
  }

  if (change.verifiedSha !== sha) {
    throw new Error(
      `verifiedSha (${change.verifiedSha ?? "none"}) does not match current HEAD (${sha}). ` +
      `Re-run 'arceus change verify ${change.id}' after the latest commit.`,
    );
  }
}

export function updateChangeStatus(
  arceusDir: string,
  id: string,
  status: ChangeStatus,
  options: UpdateChangeStatusOptions = {},
): Change {
  const change = getChange(arceusDir, id);
  if (!change) throw new Error(`Change not found: ${id}`);

  if (status === "completed" && !options.skipGate) {
    enforceCompletionGate(arceusDir, change, options);
  }

  const updated: ChangeMeta = {
    ...stripChangeFields(change),
    status,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(
    join(change.dir, META_FILE),
    JSON.stringify(updated, null, 2) + "\n",
    "utf-8",
  );

  return toChange(change.dir, updated);
}

/**
 * Persist the latest check-spec verdict to meta.json. Caller (cli.ts) is
 * responsible for writing the report file itself; this only touches meta.
 */
export interface RecordVerificationInput {
  verdict: "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";
  verifiedSha: string;
  verifiedBase: string;
  verificationModel?: string;
  verificationBinaryVersion?: string;
}

export function recordVerification(
  arceusDir: string,
  id: string,
  input: RecordVerificationInput,
  now: Date = new Date(),
): Change {
  const change = getChange(arceusDir, id);
  if (!change) throw new Error(`Change not found: ${id}`);

  const updated: ChangeMeta = {
    ...stripChangeFields(change),
    verdict: input.verdict,
    verifiedSha: input.verifiedSha,
    verifiedAt: now.toISOString(),
    verifiedBase: input.verifiedBase,
    ...(input.verificationModel ? { verificationModel: input.verificationModel } : {}),
    ...(input.verificationBinaryVersion
      ? { verificationBinaryVersion: input.verificationBinaryVersion }
      : {}),
    updatedAt: now.toISOString(),
  };

  writeFileSync(
    join(change.dir, META_FILE),
    JSON.stringify(updated, null, 2) + "\n",
    "utf-8",
  );
  return toChange(change.dir, updated);
}

export function archiveChange(arceusDir: string, id: string): Change {
  const change = getChange(arceusDir, id);
  if (!change) throw new Error(`Change not found: ${id}`);

  ensureChangesDir(arceusDir);
  const archivedDir = getChangeDir(arceusDir, id, true);

  if (change.dir === archivedDir) {
    return updateChangeStatus(arceusDir, id, "archived");
  }

  if (existsSync(archivedDir)) {
    throw new Error(`Archived change already exists: ${id}`);
  }

  renameSync(change.dir, archivedDir);

  const updated: ChangeMeta = {
    ...stripChangeFields(change),
    status: "archived",
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(
    join(archivedDir, META_FILE),
    JSON.stringify(updated, null, 2) + "\n",
    "utf-8",
  );
  return toChange(archivedDir, updated);
}

export function deleteChange(arceusDir: string, id: string): void {
  const change = getChange(arceusDir, id);
  if (!change) return;
  rmSync(change.dir, { recursive: true, force: true });
}

export function readChangeFile(
  change: Change,
  file: keyof Change["files"],
): string {
  const path = change.files[file];
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

export function writeChangeFile(
  change: Change,
  file: keyof Change["files"],
  content: string,
): void {
  writeFileSync(change.files[file], content, "utf-8");
  const meta = readMeta(change.dir);
  if (meta) {
    const updated: ChangeMeta = {
      ...meta,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(
      join(change.dir, META_FILE),
      JSON.stringify(updated, null, 2) + "\n",
      "utf-8",
    );
  }
}

function stripChangeFields(change: Change): ChangeMeta {
  const { dir: _dir, files: _files, ...meta } = change;
  void _dir;
  void _files;
  return meta;
}
