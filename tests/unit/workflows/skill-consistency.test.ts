/**
 * Static consistency tests for skills/apply/SKILL.md and skills/propose/SKILL.md (T-10).
 *
 * Assertions:
 *   - Each SKILL.md: occurrences of "{{ARCEUS_PLUGIN_ROOT}}" equals occurrences
 *     of "scriptPath" (both must be exactly 1 — one workflow reference per file)
 *   - skills/apply/SKILL.md byte size < 10000
 *   - skills/propose/SKILL.md byte size < 8000
 *
 * These tests catch drift between the placeholder token and the scriptPath
 * key used by the Workflow tool, and guard the per-prompt context-injection
 * cost constraint (AC18).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APPLY_PATH = join(process.cwd(), "skills", "apply", "SKILL.md");
const PROPOSE_PATH = join(process.cwd(), "skills", "propose", "SKILL.md");

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(needle, pos)) !== -1) {
    count++;
    pos += needle.length;
  }
  return count;
}

describe("skills/apply/SKILL.md — consistency", () => {
  const content = readFileSync(APPLY_PATH, "utf-8");
  const byteSize = Buffer.byteLength(content, "utf-8");

  it("{{ARCEUS_PLUGIN_ROOT}} occurrence count equals scriptPath occurrence count", () => {
    const placeholderCount = countOccurrences(content, "{{ARCEUS_PLUGIN_ROOT}}");
    const scriptPathCount = countOccurrences(content, "scriptPath");
    expect(placeholderCount).toBe(scriptPathCount);
  });

  it("each appears exactly once (one workflow reference)", () => {
    expect(countOccurrences(content, "{{ARCEUS_PLUGIN_ROOT}}")).toBe(1);
    expect(countOccurrences(content, "scriptPath")).toBe(1);
  });

  it("byte size is less than 10000 bytes", () => {
    expect(byteSize).toBeLessThan(10000);
  });
});

describe("skills/propose/SKILL.md — consistency", () => {
  const content = readFileSync(PROPOSE_PATH, "utf-8");
  const byteSize = Buffer.byteLength(content, "utf-8");

  it("{{ARCEUS_PLUGIN_ROOT}} occurrence count equals scriptPath occurrence count", () => {
    const placeholderCount = countOccurrences(content, "{{ARCEUS_PLUGIN_ROOT}}");
    const scriptPathCount = countOccurrences(content, "scriptPath");
    expect(placeholderCount).toBe(scriptPathCount);
  });

  it("each appears exactly once (one workflow reference)", () => {
    expect(countOccurrences(content, "{{ARCEUS_PLUGIN_ROOT}}")).toBe(1);
    expect(countOccurrences(content, "scriptPath")).toBe(1);
  });

  it("byte size is less than 8000 bytes", () => {
    expect(byteSize).toBeLessThan(8000);
  });
});
