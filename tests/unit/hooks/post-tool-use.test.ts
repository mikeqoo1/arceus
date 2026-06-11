/**
 * Unit tests for post-tool-use.ts hook (T-11).
 *
 * Strategy: the hook module calls main() at import time, which reads stdin and
 * writes to stdout.  To keep tests deterministic we mock both the state module
 * (logEvent) and the utils module (readStdin, passThrough) BEFORE doing a
 * dynamic import so each test gets a fresh module execution.
 *
 * Cases (a)-(k) from tasks.md T-11.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostToolUseInput } from "../../../src/hooks/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal PostToolUseInput for the hook. */
function makeInput(overrides: Partial<PostToolUseInput> = {}): PostToolUseInput {
  return {
    hook_event_name: "PostToolUse",
    session_id: "test-session-1",
    cwd: "/tmp/test-project",
    transcript_path: "/tmp/test.jsonl",
    permission_mode: "default",
    tool_name: "Bash",
    tool_input: {},
    tool_response: "",
    tool_use_id: "tu-1",
    ...overrides,
  };
}

/**
 * Run a single execution of the post-tool-use module with the given input.
 * Returns all calls to the mocked logEvent.
 */
async function runHook(
  input: PostToolUseInput,
): Promise<{ logEventCalls: unknown[][] }> {
  const logEvent = vi.fn();
  const passThrough = vi.fn();
  const readStdin = vi.fn().mockResolvedValue(input);

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
  // Allow the microtask queue (main() is async) to drain.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));

  return { logEventCalls: logEvent.mock.calls as unknown[][] };
}

// ---------------------------------------------------------------------------
// (k) significantTools list — must include MultiEdit and NotebookEdit
// ---------------------------------------------------------------------------

describe("(k) significantTools includes MultiEdit and NotebookEdit", () => {
  beforeEach(() => vi.resetModules());

  it("logs a tool_use event for MultiEdit", async () => {
    const { logEventCalls } = await runHook(
      makeInput({ tool_name: "MultiEdit", tool_input: { file_path: "/tmp/a.ts" } }),
    );
    const toolUseEvents = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "tool_use";
    });
    expect(toolUseEvents.length).toBeGreaterThan(0);
  });

  it("logs a tool_use event for NotebookEdit", async () => {
    const { logEventCalls } = await runHook(
      makeInput({ tool_name: "NotebookEdit", tool_input: { notebook_path: "/tmp/nb.ipynb" } }),
    );
    const toolUseEvents = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "tool_use";
    });
    expect(toolUseEvents.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (a)-(e) classifyCodeEdit
// ---------------------------------------------------------------------------

describe("classifyCodeEdit", () => {
  beforeEach(() => vi.resetModules());

  it("(a) Edit tool emits code_edit with correct file_path", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Edit",
        tool_input: { file_path: "/projects/arceus/src/foo.ts" },
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { tool: string; file_path: string } };
    expect(ev.data.tool).toBe("Edit");
    expect(ev.data.file_path).toBe("/projects/arceus/src/foo.ts");
  });

  it("(b) Write tool emits code_edit", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Write",
        tool_input: { file_path: "/projects/arceus/src/bar.ts" },
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { tool: string; file_path: string } };
    expect(ev.data.tool).toBe("Write");
    expect(ev.data.file_path).toBe("/projects/arceus/src/bar.ts");
  });

  it("(c) MultiEdit emits code_edit with file_path from top-level", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "MultiEdit",
        tool_input: { file_path: "/projects/arceus/src/multi.ts" },
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { tool: string; file_path: string } };
    expect(ev.data.tool).toBe("MultiEdit");
    expect(ev.data.file_path).toBe("/projects/arceus/src/multi.ts");
  });

  it("(c) MultiEdit falls back to edits[0].file_path when no top-level file_path", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "MultiEdit",
        tool_input: {
          edits: [{ file_path: "/projects/arceus/src/from-edits.ts" }],
        },
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { file_path: string } };
    expect(ev.data.file_path).toBe("/projects/arceus/src/from-edits.ts");
  });

  it("(d) NotebookEdit emits code_edit using notebook_path", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "NotebookEdit",
        tool_input: { notebook_path: "/projects/arceus/notebooks/analysis.ipynb" },
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { tool: string; file_path: string } };
    expect(ev.data.tool).toBe("NotebookEdit");
    expect(ev.data.file_path).toBe("/projects/arceus/notebooks/analysis.ipynb");
  });

  it("(e) missing file_path falls back to 'unknown'", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Edit",
        tool_input: {}, // no file_path key
      }),
    );
    const codeEditCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "code_edit";
    });
    expect(codeEditCalls).toHaveLength(1);
    const ev = codeEditCalls[0]?.[2] as { data: { file_path: string } };
    expect(ev.data.file_path).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// (f)-(i) classifyVerificationRun
