/**
 * Unit tests for subagent-stop.ts (issue #6 — one-shot reminder dedup).
 *
 * Module-mock pattern (see post-tool-use.test.ts): the hook executes main()
 * at import time, so we mock readStdin/writeOutput/passThrough + logEvent and
 * dynamic-import per case. Reminder markers are written to a real temp dir.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SubagentStopInput } from "../../../src/hooks/types.js";

function makeInput(
  overrides: Partial<SubagentStopInput> = {},
): SubagentStopInput {
  return {
    hook_event_name: "SubagentStop",
    session_id: "sub-session-1",
    cwd: "/tmp/unused",
    transcript_path: "/tmp/t.jsonl",
    permission_mode: "default",
    agent_id: "agent-abc",
    agent_type: "arceus:coder",
    agent_transcript_path: "/tmp/at.jsonl",
    last_assistant_message: "done",
    ...overrides,
  };
}

async function runHook(input: SubagentStopInput, arceusDir: string) {
  const writeOutput = vi.fn();
  const passThrough = vi.fn();
  const logEvent = vi.fn();
  vi.resetModules();
  vi.doMock("../../../src/state/index.js", () => ({ logEvent }));
  vi.doMock("../../../src/hooks/utils.js", () => ({
    readStdin: vi.fn().mockResolvedValue(input),
    writeOutput,
    passThrough,
    getArceusDir: () => arceusDir,
  }));
  await import("../../../src/hooks/subagent-stop.js");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { writeOutput, passThrough, logEvent };
}

describe("subagent-stop — one-shot verification reminder (issue #6)", () => {
  beforeEach(() => vi.resetModules());

  it("first stop of a coder agent injects the reminder and writes a marker", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    const { writeOutput, passThrough } = await runHook(makeInput(), dir);
    expect(writeOutput).toHaveBeenCalled();
    const arg = writeOutput.mock.calls[0]?.[0] as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    expect(arg.hookSpecificOutput?.additionalContext).toContain(
      "arceus-verification-reminder",
    );
    expect(passThrough).not.toHaveBeenCalled();
    expect(
      existsSync(
        join(dir, "sessions", "sub-session-1", "reminders", "agent-abc"),
      ),
    ).toBe(true);
  });

  it("second stop of the SAME agent passes through (no repeat injection)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    await runHook(makeInput(), dir);
    const second = await runHook(makeInput(), dir);
    expect(second.passThrough).toHaveBeenCalled();
    expect(second.writeOutput).not.toHaveBeenCalled();
  });

  it("a DIFFERENT agent in the same session still gets its reminder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    await runHook(makeInput(), dir);
    const other = await runHook(makeInput({ agent_id: "agent-xyz" }), dir);
    expect(other.writeOutput).toHaveBeenCalled();
  });

  it("non-arceus agents pass through without logging", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    const { passThrough, logEvent, writeOutput } = await runHook(
      makeInput({ agent_type: "Explore" }),
      dir,
    );
    expect(passThrough).toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });

  it("missing agent_id still injects the reminder (no dedup, no crash)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    const { writeOutput } = await runHook(
      makeInput({ agent_id: undefined as unknown as string }),
      dir,
    );
    expect(writeOutput).toHaveBeenCalled();
  });

  it("path-traversal-looking agent_id is encoded into a safe marker segment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    const evil = "../../escape";
    const first = await runHook(makeInput({ agent_id: evil }), dir);
    expect(first.writeOutput).toHaveBeenCalled();
    // "/" is encoded to "_" — the marker stays inside reminders/.
    expect(
      existsSync(
        join(dir, "sessions", "sub-session-1", "reminders", ".._.._escape"),
      ),
    ).toBe(true);
    const second = await runHook(makeInput({ agent_id: evil }), dir);
    expect(second.passThrough).toHaveBeenCalled();
    expect(second.writeOutput).not.toHaveBeenCalled();
  });

  it("arceus:planner logs subagent_complete but gets no reminder", async () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-substop-"));
    const { passThrough, logEvent, writeOutput } = await runHook(
      makeInput({ agent_type: "arceus:planner" }),
      dir,
    );
    expect(logEvent).toHaveBeenCalled();
    expect(passThrough).toHaveBeenCalled();
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
