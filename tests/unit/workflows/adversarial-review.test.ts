/**
 * Static structure tests for workflows/adversarial-review.js (T-8).
 *
 * The workflow script cannot be imported (top-level phase()/parallel()/agent()
 * calls execute immediately and those globals only exist inside the Workflow
 * tool runtime). We therefore read the raw source text and apply static
 * assertions against it.
 *
 * Assertions:
 *   - export const meta exists as a PURE literal
 *   - meta.name is "adversarial-review"
 *   - meta includes the three required phase titles: "dimension-review",
 *     "skeptic-verification", "synthesis"
 *   - the script does NOT contain Date.now( / new Date( / Math.random(
 *     (harness resume-safety constraint)
 *   - the script does NOT contain the string "agentType" (agents must be
 *     prompt-only, without an explicit agentType parameter)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCRIPT_PATH = join(process.cwd(), "workflows", "adversarial-review.js");
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

describe("workflows/adversarial-review.js — static structure", () => {
  it("contains 'export const meta'", () => {
    expect(source).toMatch(/export\s+const\s+meta\s*=/);
  });

  it("meta is a PURE literal (extractable block, no calls or computed values)", () => {
    expect(metaBlock).not.toBe("");
    expect(metaBlock).not.toContain("(");
    expect(metaBlock).not.toContain("${");
  });

  it("meta.name is \"adversarial-review\"", () => {
    expect(metaBlock).toMatch(/name\s*:\s*["']adversarial-review["']/);
  });

  it("meta.phases includes the title 'dimension-review'", () => {
    // The phases array uses { title: "..." } objects (harness contract)
    expect(metaBlock).toMatch(/title\s*:\s*["']dimension-review["']/);
  });

  it("meta.phases includes the title 'skeptic-verification'", () => {
    expect(metaBlock).toMatch(/title\s*:\s*["']skeptic-verification["']/);
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
