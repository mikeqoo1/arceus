/**
 * Unit tests for stop-gate.ts pure functions + stop.ts integration (T-12).
 *
 * Pure-function tests (a)-(m): construct SessionEvent arrays directly —
 * no mocking required.
 *
 * stop.ts integration tests (n)-(o): mock readStdin / writeOutput / passThrough
 * from utils.js and logEvent / readConfig / readSessionLog from state/index.js
 * before dynamic-importing stop.js so main() re-runs for each case.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluateStopGate,
  isExcludedPath,
  type StopGateConfig,
  type StopGateInput,
} from "../../../src/hooks/stop-gate.js";
import type { SessionEvent } from "../../../src/state/index.js";
import type { StopInput } from "../../../src/hooks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: StopGateConfig = {
  enabled: true,
  requireVerify: false,
  excludedPaths: [".arceus/", "*.md"],
};

function makeCodeEdit(filePath: string, index = 0): SessionEvent {
  return {
    timestamp: new Date(Date.now() + index).toISOString(),
    event: "code_edit",
    data: { tool: "Edit", file_path: filePath },
  };
}

function makeVerificationRun(ok: boolean): SessionEvent {
  return {
    timestamp: new Date().toISOString(),
    event: "verification_run",
    data: { kind: "test", command: "npm run test", ok },
  };
}

function makeInput(overrides: Partial<StopGateInput> = {}): StopGateInput {
  return {
    events: [],
    config: { ...DEFAULT_CONFIG },
    stopHookActive: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluateStopGate — pure predicate
// ---------------------------------------------------------------------------

describe("evaluateStopGate — (a) no code_edit events", () => {
  it("returns action=pass when session has no code_edit events", () => {
    const result = evaluateStopGate(makeInput({ events: [makeVerificationRun(true)] }));
    expect(result.action).toBe("pass");
    expect(result.editedFiles).toEqual([]);
  });
});

describe("evaluateStopGate — (b) code_edit without verification, advisory mode", () => {
  it("returns action=warn with reason and editedFiles list", () => {
    const events: SessionEvent[] = [makeCodeEdit("/src/foo.ts")];
    const result = evaluateStopGate(
      makeInput({ events, config: { ...DEFAULT_CONFIG, requireVerify: false } }),
    );
    expect(result.action).toBe("warn");
    expect(result.reason).toBeDefined();
    expect(result.editedFiles).toContain("/src/foo.ts");
  });
});

describe("evaluateStopGate — (c) code_edit without verification, strict mode", () => {
  it("returns action=block with reason when requireVerify=true", () => {
    const events: SessionEvent[] = [makeCodeEdit("/src/foo.ts")];
    const result = evaluateStopGate(
      makeInput({ events, config: { ...DEFAULT_CONFIG, requireVerify: true } }),
    );
    expect(result.action).toBe("block");
    expect(result.reason).toMatch(/Run verification/);
    expect(result.editedFiles).toContain("/src/foo.ts");
  });
});

describe("evaluateStopGate — (d) code_edit followed by ok verification_run", () => {
  it("returns action=pass", () => {
    const events: SessionEvent[] = [
      makeCodeEdit("/src/foo.ts"),
      makeVerificationRun(true),
    ];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("pass");
  });
});

describe("evaluateStopGate — (e) code_edit followed by failed verification_run", () => {
  it("treats ok=false as unverified → warn in advisory mode", () => {
    const events: SessionEvent[] = [
      makeCodeEdit("/src/foo.ts"),
      makeVerificationRun(false),
    ];
    const result = evaluateStopGate(makeInput({ events }));
    // ok=false verification is NOT sufficient — should trigger gate
    expect(result.action).toBe("warn");
  });
});

describe("evaluateStopGate — (f) stopHookActive=true (loop protection)", () => {
  it("returns action=pass regardless of session log", () => {
    const events: SessionEvent[] = [makeCodeEdit("/src/foo.ts")];
    const result = evaluateStopGate(makeInput({ events, stopHookActive: true }));
    expect(result.action).toBe("pass");
  });
});

describe("evaluateStopGate — (g) enabled=false (master switch)", () => {
  it("returns action=pass immediately", () => {
    const events: SessionEvent[] = [makeCodeEdit("/src/foo.ts")];
    const result = evaluateStopGate(
      makeInput({ events, config: { ...DEFAULT_CONFIG, enabled: false } }),
    );
    expect(result.action).toBe("pass");
  });
});

describe("evaluateStopGate — (h) excludedPaths prefix match (.arceus/)", () => {
  it("passes when all code_edit files are under .arceus/", () => {
    const events: SessionEvent[] = [makeCodeEdit(".arceus/config.json")];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("pass");
  });
});

describe("evaluateStopGate — (i) excludedPaths suffix match (*.md)", () => {
  it("passes when all code_edit files are markdown", () => {
    const events: SessionEvent[] = [makeCodeEdit("docs/README.md")];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("pass");
  });
});

describe("evaluateStopGate — (j) file_path='unknown' is NOT excluded", () => {
  it("triggers gate for file_path='unknown'", () => {
    const events: SessionEvent[] = [makeCodeEdit("unknown")];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("warn");
  });
});

describe("evaluateStopGate — (k) editedFiles list is correct", () => {
  it("contains deduplicated non-excluded file paths", () => {
    const events: SessionEvent[] = [
      makeCodeEdit("/src/a.ts", 0),
      makeCodeEdit("/src/b.ts", 1),
      makeCodeEdit("/src/a.ts", 2), // duplicate
      makeCodeEdit("docs/CHANGELOG.md", 3), // excluded (*.md)
    ];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("warn");
    // editedFiles should contain /src/a.ts and /src/b.ts (deduped), not .md
    expect(result.editedFiles).toEqual(
      expect.arrayContaining(["/src/a.ts", "/src/b.ts"]),
    );
    expect(result.editedFiles).not.toContain("docs/CHANGELOG.md");
    // no duplicates
    expect(result.editedFiles.filter((f) => f === "/src/a.ts")).toHaveLength(1);
  });
});

describe("evaluateStopGate — (l) last code_edit index determines gate", () => {
  it("passes when verification_run follows the LAST edit even if earlier edits lack verification", () => {
    const events: SessionEvent[] = [
      makeCodeEdit("/src/a.ts"),       // edit 1 — no verification after this yet
      makeVerificationRun(false),       // failed check (does not satisfy gate)
      makeCodeEdit("/src/b.ts"),        // edit 2 — last edit index
      makeVerificationRun(true),        // ok=true after last edit → should pass
    ];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("pass");
  });

  it("warns when verification_run is BEFORE the last code_edit", () => {
    const events: SessionEvent[] = [
      makeCodeEdit("/src/a.ts"),
      makeVerificationRun(true), // ok — but happens before last edit
      makeCodeEdit("/src/b.ts"), // this edit is AFTER the verification
    ];
    const result = evaluateStopGate(makeInput({ events }));
    expect(result.action).toBe("warn");
  });
});

// ---------------------------------------------------------------------------
// isExcludedPath — (m) edge cases
// ---------------------------------------------------------------------------

describe("isExcludedPath — (m) edge cases", () => {
  it("returns false for empty patterns array", () => {
    expect(isExcludedPath("/src/foo.ts", [])).toBe(false);
  });

  it("exact match (no trailing / or leading *)", () => {
    expect(isExcludedPath("src/foo.ts", ["src/foo.ts"])).toBe(true);
    expect(isExcludedPath("src/bar.ts", ["src/foo.ts"])).toBe(false);
  });

  it("prefix match via trailing /", () => {
    expect(isExcludedPath(".arceus/config.json", [".arceus/"])).toBe(true);
    expect(isExcludedPath("src/.arceus/note.md", [".arceus/"])).toBe(true);
    expect(isExcludedPath("src/arceus.ts", [".arceus/"])).toBe(false);
  });

  it("suffix match via leading *", () => {
    expect(isExcludedPath("docs/README.md", ["*.md"])).toBe(true);
    expect(isExcludedPath("src/foo.ts", ["*.md"])).toBe(false);
  });

  it("'unknown' is never excluded (conservative strategy)", () => {
    expect(isExcludedPath("unknown", [".arceus/", "*.md", "unknown"])).toBe(false);
  });

  it("exact match when pattern has no special characters", () => {
    expect(isExcludedPath("Makefile", ["Makefile"])).toBe(true);
    expect(isExcludedPath("makefile", ["Makefile"])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// stop.ts integration tests
// ---------------------------------------------------------------------------

/** Build a minimal StopInput for the stop hook. */
function makeStopInput(overrides: Partial<StopInput> = {}): StopInput {
  return {
    hook_event_name: "Stop",
    session_id: "stop-session-1",
    cwd: "/tmp/stop-test-project",
    transcript_path: "/tmp/stop.jsonl",
    permission_mode: "default",
    ...overrides,
  };
}

