/**
 * Plugin manifest integrity tests.
 *
 * Regression guards born from 2026-06-11-remove-vestigial-mcp-server-registration:
 * the repo used to ship a root .mcp.json registering dist/mcp-server.js — an
 * entry point that never existed. These tests pin the invariants at the SOURCE
 * level (no build output required):
 *   1. manifest references must point at files that exist
 *   2. the repo root must not regain a .mcp.json (dual plugin/project identity
 *      under symlinked installs — see that change's decisions.md Decision 2)
 *   3. every hooks.json command must map to a real src/hooks entry
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf-8"),
) as Record<string, unknown>;

describe("plugin.json manifest integrity", () => {
  it("parses with required fields", () => {
    expect(manifest["name"]).toBe("arceus");
    expect(String(manifest["version"])).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("mcpServers, when declared as a path, references an existing file", () => {
    // Paths in plugin.json resolve relative to the plugin root (repo root).
    const mcp = manifest["mcpServers"];
    if (typeof mcp === "string") {
      expect(existsSync(join(ROOT, mcp)), "dead mcpServers path: " + mcp).toBe(
        true,
      );
    }
  });

  it("repo root has no .mcp.json (dual plugin/project identity hazard)", () => {
    // If a real arceus-state MCP server lands, register it INLINE in the
    // plugin.json mcpServers field — see decisions.md Decision 2 of
    // 2026-06-11-remove-vestigial-mcp-server-registration.
    expect(existsSync(join(ROOT, ".mcp.json"))).toBe(false);
  });

  it("every hooks.json command maps to an existing src/hooks/*.ts entry", () => {
    const hooksConfig = JSON.parse(
      readFileSync(join(ROOT, "hooks", "hooks.json"), "utf-8"),
    ) as {
      hooks: Record<string, Array<{ hooks: Array<{ command?: string }> }>>;
    };
    const commands = Object.values(hooksConfig.hooks)
      .flat()
      .flatMap((entry) => entry.hooks)
      .map((h) => h.command ?? "");
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const match = cmd.match(/dist\/hooks\/([\w-]+)\.js/);
      expect(match, "unrecognized hook command shape: " + cmd).not.toBeNull();
      if (!match) continue;
      const srcPath = join(ROOT, "src", "hooks", match[1] + ".ts");
      expect(existsSync(srcPath), "missing source for hook command: " + cmd).toBe(
        true,
      );
    }
  });
});

describe("hooks.json PreToolUse preflight coverage (issue #5)", () => {
  const hooksConfig = JSON.parse(
    readFileSync(join(ROOT, "hooks", "hooks.json"), "utf-8"),
  ) as {
    hooks: Record<
      string,
      Array<{ matcher?: string; hooks: Array<{ timeout?: number }> }>
    >;
  };
  const preToolUse = hooksConfig.hooks["PreToolUse"] ?? [];

  it("matcher covers every tool in pre-tool-use.ts MODIFYING_TOOLS", () => {
    // Extract the source-of-truth tool list from the hook source so the two
    // files cannot drift apart silently again (the original bug: matcher
    // "Bash" left the entire MODIFYING_TOOLS preflight branch unreachable).
    const src = readFileSync(
      join(ROOT, "src", "hooks", "pre-tool-use.ts"),
      "utf-8",
    );
    const setMatch = src.match(/MODIFYING_TOOLS = new Set\(\[([\s\S]*?)\]\)/);
    expect(setMatch).not.toBeNull();
    if (!setMatch) return;
    const tools = Array.from(setMatch[1].matchAll(/"(\w+)"/g)).map(
      (m) => m[1],
    );
    expect(tools.length).toBeGreaterThan(0);
    // The dangerous-Bash branch in pre-tool-use.ts depends on the matcher too.
    tools.push("Bash");
    const matchers = preToolUse.map((e) => e.matcher ?? "");
    for (const tool of tools) {
      const covered = matchers.some(
        // "*" is Claude Code's documented match-everything matcher.
        (m) => m === "*" || new RegExp(`^(?:${m})$`).test(tool),
      );
      expect(
        covered,
        `tool "${tool}" not covered by any PreToolUse matcher`,
      ).toBe(true);
    }
  });

  it("hook timeout leaves headroom above the preflight fetch default", () => {
    const preflightSrc = readFileSync(
      join(ROOT, "src", "state", "preflight.ts"),
      "utf-8",
    );
    const m = preflightSrc.match(/fetchTimeoutMs \?\? ([\d_]+)/);
    expect(m).not.toBeNull();
    if (!m) return;
    const fetchMs = parseInt(m[1].replace(/_/g, ""), 10);
    // An omitted timeout falls back to Claude Code's 60s default — ample
    // headroom, so only explicit timeouts are checked.
    const timeouts = preToolUse.flatMap((e) =>
      e.hooks
        .map((h) => h.timeout)
        .filter((t): t is number => typeof t === "number"),
    );
    for (const t of timeouts) {
      expect(
        t * 1000,
        "PreToolUse hook timeout (ms) must exceed the preflight fetch default",
      ).toBeGreaterThan(fetchMs);
    }
  });
});
