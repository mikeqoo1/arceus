/**
 * Arceus workflow — multi-dimension adversarial code review (apply Step 5, Path A).
 *
 * args: { changeId: string, diff: string, specContent: string, tasksContent: string }
 * Returns: { verdict, findings: { surviving, advisories }, dimensionErrors, report }
 *
 * Harness contract notes: `meta` is a PURE literal; Date.now() / new Date() /
 * Math.random() are forbidden in workflow scripts (resume safety); all agents
 * here are prompt-only workers.
 */
export const meta = {
  name: "adversarial-review",
  description: "Multi-dimension adversarial code review with skeptic verification",
  phases: [
    { title: "dimension-review", detail: "4 dimension reviewers in parallel" },
    { title: "skeptic-verification", detail: "one skeptic per block finding" },
    { title: "synthesis", detail: "merge surviving findings into the final report" },
  ],
};

// Harness interop: some harness versions deliver `args` JSON-encoded as a
// string — normalize once and use `input` everywhere below.
const input = typeof args === "string" ? JSON.parse(args) : args;

const FINDINGS_SCHEMA = {
  type: "object",
  properties: {
    dimension: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["block", "warn", "suggest"] },
          file: { type: "string" },
          description: { type: "string" },
          evidence: {
            type: "string",
            description: "must cite a concrete diff hunk or a spec acceptance criterion",
          },
        },
        required: ["severity", "file", "description", "evidence"],
      },
    },
  },
  required: ["dimension", "findings"],
};

const SKEPTIC_SCHEMA = {
  type: "object",
  properties: {
    findingIndex: { type: "number" },
    survives: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["findingIndex", "survives", "reasoning"],
};

const SYNTHESIS_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES"] },
    report: { type: "string" },
  },
  required: ["verdict", "report"],
};

const DIMENSIONS = [
  {
    key: "spec-compliance",
    focus:
      "Verify the diff satisfies EVERY acceptance criterion in spec.md. Each unmet, partially-met, or silently-deviated criterion is a finding (severity block when an AC is violated).",
  },
  {
    key: "correctness",
    focus:
      "Hunt for logic bugs introduced by the diff: broken edge cases, wrong conditionals, ordering bugs, unhandled errors, regressions in surrounding behavior.",
  },
  {
    key: "security",
    focus:
      "Hunt for security issues introduced by the diff: injection risks, path traversal, secrets in code or logs, unsafe shell usage, trust-boundary violations.",
  },
  {
    key: "performance",
    focus:
      "Hunt for performance regressions introduced by the diff: accidental quadratic loops, repeated I/O inside loops, unbounded growth, blocking calls on hot paths. Only report measurable risks.",
  },
];

function dimensionPrompt(d) {
  return [
    "You are the " + d.key + " reviewer in an adversarial review panel for change \"" + input.changeId + "\".",
    "FOCUS: " + d.focus,
    "Findings MUST cite evidence: a concrete hunk from the diff below, or a specific acceptance criterion from spec.md. No evidence, no finding.",
    "severity guide: block = must fix before completion; warn = should fix; suggest = optional polish.",
    "Report at most 8 findings. An EMPTY findings array is a valid result — do not invent problems.",
    "You may Read repository files for context beyond the diff. Do not modify any file.",
    "",
    "=== spec.md ===",
    input.specContent,
    "=== tasks.md ===",
    input.tasksContent,
    "=== diff ===",
    input.diff,
  ].join("\n");
}

function skepticPrompt(f, i) {
  return [
    "You are a skeptic verifying ONE finding from an adversarial code review of change \"" + input.changeId + "\".",
    "Try to REFUTE it. survives=false when the finding does not hold up: the evidence is wrong, the behavior is intended per spec, the scenario is unrealistic, or it belongs to a different change. survives=true ONLY for a real must-fix problem.",
    "Read the actual repository files to check the claim. Set findingIndex to " + i + ".",
    "",
    "FINDING [" + f.dimension + "/" + f.severity + "] " + f.file,
    f.description,
    "Evidence: " + f.evidence,
    "",
    "=== spec.md ===",
    input.specContent,
    "=== diff ===",
    input.diff,
  ].join("\n");
}