/**
 * Run the stop hook module once with the given configuration.
 * Returns what was written to stdout via writeOutput and passThrough mocks.
 */
async function runStopHook(opts: {
  input: StopInput;
  sessionLog?: SessionEvent[];
  configOverride?: Record<string, unknown>;
  readSessionLogFn?: () => SessionEvent[];
}): Promise<{
  writeOutputCalls: unknown[][];
  passThroughCalls: unknown[][];
  stderrOutput: string;
}> {
  const {
    input,
    sessionLog = [],
    configOverride = {},
    readSessionLogFn,
  } = opts;

  const writeOutput = vi.fn();
  const passThrough = vi.fn();
  const readStdin = vi.fn().mockResolvedValue(input);
  const logEvent = vi.fn();
  const readConfig = vi.fn().mockReturnValue(configOverride);
  const readSessionLog = readSessionLogFn
    ? vi.fn().mockImplementation(readSessionLogFn)
    : vi.fn().mockReturnValue(sessionLog);

  // Capture stderr writes
  let stderrOutput = "";
  const origStderr = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrOutput += String(chunk);
    return true;
  });

  vi.resetModules();
  vi.doMock("../../../src/state/index.js", () => ({
    logEvent,
    readConfig,
    readSessionLog,
    readNotepad: vi.fn(),
    writeNotepad: vi.fn(),
  }));
  vi.doMock("../../../src/hooks/utils.js", () => ({
    readStdin,
    passThrough,
    writeOutput,
    getArceusDir: (cwd: string) => `${cwd}/.arceus`,
  }));

  await import("../../../src/hooks/stop.js");
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  // Restore stderr
  vi.mocked(process.stderr.write).mockRestore();
  void origStderr; // suppress unused warning

  return {
    writeOutputCalls: writeOutput.mock.calls as unknown[][],
    passThroughCalls: passThrough.mock.calls as unknown[][],
    stderrOutput,
  };
}

