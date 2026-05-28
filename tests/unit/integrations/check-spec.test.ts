import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCheckSpec, findBinary, isReportOversize } from "../../../src/integrations/check-spec.js";

/**
 * The integration tests use a fake `check-spec` binary built as a shell
 * script in a temp directory. The script consults env vars set by each
 * test to choose its behavior — that keeps fixtures in this file.
 *
 * Skip on Windows for now (no /bin/sh).
 */

const SKIP_ON_WIN = process.platform === "win32";

interface Sandbox {
  root: string;
  binaryPath: string;
}

const FAKE_BINARY_TEMPLATE = `#!/bin/sh
# Fake check-spec binary for tests.
# Behavior controlled by env vars:
#   FAKE_MODE=approve|reject|needs-discussion|crash|version-fail|missing-key|git-error|oversize
#
case "$1" in
  version)
    if [ "$FAKE_MODE" = "version-fail" ]; then
      exit 1
    fi
    echo "check-spec v0.1.0-test"
    exit 0
    ;;
  verify)
    case "$FAKE_MODE" in
      approve)
        echo "# Audit"
        echo ""
        echo "- **Verdict**: APPROVE"
        echo ""
        echo "Looks good."
        exit 0
        ;;
      reject)
        echo "# Audit"
        echo ""
        echo "- **Verdict**: REQUEST_CHANGES"
        echo ""
        echo "Drift detected."
        exit 1
        ;;
      needs-discussion)
        echo "# Audit"
        echo ""
        echo "- **Verdict**: NEEDS_DISCUSSION"
        exit 1
        ;;
      crash)
        echo "boom" >&2
        exit 99
        ;;
      missing-key)
        echo "ANTHROPIC_API_KEY required" >&2
        exit 2
        ;;
      git-error)
        echo "fatal: ambiguous argument 'origin/main': unknown revision" >&2
        exit 2
        ;;
      oversize)
        echo "# Audit"
        echo ""
        echo "- **Verdict**: REQUEST_CHANGES"
        echo ""
        # Generate ~2500 chars of body.
        i=0
        while [ $i -lt 50 ]; do
          echo "Line $i: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod"
          i=$((i+1))
        done
        exit 1
        ;;
      *)
        echo "FAKE_MODE not set" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "unknown subcommand $1" >&2
    exit 2
    ;;
esac
`;

function setupSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "arceus-checkspec-"));
  const binaryPath = join(root, "fake-check-spec");
  writeFileSync(binaryPath, FAKE_BINARY_TEMPLATE, "utf-8");
  chmodSync(binaryPath, 0o755);
  return { root, binaryPath };
}

function teardown(s: Sandbox): void {
  rmSync(s.root, { recursive: true, force: true });
}

describe.skipIf(SKIP_ON_WIN)("findBinary", () => {
  it("resolves an absolute path that exists", () => {
    const s = setupSandbox();
    try {
      expect(findBinary(s.binaryPath)).toBe(s.binaryPath);
    } finally {
      teardown(s);
    }
  });

  it("returns null for an absolute path that does not exist", () => {
    expect(findBinary("/no/such/binary")).toBe(null);
  });

  it("returns null for a non-existent PATH name", () => {
    expect(findBinary("definitely-not-a-real-binary-xyz-12345")).toBe(null);
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — happy path", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox();
    process.env["FAKE_MODE"] = "approve";
  });
  afterEach(() => {
    delete process.env["FAKE_MODE"];
    teardown(s);
  });

  it("parses APPROVE verdict and returns no error", () => {
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe(null);
    expect(result.verdict).toBe("APPROVE");
    expect(result.binaryVersion).toBe("check-spec v0.1.0-test");
    expect(result.binaryExitCode).toBe(0);
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — REQUEST_CHANGES (exit 1)", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox();
    process.env["FAKE_MODE"] = "reject";
  });
  afterEach(() => {
    delete process.env["FAKE_MODE"];
    teardown(s);
  });

  it("parses verdict and treats exit 1 as a valid completion (not an error)", () => {
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe(null);
    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(result.binaryExitCode).toBe(1);
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — error classification", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox();
  });
  afterEach(() => {
    delete process.env["FAKE_MODE"];
    teardown(s);
  });

  it("classifies missing ANTHROPIC_API_KEY", () => {
    process.env["FAKE_MODE"] = "missing-key";
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe("missing-api-key");
    expect(result.errorMessage).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("classifies git ref errors", () => {
    process.env["FAKE_MODE"] = "git-error";
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe("git-ref-not-found");
  });

  it("classifies unknown crash (exit 99, no parseable verdict)", () => {
    process.env["FAKE_MODE"] = "crash";
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe("binary-crash");
    expect(result.binaryExitCode).toBe(99);
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — binary not found", () => {
  it("returns binary-not-found with actionable install instructions", () => {
    const result = runCheckSpec("/tmp", "test-change", {
      binary: "/no/such/check-spec",
    });
    expect(result.errorKind).toBe("binary-not-found");
    expect(result.errorMessage).toMatch(/Install/);
    expect(result.errorMessage).toMatch(/check-spec/);
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — version subcommand failure", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox();
    process.env["FAKE_MODE"] = "version-fail";
    // version-fail makes `version` exit 1; for `verify` we need a separate
    // mode — set FAKE_MODE=approve only AFTER getBinaryVersion runs. Since
    // both share env, simulate by using a wrapper script. Simpler: assert
    // that getBinaryVersion falls back to "unknown" — but verify will also
    // fail since FAKE_MODE wires its branch. Let's accept that and assert
    // version is "unknown" + errorKind reflects the verify failure.
  });
  afterEach(() => {
    delete process.env["FAKE_MODE"];
    teardown(s);
  });

  it("returns binaryVersion='unknown' when version subcommand fails", () => {
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.binaryVersion).toBe("unknown");
  });
});

describe.skipIf(SKIP_ON_WIN)("runCheckSpec — oversize report", () => {
  let s: Sandbox;
  beforeEach(() => {
    s = setupSandbox();
    process.env["FAKE_MODE"] = "oversize";
  });
  afterEach(() => {
    delete process.env["FAKE_MODE"];
    teardown(s);
  });

  it("returns a parseable verdict and the report is over the threshold", () => {
    const result = runCheckSpec(s.root, "test-change", {
      binary: s.binaryPath,
      cwd: s.root,
    });
    expect(result.errorKind).toBe(null);
    expect(result.verdict).toBe("REQUEST_CHANGES");
    expect(isReportOversize(result.report)).toBe(true);
  });
});

describe("isReportOversize", () => {
  it("returns true above the threshold", () => {
    const long = "a".repeat(2001);
    expect(isReportOversize(long)).toBe(true);
  });

  it("returns false at or below the threshold", () => {
    const exact = "a".repeat(2000);
    expect(isReportOversize(exact)).toBe(false);
    expect(isReportOversize("short")).toBe(false);
  });
});

// Silence unused warning from import-only path.
void existsSync;
