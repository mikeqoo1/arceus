import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  ensureArceusDir,
  ensureChangesDir,
  createChange,
  updateChangeStatus,
  recordVerification,
  writeConfig,
  getChange,
  getForceOverridesLogPath,
} from "../../../src/state/index.js";
import type { ArceusProjectConfig } from "../../../src/state/config.js";

/**
 * The completion gate has three modes:
 *   - disabled (config.checkSpec.enabled = false)
 *   - advisory (default — no config, or requireApprove omitted/false)
 *   - strict   (config.checkSpec.requireApprove = true)
 *
 * Strict mode additionally requires verifiedSha === git rev-parse HEAD.
 * `--force` is honored only in strict; advisory is already non-blocking.
 */

interface Sandbox {
  root: string;
  arceusDir: string;
  changeId: string;
}

function initGitRepoWithCommit(root: string): string {
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
  // Create one commit so HEAD resolves.
  writeFileSync(join(root, "README.md"), "test\n", "utf-8");
  spawnSync("git", ["add", "README.md"], { cwd: root });
  spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: root });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" });
  return head.stdout.trim();
}

function initGitRepoNoCommit(root: string): void {
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test"], { cwd: root });
}

function setupSandbox(opts: { withCommit?: boolean; config?: ArceusProjectConfig } = {}): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "arceus-gate-"));
  const arceusDir = join(root, ".arceus");
  ensureArceusDir(arceusDir);
  ensureChangesDir(arceusDir);
  if (opts.config) writeConfig(arceusDir, opts.config);
  if (opts.withCommit) {
    initGitRepoWithCommit(root);
  } else {
    initGitRepoNoCommit(root);
  }
  const change = createChange(arceusDir, "Test change");
  // Advance status to active so completed transition is valid input.
  updateChangeStatus(arceusDir, change.id, "active", { skipGate: true });
  return { root, arceusDir, changeId: change.id };
}

function teardown(s: Sandbox): void {
  rmSync(s.root, { recursive: true, force: true });
}

describe("updateChangeStatus — disabled gate", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox({
      withCommit: true,
      config: { checkSpec: { enabled: false } },
    });
  });
  afterEach(() => teardown(s));

  it("allows completed without verdict, prints no warning", () => {
    const warn = vi.fn();
    expect(() =>
      updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn }),
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("updateChangeStatus — advisory gate (default)", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox({ withCommit: true });
  });
  afterEach(() => teardown(s));

  it("allows completed without verdict, but warns", () => {
    const warn = vi.fn();
    updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/No APPROVE verdict/);
  });

  it("allows completed with APPROVE verdict, no warning", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: s.root, encoding: "utf-8" }).stdout.trim();
    recordVerification(s.arceusDir, s.changeId, {
      verdict: "APPROVE",
      verifiedSha: head,
      verifiedBase: "origin/main",
    });
    const warn = vi.fn();
    updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn });
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when --force is passed (no-op in advisory)", () => {
    const warn = vi.fn();
    updateChangeStatus(s.arceusDir, s.changeId, "completed", {
      gitCwd: s.root,
      warn,
      force: true,
    });
    const messages = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(messages).toMatch(/--force has no effect in advisory mode/);
  });

  it("does NOT write force-overrides.log in advisory mode", () => {
    updateChangeStatus(s.arceusDir, s.changeId, "completed", {
      gitCwd: s.root,
      warn: vi.fn(),
      force: true,
    });
    const log = getForceOverridesLogPath(s.arceusDir, s.changeId);
    expect(existsSync(log)).toBe(false);
  });
});

