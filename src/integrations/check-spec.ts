/**
 * check-spec integration — wrap the external Go binary as a third-party judge.
 *
 * Spawns the binary, parses its output, and returns a structured result that
 * the rest of Arceus can act on. Never modifies meta.json directly — callers
 * (cli.ts) are responsible for persistence.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

export type Verdict = "APPROVE" | "REQUEST_CHANGES" | "NEEDS_DISCUSSION";

export interface RunCheckSpecOptions {
  /** Base git ref. Defaults to "origin/main". */
  base?: string;
  /** Head git ref. Defaults to "HEAD". */
  head?: string;
  /** Model id to forward to check-spec. */
  model?: string;
  /** Override the binary path/name from config. */
  binary?: string;
  /** Working directory for the spawn (repo root). Defaults to process.cwd(). */
  cwd?: string;
  /**
   * Output format requested from check-spec. Internally we always parse the
   * verdict from whatever format we get back. Defaults to "markdown".
   */
  format?: "markdown" | "json";
}

export interface CheckSpecResult {
  /** Parsed verdict, or null if unparseable (caller treats as NEEDS_DISCUSSION fallback). */
  verdict: Verdict | null;
  /** Raw stdout from check-spec — the report content in requested format. */
  report: string;
  /** Format of the report (matches options.format). */
  format: "markdown" | "json";
  /** Raw stderr from check-spec, captured for diagnostics. */
  stderr: string;
  /** check-spec binary's own exit code (0 = APPROVE, 1 = non-APPROVE, 2 = error). */
  binaryExitCode: number | null;
  /** check-spec --version output, or "unknown" if the version subcommand failed. */
  binaryVersion: string;
  /**
   * High-level error category for Arceus CLI to translate into actionable
   * messages. null when verify ran end-to-end (regardless of verdict).
   */
  errorKind: null | "binary-not-found" | "missing-api-key" | "git-ref-not-found" | "parse-failed" | "binary-crash";
  /** Human-readable error message when errorKind is set. */
  errorMessage?: string;
}

/**
 * Locate the check-spec binary on PATH. Returns null if not found.
 *
 * Uses `where` on Windows and `which` elsewhere (the platform-correct
 * builtin). Safer than naively spawning the binary itself, since spawnSync's
 * ENOENT vs. failure-after-exec is harder to distinguish reliably.
 */
export function findBinary(binary: string): string | null {
  // Absolute or relative path that exists — use as-is.
  if (binary.includes("/") || binary.includes("\\")) {
    return existsSync(binary) ? binary : null;
  }
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(lookup, [binary], { encoding: "utf-8" });
  if (result.status !== 0 || !result.stdout) return null;
  return result.stdout.trim().split(/\r?\n/)[0] ?? null;
}

function getBinaryVersion(binary: string): string {
  const result = spawnSync(binary, ["version"], { encoding: "utf-8" });
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }
  return "unknown";
}

function parseVerdictFromMarkdown(stdout: string): Verdict | null {
  const match = stdout.match(/\*\*Verdict\*\*:\s*(APPROVE|REQUEST_CHANGES|NEEDS_DISCUSSION)/);
  return (match?.[1] as Verdict) ?? null;
}

function parseVerdictFromJson(stdout: string): Verdict | null {
  try {
    const obj = JSON.parse(stdout) as { verdict?: string };
    if (obj.verdict === "APPROVE" || obj.verdict === "REQUEST_CHANGES" || obj.verdict === "NEEDS_DISCUSSION") {
      return obj.verdict;
    }
    return null;
  } catch {
    return null;
  }
}

function classifyError(stderr: string): CheckSpecResult["errorKind"] {
  if (/ANTHROPIC_API_KEY/i.test(stderr)) return "missing-api-key";
  if (/unknown revision|bad revision|ambiguous argument/i.test(stderr)) return "git-ref-not-found";
  return null;
}

/**
 * Run check-spec verify against a change and return a structured result.
 *
 * Never throws for "expected" failures (missing binary, non-zero exit, parse
 * errors) — those are reported via errorKind / errorMessage. Throws only on
 * truly unexpected runtime errors.
 */
