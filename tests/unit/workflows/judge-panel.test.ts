/**
 * Static structure tests for workflows/judge-panel.js (T-9).
 *
 * Same static-analysis strategy as adversarial-review.test.ts — the workflow
 * script cannot be imported because its body invokes phase()/parallel()/agent()
 * at the top level. We read the raw source and assert structure/content.
 *
 * Assertions:
 *   - export const meta exists as a PURE literal
 *   - meta.name is "judge-panel"
 *   - meta includes the three required phase titles: "drafting", "judging",
 *     "synthesis"
 *   - the script does NOT contain Date.now( / new Date( / Math.random(
 *     (harness resume-safety constraint)
 *   - the script does NOT contain the string "agentType" (agents must be
 *     prompt-only, without an explicit agentType parameter)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(process.cwd(), "workflows", "judge-panel.js");
const source = readFileSync(SCRIPT_PATH, "utf-8");

/**
 * Strip block comments (/* ... *\/) and line comments (// ...) from source so
 * that "forbidden API" assertions are not falsely triggered by documentation
 * that mentions the forbidden names in a "do not use" context.
 */
function stripComments(src: string): string {
  // Remove /* ... */ block comments (including the file-header JSDoc)
  let result = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove // line comments
  result = result.replace(/\/\/[^\n]*/g, "");
  return result;
}

const executableSource = stripComments(source);

// The meta literal block itself — phase assertions must hold INSIDE it, not
// just anywhere in the file (runtime phase("...") calls would also match).
const metaMatch = source.match(/export\s+const\s+meta\s*=\s*\{[\s\S]*?\n\};/);
const metaBlock = metaMatch ? metaMatch[0] : "";

describe("workflows/judge-panel.js — static structure", () => {
  it("contains 'export const meta'", () => {
    expect(source).toMatch(/export\s+const\s+meta\s*=/);
  });

  it("meta is a PURE literal (extractable block, no calls or computed values)", () => {
    expect(metaBlock).not.toBe("");
    expect(metaBlock).not.toContain("(");
    expect(metaBlock).not.toContain("${");
  });

  it("meta.name is \"judge-panel\"", () => {
    expect(metaBlock).toMatch(/name\s*:\s*["']judge-panel["']/);
  });

  it("meta.phases includes the title 'drafting'", () => {
    // The phases array uses { title: "..." } objects (harness contract)
    expect(metaBlock).toMatch(/title\s*:\s*["']drafting["']/);
  });

  it("meta.phases includes the title 'judging'", () => {
    expect(metaBlock).toMatch(/title\s*:\s*["']judging["']/);
  });

  it("meta.phases includes the title 'synthesis'", () => {
    expect(metaBlock).toMatch(/title\s*:\s*["']synthesis["']/);
  });

  it("does NOT contain Date.now( in executable code", () => {
    expect(executableSource).not.toContain("Date.now(");
  });

  it("does NOT contain new Date( in executable code", () => {
    expect(executableSource).not.toContain("new Date(");
  });

  it("does NOT contain Math.random( in executable code", () => {
    expect(executableSource).not.toContain("Math.random(");
  });

  it("does NOT contain 'agentType' in executable code", () => {
    expect(executableSource).not.toContain("agentType");
  });
});