describe("updateChangeStatus — strict gate", () => {
  let s: Sandbox;
  let head: string;

  beforeEach(() => {
    s = setupSandbox({
      withCommit: true,
      config: { checkSpec: { enabled: true, requireApprove: true } },
    });
    head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: s.root, encoding: "utf-8" }).stdout.trim();
  });
  afterEach(() => teardown(s));

  it("throws when verdict is missing", () => {
    expect(() =>
      updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn: vi.fn() }),
    ).toThrow(/No APPROVE verdict/);
  });

  it("throws when verdict is REQUEST_CHANGES", () => {
    recordVerification(s.arceusDir, s.changeId, {
      verdict: "REQUEST_CHANGES",
      verifiedSha: head,
      verifiedBase: "origin/main",
    });
    expect(() =>
      updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn: vi.fn() }),
    ).toThrow(/REQUEST_CHANGES/);
  });

  it("throws when verifiedSha does not match HEAD", () => {
    recordVerification(s.arceusDir, s.changeId, {
      verdict: "APPROVE",
      verifiedSha: "deadbeef0000000000000000000000000000dead",
      verifiedBase: "origin/main",
    });
    expect(() =>
      updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn: vi.fn() }),
    ).toThrow(/does not match current HEAD/);
  });

  it("succeeds when verdict is APPROVE and SHA matches", () => {
    recordVerification(s.arceusDir, s.changeId, {
      verdict: "APPROVE",
      verifiedSha: head,
      verifiedBase: "origin/main",
    });
    const updated = updateChangeStatus(s.arceusDir, s.changeId, "completed", {
      gitCwd: s.root,
      warn: vi.fn(),
    });
    expect(updated.status).toBe("completed");
  });

  it("--force bypasses and writes audit/force-overrides.log", () => {
    const warn = vi.fn();
    const updated = updateChangeStatus(s.arceusDir, s.changeId, "completed", {
      gitCwd: s.root,
      warn,
      force: true,
      forceReason: "deadline",
      forceActor: "tester",
    });
    expect(updated.status).toBe("completed");
    expect(warn).toHaveBeenCalled();
    const log = getForceOverridesLogPath(s.arceusDir, s.changeId);
    expect(existsSync(log)).toBe(true);
    const content = readFileSync(log, "utf-8");
    expect(content).toMatch(/actor=tester/);
    expect(content).toMatch(/reason="deadline"/);
  });

  it("collapses newlines in --force reason so each entry stays one line", () => {
    const updated = updateChangeStatus(s.arceusDir, s.changeId, "completed", {
      gitCwd: s.root,
      warn: vi.fn(),
      force: true,
      forceReason: "line one\nline two\rline three",
      forceActor: "tester",
    });
    expect(updated.status).toBe("completed");
    const log = getForceOverridesLogPath(s.arceusDir, s.changeId);
    const content = readFileSync(log, "utf-8");
    // Exactly one trailing newline → exactly one entry.
    expect(content.split("\n").filter((l) => l.length > 0)).toHaveLength(1);
    expect(content).toMatch(/reason="line one line two line three"/);
  });
});

describe("updateChangeStatus — strict gate on zero-commit repo", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox({
      withCommit: false,
      config: { checkSpec: { enabled: true, requireApprove: true } },
    });
    // Record an APPROVE verdict so the SHA check is the failing step, not
    // the verdict check.
    recordVerification(s.arceusDir, s.changeId, {
      verdict: "APPROVE",
      verifiedSha: "fakesha",
      verifiedBase: "origin/main",
    });
  });
  afterEach(() => teardown(s));

  it("throws with a friendly 'Cannot resolve HEAD' message, not a git stack", () => {
    expect(() =>
      updateChangeStatus(s.arceusDir, s.changeId, "completed", { gitCwd: s.root, warn: vi.fn() }),
    ).toThrow(/Cannot resolve HEAD/);
  });
});

describe("updateChangeStatus — non-completed transitions are unaffected", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox({
      withCommit: false,  // intentionally no commit — proves gate doesn't trip
      config: { checkSpec: { enabled: true, requireApprove: true } },
    });
  });
  afterEach(() => teardown(s));

  it("draft → active passes even with strict gate enabled and no verdict", () => {
    const change = createChange(s.arceusDir, "Another");
    const updated = updateChangeStatus(s.arceusDir, change.id, "active", { gitCwd: s.root });
    expect(updated.status).toBe("active");
  });
});

describe("recordVerification", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox({ withCommit: true });
  });
  afterEach(() => teardown(s));

  it("writes all five verification fields to meta.json", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: s.root, encoding: "utf-8" }).stdout.trim();
    const updated = recordVerification(s.arceusDir, s.changeId, {
      verdict: "APPROVE",
      verifiedSha: head,
      verifiedBase: "origin/main",
      verificationModel: "claude-opus-4-7",
      verificationBinaryVersion: "check-spec v0.1.0",
    });

    expect(updated.verdict).toBe("APPROVE");
    expect(updated.verifiedSha).toBe(head);
    expect(updated.verifiedBase).toBe("origin/main");
    expect(updated.verificationModel).toBe("claude-opus-4-7");
    expect(updated.verificationBinaryVersion).toBe("check-spec v0.1.0");
    expect(updated.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Re-read from disk to confirm persistence.
    const reread = getChange(s.arceusDir, s.changeId);
    expect(reread?.verdict).toBe("APPROVE");
  });
});

// Sanity check: ensure mkdir helper imported successfully (avoid unused-imports flag from eslint).
void mkdirSync;
