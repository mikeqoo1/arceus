/**
 * Unit tests for keyword-detector.ts loadSkillContent() placeholder substitution (T-7).
 *
 * Strategy: the hook module calls main() at import time (reads stdin, writes stdout).
 * loadSkillContent() is NOT exported, so we exercise it indirectly via the module-mock
 * + dynamic-import pattern:
 *   1. Mock node:fs (existsSync / readFileSync)
 *   2. Mock ./utils.js (readStdin, writeOutput, passThrough, getArceusDir, getPluginRoot)
 *   3. Mock ../state/index.js (logEvent, listChanges)
 *   4. vi.resetModules() + dynamic import to re-run main() for each test case
 *
 * Two cases:
 *   (a) builtin path — existsSync returns false for project path, true for builtin;
 *       readFileSync returns SKILL.md text containing {{ARCEUS_PLUGIN_ROOT}};
 *       assert the placeholder is replaced with /mock/plugin/root
 *   (b) project-override path — existsSync returns true for project path;
 *       assert the placeholder is NOT replaced (project owner controls paths)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { UserPromptSubmitInput } from "../../../src/hooks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_PLUGIN_ROOT = "/mock/plugin/root";
const PLACEHOLDER = "{{ARCEUS_PLUGIN_ROOT}}";
const SKILL_MD_WITH_PLACEHOLDER = `# Fake Skill\n\nscriptPath: "${PLACEHOLDER}/workflows/x.js"\n`;

function makeInput(overrides: Partial<UserPromptSubmitInput> = {}): UserPromptSubmitInput {
  return {
    hook_event_name: "UserPromptSubmit",
    session_id: "test-kd-1",
    cwd: "/tmp/test-project",
    transcript_path: "/tmp/test.jsonl",
    permission_mode: "default",
    prompt: "autopilot",
    ...overrides,
  };
}

/**
 * Run the keyword-detector module once with the specified fs mock behaviour.
 * Returns the additionalContext string that was written via writeOutput, or null
 * if writeOutput was not called (e.g. passThrough fired instead).
 */
async function runDetector(opts: {
  projectSkillExists: boolean;
  builtinSkillExists: boolean;
  skillContent?: string;
  input?: UserPromptSubmitInput;
}): Promise<{ additionalContext: string | null; writeOutputCalls: unknown[][] }> {
  const {
    projectSkillExists,
    builtinSkillExists,
    skillContent = SKILL_MD_WITH_PLACEHOLDER,
    input = makeInput(),
  } = opts;

  const writeOutput = vi.fn();
  const passThrough = vi.fn();
  const readStdin = vi.fn().mockResolvedValue(input);
  const logEvent = vi.fn();
  const listChanges = vi.fn().mockReturnValue([]);

  // existsSync: first call is for the project path, second for the builtin path.
  // The module joins cwd + ".arceus/skills/<skill>/SKILL.md" for project,
  // and pluginRoot + "skills/<skill>/SKILL.md" for builtin.
  const existsSync = vi
    .fn()
    .mockImplementationOnce(() => projectSkillExists) // project path
    .mockImplementationOnce(() => builtinSkillExists); // builtin path

  const readFileSync = vi.fn().mockReturnValue(skillContent);

  vi.resetModules();

  vi.doMock("node:fs", () => ({
    existsSync,
    readFileSync,
  }));

  vi.doMock("../../../src/hooks/utils.js", () => ({
    readStdin,
    writeOutput,
    passThrough,
    getArceusDir: (cwd: string) => `${cwd}/.arceus`,
    getPluginRoot: () => MOCK_PLUGIN_ROOT,
  }));

  vi.doMock("../../../src/state/index.js", () => ({
    logEvent,
    listChanges,
  }));

  await import("../../../src/hooks/keyword-detector.js");
  // Allow the microtask queue (main() is async) to drain.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  const calls = writeOutput.mock.calls as unknown[][];
  let additionalContext: string | null = null;

  for (const args of calls) {
    const output = args[0] as Record<string, unknown>;
    const hookSpecificOutput = output?.["hookSpecificOutput"] as
      | Record<string, unknown>
      | undefined;
    if (typeof hookSpecificOutput?.["additionalContext"] === "string") {
      additionalContext = hookSpecificOutput["additionalContext"] as string;
      break;
    }
  }

  return { additionalContext, writeOutputCalls: calls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadSkillContent — (a) builtin path: {{ARCEUS_PLUGIN_ROOT}} is substituted", () => {
  beforeEach(() => vi.resetModules());

  it("replaces {{ARCEUS_PLUGIN_ROOT}} with the plugin root in the injected context", async () => {
    const { additionalContext } = await runDetector({
      projectSkillExists: false,
      builtinSkillExists: true,
      skillContent: SKILL_MD_WITH_PLACEHOLDER,
    });

    expect(additionalContext).not.toBeNull();
    // Placeholder must be gone
    expect(additionalContext).not.toContain(PLACEHOLDER);
    // The real plugin root must appear in its place
    expect(additionalContext).toContain(`${MOCK_PLUGIN_ROOT}/workflows/x.js`);
  });

  it("does not leave any {{ARCEUS_PLUGIN_ROOT}} tokens in additionalContext", async () => {
    const content =
      `# Multi\nscriptPath: "${PLACEHOLDER}/a.js"\nother: "${PLACEHOLDER}/b.js"\n`;

    const { additionalContext } = await runDetector({
      projectSkillExists: false,
      builtinSkillExists: true,
      skillContent: content,
    });

    expect(additionalContext).not.toContain(PLACEHOLDER);
  });
});

describe("loadSkillContent — (b) project-override path: {{ARCEUS_PLUGIN_ROOT}} is NOT substituted", () => {
  beforeEach(() => vi.resetModules());

  it("leaves {{ARCEUS_PLUGIN_ROOT}} literal when the project override file exists", async () => {
    const { additionalContext } = await runDetector({
      projectSkillExists: true,
      builtinSkillExists: false, // irrelevant — project path short-circuits
      skillContent: SKILL_MD_WITH_PLACEHOLDER,
    });

    // Project override branch does NOT call replaceAll — placeholder must remain
    expect(additionalContext).not.toBeNull();
    expect(additionalContext).toContain(PLACEHOLDER);
  });
});