// ---------------------------------------------------------------------------

describe("classifyVerificationRun", () => {
  beforeEach(() => vi.resetModules());

  it("(f) Bash + npm run test with no failure marker → verification_run ok=true, kind='test'", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: "All tests passed\n✓ 42 tests completed",
      }),
    );
    const verCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { kind: string; ok: boolean; command: string } };
    expect(ev.data.kind).toBe("test");
    expect(ev.data.ok).toBe(true);
    expect(ev.data.command).toBe("npm run test");
  });

  it("(g) Bash + npm run test with FAIL in response → ok=false", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: "FAIL src/hooks/stop.test.ts\n✗ 1 test failed",
      }),
    );
    const verCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { ok: boolean } };
    expect(ev.data.ok).toBe(false);
  });

  it("(h) Bash + npm run verify → kind='verify'", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run verify" },
        tool_response: "All checks passed",
      }),
    );
    const verCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { kind: string } };
    expect(ev.data.kind).toBe("verify");
  });

  it("(i) non-verification Bash (ls) → no verification_run event", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "ls -la /tmp" },
        tool_response: "total 0",
      }),
    );
    const verCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });
    expect(verCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (j) tool_response as object — typeof guard (F1c)
// ---------------------------------------------------------------------------

describe("adversarial-review fixes — install guard and failure markers", () => {
  beforeEach(() => vi.resetModules());

  function verificationCalls(logEventCalls: unknown[][]): unknown[][] {
    return logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "verification_run";
    });
  }

  it("npm install jest does NOT emit a verification_run (ghost-pass guard)", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm install jest" },
        tool_response: "added 277 packages in 12s",
      }),
    );
    expect(verificationCalls(logEventCalls)).toHaveLength(0);
  });

  it("npm install jest && npm test still counts via the non-install segment", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm install jest && npm test" },
        tool_response: "added 277 packages\nAll tests passed",
      }),
    );
    const verCalls = verificationCalls(logEventCalls);
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { kind: string; ok: boolean } };
    expect(ev.data.kind).toBe("test");
    expect(ev.data.ok).toBe(true);
  });

  it("real npm ERR! output marks ok=false (marker has no trailing word boundary)", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: "npm ERR! missing script: test\nnpm ERR! \nnpm ERR! To see a list of scripts, run:",
      }),
    );
    const verCalls = verificationCalls(logEventCalls);
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { ok: boolean } };
    expect(ev.data.ok).toBe(false);
  });

  it("object tool_response with non-zero exitCode marks ok=false", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: { exitCode: 1, stderr: "tests crashed" } as unknown as string,
      }),
    );
    const verCalls = verificationCalls(logEventCalls);
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { ok: boolean } };
    expect(ev.data.ok).toBe(false);
  });

  it("object tool_response with exitCode 0 stays ok=true", async () => {
    const { logEventCalls } = await runHook(
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "npm run test" },
        tool_response: { exitCode: 0, stdout: "All tests passed" } as unknown as string,
      }),
    );
    const verCalls = verificationCalls(logEventCalls);
    expect(verCalls).toHaveLength(1);
    const ev = verCalls[0]?.[2] as { data: { ok: boolean } };
    expect(ev.data.ok).toBe(true);
  });
});

describe("(j) tool_response as object does not produce corrupt data", () => {
  beforeEach(() => vi.resetModules());

  it("stores a STRING in event data.response when tool_response is an object", async () => {
    const objectResponse = { stdout: "some output", stderr: "", exitCode: 0 };
    const { logEventCalls } = await runHook(
      // Cast to allow the object to bypass the declared string type — this
      // mirrors the CONFIRMED runtime behaviour documented in tasks.md T-11(j).
      makeInput({
        tool_name: "Bash",
        tool_input: { command: "ls" },
        tool_response: objectResponse as unknown as string,
      }),
    );
    const toolUseCalls = logEventCalls.filter((args) => {
      const event = args[2] as { event?: string };
      return event?.event === "tool_use";
    });
    expect(toolUseCalls.length).toBeGreaterThan(0);
    const ev = toolUseCalls[0]?.[2] as { data: { response: unknown } };
    // The typeof guard must convert the object to a JSON string — not leave it
    // as a raw object — so event data.response is always a string.
    expect(typeof ev.data.response).toBe("string");
  });
});