describe("stop.ts — (n) fail-open: corrupt session log → passThrough + stderr warning", () => {
  beforeEach(() => vi.resetModules());

  it("calls passThrough and writes to stderr when readSessionLog throws", async () => {
    const { passThroughCalls, stderrOutput } = await runStopHook({
      input: makeStopInput(),
      configOverride: { stopGate: { enabled: true } },
      readSessionLogFn: () => {
        throw new Error("corrupt JSONL");
      },
    });

    // Must call passThrough (fail-open)
    expect(passThroughCalls.length).toBeGreaterThan(0);
    // Must emit a warning to stderr
    expect(stderrOutput).toMatch(/stop-gate internal error/);
  });
});

describe("stop.ts — (o) loop protection passThrough with systemMessage", () => {
  beforeEach(() => vi.resetModules());

  it("writes systemMessage (not block) when stop_hook_active=true", async () => {
    const { writeOutputCalls, passThroughCalls } = await runStopHook({
      input: makeStopInput({ stop_hook_active: true }),
      // Even with edits and no verification in the log — loop protection wins
      sessionLog: [makeCodeEdit("/src/important.ts")],
      configOverride: { stopGate: { enabled: true, requireVerify: true } },
    });

    // Should use writeOutput with continue:true and a systemMessage, not block
    const writeCallArgs = writeOutputCalls.flat();
    const hasSystemMessage = writeCallArgs.some((arg) => {
      if (typeof arg === "object" && arg !== null) {
        const output = arg as Record<string, unknown>;
        return (
          output["continue"] === true &&
          typeof output["systemMessage"] === "string" &&
          String(output["systemMessage"]).includes("[Arceus Stop Gate]")
        );
      }
      return false;
    });

    // The implementation MUST surface the bypass via writeOutput({continue:true,
    // systemMessage}) — a silent passThrough() would hide the bypass from the
    // user, so the permissive "either/or" assertion is intentionally avoided.
    void passThroughCalls;
    expect(hasSystemMessage).toBe(true);

    // Must NOT have issued a block decision
    const hasBlock = writeCallArgs.some((arg) => {
      if (typeof arg === "object" && arg !== null) {
        const output = arg as Record<string, unknown>;
        return output["decision"] === "block";
      }
      return false;
    });
    expect(hasBlock).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional coverage — failure marker "0 errors" edge case
// ---------------------------------------------------------------------------

describe("failure-marker heuristic — '0 errors' is success (adversarial-review fix)", () => {
  /**
   * The marker was tightened from /\d+\s+errors?\b/i to /[1-9]\d*\s+errors?\b/i
   * after adversarial review: successful `tsc --pretty` / lint summaries print
   * "0 errors", which the old pattern misclassified as failure (false advisory
   * warning, or unnecessary strict-mode block). Spec F1b was updated to match.
   */
  it("classifyVerificationRun emits ok=true when response contains '0 errors'", async () => {
    const logEvent = vi.fn();
    const passThrough = vi.fn();
    const readStdin = vi.fn().mockResolvedValue(
      // makeInput is not in scope here — inline a minimal PostToolUseInput
      {
        hook_event_name: "PostToolUse" as const,
        session_id: "test-session-0err",
        cwd: "/tmp/test-project",
        transcript_path: "/tmp/test.jsonl",
        permission_mode: "default",
        tool_name: "Bash",
        tool_input: { command: "npm run typecheck" },
        // "0 errors" triggers /\d+\s+errors?\b/i → ok=false (current spec)
        tool_response: "src/index.ts - 0 errors",
        tool_use_id: "tu-0err",
      },
    );

    vi.resetModules();
    vi.doMock("../../../src/state/index.js", () => ({
      logEvent,
      readConfig: vi.fn().mockReturnValue({}),
      readSessionLog: vi.fn().mockReturnValue([]),
    }));
    vi.doMock("../../../src/hooks/utils.js", () => ({
      readStdin,
      passThrough,
      writeOutput: vi.fn(),
      getArceusDir: (cwd: string) => `${cwd}/.arceus`,
    }));

    await import("../../../src/hooks/post-tool-use.js");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const verCalls = logEvent.mock.calls.filter((args: unknown[]) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });

    expect(verCalls).toHaveLength(1);
    // "0 errors" no longer matches the tightened /[1-9]\d*\s+errors?\b/i marker.
    const ev = verCalls[0]?.[2] as { data: { ok: boolean } };
    expect(ev.data.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stop.ts integration — AC7/AC8 dispatch branches (adversarial-review fix)
// ---------------------------------------------------------------------------

describe("stop.ts — AC7/AC8 output dispatch", () => {
  beforeEach(() => vi.resetModules());

  function flatOutputs(writeOutputCalls: unknown[][]): Record<string, unknown>[] {
    return writeOutputCalls
      .flat()
      .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null);
  }

  it("AC7: advisory default emits systemMessage warning, no decision:block, no passThrough", async () => {
    const { writeOutputCalls, passThroughCalls } = await runStopHook({
      input: makeStopInput(),
      sessionLog: [makeCodeEdit("/src/unverified.ts")],
      configOverride: {},
    });
    const outputs = flatOutputs(writeOutputCalls);
    const warn = outputs.find((o) => typeof o["systemMessage"] === "string");
    expect(warn).toBeDefined();
    expect(String(warn?.["systemMessage"])).toContain("[Arceus Stop Gate]");
    expect(warn?.["continue"]).toBe(true);
    expect(warn?.["decision"]).toBeUndefined();
    expect(outputs.some((o) => o["decision"] === "block")).toBe(false);
    expect(passThroughCalls).toHaveLength(0);
  });

  it("AC8: strict mode emits decision:block with verification instructions", async () => {
    const { writeOutputCalls } = await runStopHook({
      input: makeStopInput(),
      sessionLog: [makeCodeEdit("/src/unverified.ts")],
      configOverride: { stopGate: { requireVerify: true } },
    });
    const outputs = flatOutputs(writeOutputCalls);
    const block = outputs.find((o) => o["decision"] === "block");
    expect(block).toBeDefined();
    expect(String(block?.["reason"])).toMatch(/Run verification/);
    expect(String(block?.["reason"])).toContain("/src/unverified.ts");
  });

  it("disabled gate stays silent even when stop_hook_active=true (no Arceus-branded message)", async () => {
    const { writeOutputCalls, passThroughCalls } = await runStopHook({
      input: makeStopInput({ stop_hook_active: true }),
      sessionLog: [makeCodeEdit("/src/unverified.ts")],
      configOverride: { stopGate: { enabled: false } },
    });
    expect(passThroughCalls.length).toBeGreaterThan(0);
    const outputs = flatOutputs(writeOutputCalls);
    expect(outputs.some((o) => typeof o["systemMessage"] === "string")).toBe(false);
  });
});
