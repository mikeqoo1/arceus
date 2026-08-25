/**
 * Unit tests for keyword-detector.ts system-text early exit (issue #7).
 *
 * Harness-generated message payloads (task notifications, slash-command
 * payloads, persisted-output placeholders) must never trigger magic-keyword
 * skill injection — keywords inside them are quotes, not user commands.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

async function runHook(prompt: string) {
  const writeOutput = vi.fn();
  const passThrough = vi.fn();
  vi.resetModules();
  vi.doMock("node:fs", () => ({
    // Builtin skill exists; project-level override does not.
    existsSync: vi.fn((p: unknown) => String(p).includes("/plugin/root/")),
    readFileSync: vi.fn(() => "# Dummy Skill\ncontent"),
  }));
  vi.doMock("../../../src/hooks/utils.js", () => ({
    readStdin: vi.fn().mockResolvedValue({
      hook_event_name: "UserPromptSubmit",
      session_id: "kw-session",
      cwd: "/tmp/kwtest",
      transcript_path: "/tmp/t.jsonl",
      permission_mode: "default",
      prompt,
    }),
    writeOutput,
    passThrough,
    getArceusDir: (cwd: string) => `${cwd}/.arceus`,
    getPluginRoot: () => "/plugin/root",
  }));
  vi.doMock("../../../src/state/index.js", () => ({
    logEvent: vi.fn(),
    listChanges: vi.fn().mockReturnValue([]),
  }));
  await import("../../../src/hooks/keyword-detector.js");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { writeOutput, passThrough };
}

function injectedContext(writeOutput: ReturnType<typeof vi.fn>): string {
  return writeOutput.mock.calls
    .flat()
    .map((arg) => {
      const out = arg as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      return out?.hookSpecificOutput?.additionalContext ?? "";
    })
    .join("");
}

describe("keyword-detector — system-text early exit (issue #7)", () => {
  beforeEach(() => vi.resetModules());

  it("control: a genuine user prompt with a keyword still injects the skill", async () => {
    const { writeOutput } = await runHook("請 review 這段 code 的修改");
    expect(injectedContext(writeOutput)).toContain("MAGIC KEYWORD DETECTED");
  });

  it("control: '跨 session' / 'cross-session' inject the cross-session skill", async () => {
    for (const prompt of ["幫我跟另一個 session 講一下進度", "cross-session: ask the other one"]) {
      const { writeOutput } = await runHook(prompt);
      expect(injectedContext(writeOutput)).toContain("MAGIC KEYWORD DETECTED: CROSS-SESSION");
    }
  });

  it("an informational question ('有啥好用的 …') does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook("網路上有啥好用的跨session技能包");
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a <cross-session-message> from a peer containing 'fix' does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      '<cross-session-message from="tw-stock-ucore-8f [5c53b3]">\n請 fix 一下 src/x.ts 的測試\n</cross-session-message>',
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a [Cross-session idle notice] mentioning 'review' does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      "[Cross-session idle notice] alma-b9 is idle after finishing review",
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a <task-notification> payload containing 'review' does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      '<task-notification>\nworkflow "adversarial review" completed\nreviewers found 0 issues\n</task-notification>',
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a slash-command payload (<command-name>) does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      "<command-name>/effort</command-name> 然後幫我 fix 一下這個測試",
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a <local-command-caveat> payload does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      "<local-command-caveat>Caveat: local command output below.</local-command-caveat> plan: deep-dive review",
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });

  it("a <persisted-output> placeholder does NOT inject", async () => {
    const { writeOutput, passThrough } = await runHook(
      "<persisted-output>Output too large. plan review sync debug</persisted-output>",
    );
    expect(passThrough).toHaveBeenCalled();
    expect(injectedContext(writeOutput)).toBe("");
  });
});