phase("dimension-review");
const dimResults = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(dimensionPrompt(d), {
      label: "dim:" + d.key,
      phase: "dimension-review",
      schema: FINDINGS_SCHEMA,
    })
      // Shape-check + catch: tolerate harness versions where a failed agent
      // resolves to an error-shaped value or rejects, instead of null.
      .then((r) => (r && Array.isArray(r.findings) ? { key: d.key, findings: r.findings } : null))
      .catch(() => null),
  ),
);

// A dimension whose agent errored is a COVERAGE GAP, not a pass — it must not
// block the other dimensions, but the synthesis report has to call it out.
const dimensionErrors = DIMENSIONS.filter((d, i) => !dimResults[i]).map((d) => d.key);
const all = dimResults
  .filter(Boolean)
  .flatMap((r) => r.findings.map((f) => ({ dimension: r.key, ...f })));
const blocks = all.filter((f) => f.severity === "block");
const advisories = all.filter((f) => f.severity !== "block");
log(
  "dimension-review: " + all.length + " findings (" + blocks.length + " block); incomplete: " +
    (dimensionErrors.join(", ") || "none"),
);

// Empty findings — skip skeptic-verification and synthesis entirely.
if (all.length === 0) {
  return {
    // Coverage gaps must never read as machine-approved.
    verdict: dimensionErrors.length > 0 ? "INCOMPLETE" : "APPROVE",
    findings: { surviving: [], advisories: [] },
    dimensionErrors,
    report:
      "No findings across " + (DIMENSIONS.length - dimensionErrors.length) + " completed dimensions." +
      (dimensionErrors.length
        ? " INCOMPLETE dimensions (agent error — coverage gap): " + dimensionErrors.join(", ")
        : ""),
  };
}

phase("skeptic-verification");
// Hard cap on skeptic fan-out — dimension prompts ask for at most 8 findings
// each, but the cap must not rely on agents obeying instructions.
const SKEPTIC_CAP = 12;
if (blocks.length > SKEPTIC_CAP) {
  log(
    "capping skeptics to " + SKEPTIC_CAP + "/" + blocks.length +
      " block findings; uncapped findings survive unverified (conservative)",
  );
}
const votes = await parallel(
  blocks.slice(0, SKEPTIC_CAP).map((f, i) => () =>
    agent(skepticPrompt(f, i), {
      label: "skeptic:" + i,
      phase: "skeptic-verification",
      schema: SKEPTIC_SCHEMA,
    }).catch(() => null),
  ),
);
// Conservative default: drop a finding ONLY when its skeptic explicitly
// refuted it (survives === false). Errored, missing, malformed, or uncapped
// skeptics keep the finding alive.
const surviving = blocks.filter(
  (f, i) => i >= SKEPTIC_CAP || !(votes[i] && votes[i].survives === false),
);
log("skeptic-verification: " + surviving.length + "/" + blocks.length + " block findings survived");

phase("synthesis");
const synthesis = await agent(
  [
    "You are the synthesis agent of an adversarial review for change \"" + input.changeId + "\".",
    "Produce the final review report in Traditional Chinese prose (code identifiers in English).",
    "List surviving block findings FIRST with their evidence — each was independently verified by a skeptic and MUST be fixed before completion. Then list advisory findings (warn/suggest).",
    dimensionErrors.length
      ? "Mark these dimensions as INCOMPLETE (agent error — treat as a coverage gap, not a pass): " + dimensionErrors.join(", ")
      : "All dimensions completed.",
    "verdict: REQUEST_CHANGES if any surviving block finding exists, otherwise APPROVE.",
    "",
    "=== surviving block findings ===",
    JSON.stringify(surviving, null, 1),
    "=== advisory findings ===",
    JSON.stringify(advisories, null, 1),
  ].join("\n"),
  { label: "synthesis", phase: "synthesis", schema: SYNTHESIS_SCHEMA },
).catch(() => null);

return {
  verdict:
    surviving.length > 0
      ? "REQUEST_CHANGES"
      : dimensionErrors.length > 0
        ? "INCOMPLETE"
        : "APPROVE",
  findings: { surviving, advisories },
  dimensionErrors,
  report: synthesis ? synthesis.report : "Synthesis agent failed — use the findings JSON above.",
};
