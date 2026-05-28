import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureArceusDir,
  ensureArceusGitignore,
} from "../../../src/state/index.js";

describe("ensureArceusGitignore", () => {
  let arceusDir: string;

  beforeEach(() => {
    const tempDir = mkdtempSync(join(tmpdir(), "arceus-test-"));
    arceusDir = join(tempDir, ".arceus");
  });

  afterEach(() => {
    const parentDir = join(arceusDir, "..");
    rmSync(parentDir, { recursive: true, force: true });
  });

  it("creates .arceus/.gitignore when missing", () => {
    ensureArceusDir(arceusDir);
    ensureArceusGitignore(arceusDir);

    const gitignorePath = join(arceusDir, ".gitignore");
    expect(existsSync(gitignorePath)).toBe(true);

    const content = readFileSync(gitignorePath, "utf-8");
    expect(content).toContain("notepad.md");
    expect(content).toContain("session-log/");
    expect(content).toContain(".preflight");
    expect(content).toContain("!changes/");
    expect(content).toContain("!config.json");
    // force-overrides.log must be explicitly re-included because *.log
    // would otherwise hide it from git status even inside changes/.
    expect(content).toContain("!changes/**/audit/force-overrides.log");
  });

  it("creates the arceus dir if it does not exist", () => {
    expect(existsSync(arceusDir)).toBe(false);
    ensureArceusGitignore(arceusDir);
    expect(existsSync(arceusDir)).toBe(true);
    expect(existsSync(join(arceusDir, ".gitignore"))).toBe(true);
  });

  it("is idempotent — does not overwrite user customizations", () => {
    ensureArceusDir(arceusDir);
    const gitignorePath = join(arceusDir, ".gitignore");

    const customized = "# my custom rules\nmy-secret-cache/\n!changes/\n";
    writeFileSync(gitignorePath, customized, "utf-8");

    ensureArceusGitignore(arceusDir);

    const after = readFileSync(gitignorePath, "utf-8");
    expect(after).toBe(customized);
  });
});