export function runCheckSpec(
  _arceusDir: string,
  changeId: string,
  options: RunCheckSpecOptions = {},
): CheckSpecResult {
  const binary = options.binary ?? "check-spec";
  const cwd = options.cwd ?? process.cwd();
  const format = options.format ?? "markdown";

  // 1. Locate the binary up front so ENOENT becomes an actionable error
  //    instead of a child_process exception.
  const resolved = findBinary(binary);
  if (!resolved) {
    return {
      verdict: null,
      report: "",
      format,
      stderr: "",
      binaryExitCode: null,
      binaryVersion: "unknown",
      errorKind: "binary-not-found",
      errorMessage:
        `check-spec binary not found at '${binary}'. ` +
        `Install: 'go install github.com/mikeqoo1/check-spec/cmd/check-spec@latest' ` +
        `or grab a binary from https://github.com/mikeqoo1/check-spec/releases. ` +
        `Alternatively set checkSpec.binary in .arceus/config.json to an absolute path.`,
    };
  }

  const binaryVersion = getBinaryVersion(resolved);

  // 2. Invoke verify.
  const args = [
    "verify",
    "--change", changeId,
    "--base", options.base ?? "origin/main",
    "--head", options.head ?? "HEAD",
    "--format", format,
  ];
  if (options.model) {
    args.push("--model", options.model);
  }

  const result = spawnSync(resolved, args, { cwd, encoding: "utf-8" });

  // 3. spawn itself errored out (e.g. permission denied) — surface as binary-crash.
  if (result.error) {
    return {
      verdict: null,
      report: "",
      format,
      stderr: result.stderr ?? "",
      binaryExitCode: null,
      binaryVersion,
      errorKind: "binary-crash",
      errorMessage: `Failed to spawn check-spec: ${result.error.message}`,
    };
  }

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const exitCode = result.status ?? null;

  // 4. Classify pre-parse errors based on stderr signal.
  const stderrErrorKind = classifyError(stderr);
  if (stderrErrorKind === "missing-api-key") {
    return {
      verdict: null,
      report: stdout,
      format,
      stderr,
      binaryExitCode: exitCode,
      binaryVersion,
      errorKind: "missing-api-key",
      errorMessage:
        `check-spec requires ANTHROPIC_API_KEY. ` +
        `Export it in your shell, or set checkSpec.enabled=false in .arceus/config.json to disable the gate.`,
    };
  }
  if (stderrErrorKind === "git-ref-not-found") {
    return {
      verdict: null,
      report: stdout,
      format,
      stderr,
      binaryExitCode: exitCode,
      binaryVersion,
      errorKind: "git-ref-not-found",
      errorMessage:
        `check-spec could not resolve a git ref. ` +
        `Check --base / --head arguments, or run 'git fetch' to refresh remotes.\n` +
        stderr.trim(),
    };
  }

  // 5. Parse verdict. Failure to parse falls back to NEEDS_DISCUSSION semantics
  //    (caller decides) — we report parse-failed so the caller can print a warning.
  const verdict =
    format === "json" ? parseVerdictFromJson(stdout) : parseVerdictFromMarkdown(stdout);

  if (verdict === null) {
    // Unexpected exit code with no parseable verdict — binary-crash.
    if (exitCode !== 0 && exitCode !== 1) {
      return {
        verdict: null,
        report: stdout,
        format,
        stderr,
        binaryExitCode: exitCode,
        binaryVersion,
        errorKind: "binary-crash",
        errorMessage:
          `check-spec ${binaryVersion} exited ${exitCode} with no parseable verdict.\n` +
          (stderr.trim() || stdout.trim()),
      };
    }
    return {
      verdict: null,
      report: stdout,
      format,
      stderr,
      binaryExitCode: exitCode,
      binaryVersion,
      errorKind: "parse-failed",
      errorMessage:
        `check-spec ${binaryVersion} returned exit ${exitCode} but no recognisable verdict was found ` +
        `in the ${format} output. The report has been preserved for inspection.`,
    };
  }

  return {
    verdict,
    report: stdout,
    format,
    stderr,
    binaryExitCode: exitCode,
    binaryVersion,
    errorKind: null,
  };
}

/**
 * Default size threshold (in characters) beyond which we warn about change size.
 *
 * Calibration history:
 *   - v1 (2000 chars): too aggressive — any change with >5 task/AC rows
 *     blew through it because check-spec's per-item table dominates length.
 *   - v2 (7000 chars): set after the integrate-check-spec dogfood produced
 *     12k-16k char reports. 7000 ≈ 15 tasks × ~400 + 10 ACs × ~300 + buffer,
 *     so it fires only when a change is genuinely sprawling (or has heavy
 *     drift findings), not on every well-scoped change.
 *
 * See Decision 6 in the 2026-05-28-integrate-check-spec-as-completion-gate
 * change for full rationale.
 */
export const AUDIT_SIZE_WARNING_THRESHOLD = 7000;

/** Whether the report is "too large" — Heuristic that the change was sliced too coarsely. */
export function isReportOversize(report: string): boolean {
  return report.length > AUDIT_SIZE_WARNING_THRESHOLD;
}

export const OVERSIZE_WARNING_MESSAGE =
  `[arceus] Audit report exceeds ${AUDIT_SIZE_WARNING_THRESHOLD} chars — ` +
  `this change may be too large; consider splitting via 'arceus change new'.`;
