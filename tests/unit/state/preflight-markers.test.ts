/**
 * Unit tests for the preflight fetch-attempt marker (issue #5 review fix):
 * `git fetch` must run at most once per session even while preflight keeps
 * failing and re-running on every modifying tool call.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getFetchAttemptMarkerPath,
  hasFetchAttempted,
  markFetchAttempted,
} from "../../../src/state/preflight.js";

describe("preflight fetch-attempt marker", () => {
  it("round-trips: absent → marked → present", () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-preflight-"));
    expect(hasFetchAttempted(dir, "s1")).toBe(false);
    markFetchAttempted(dir, "s1");
    expect(hasFetchAttempted(dir, "s1")).toBe(true);
    // Marker content is an ISO timestamp (debugging aid).
    const content = readFileSync(getFetchAttemptMarkerPath(dir, "s1"), "utf-8");
    expect(content).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is scoped per session id", () => {
    const dir = mkdtempSync(join(tmpdir(), "arceus-preflight-"));
    markFetchAttempted(dir, "s1");
    expect(hasFetchAttempted(dir, "s2")).toBe(false);
  });
});
