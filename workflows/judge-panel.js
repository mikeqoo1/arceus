/**
 * Arceus workflow — multi-draft judge panel for proposal synthesis (propose Step 3, Path A).
 *
 * args: { changeId: string, changePath: string, researchFindings: string, userGoal: string }
 * Returns: { proposal, spec, tasks, decisions, openQuestions, judgeNotes }
 *
 * The MAIN agent writes the four change files from the returned content —
 * workflow agents never write change files themselves.
 *
 * Harness contract notes: `meta` is a PURE literal; Date.now() / new Date() /
 * Math.random() are forbidden in workflow scripts (resume safety); all agents
 * here are prompt-only workers.
 */
export const meta = {
  name: "judge-panel",
  description: "Multi-draft adversarial judge panel for proposal synthesis",
  phases: [
    { title: "drafting", detail: "3 lens drafters in parallel" },
    { title: "judging", detail: "2 judges fact-check all drafts against the code" },
    { title: "synthesis", detail: "merge the winning draft with the best ideas" },
  ],
};

// Harness interop: some harness versions deliver `args` JSON-encoded as a
// string — normalize once and use `input` everywhere below.
const input = typeof args === "string" ? JSON.parse(args) : args;

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    lens: { type: "string" },
    proposal: { type: "string" },
    spec: { type: "string" },
    tasks: { type: "string" },
    decisions: { type: "string" },
  },
  required: ["lens", "proposal", "spec", "tasks", "decisions"],
};

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    rankings: {
      type: "array",
      items: { type: "number" },
      description: "1-based draft indices, best first (single-draft case: [1])",
    },
    factErrors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          draftIndex: { type: "number" },
          claim: { type: "string" },
          reality: { type: "string" },
        },
        required: ["draftIndex", "claim", "reality"],
      },
    },
    bestIdeas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          draftIndex: { type: "number" },
          idea: { type: "string" },
        },
        required: ["draftIndex", "idea"],
      },
    },
  },
  required: ["rankings", "factErrors", "bestIdeas"],
};

const SYNTH_SCHEMA = {
  type: "object",
  properties: {
    proposal: { type: "string" },
    spec: { type: "string" },
    tasks: { type: "string" },
    decisions: { type: "string" },
    openQuestions: { type: "array", items: { type: "string" } },
  },
  required: ["proposal", "spec", "tasks", "decisions", "openQuestions"],
};

const LENSES = [
  {
    key: "minimal-surface",
    desc: "Smallest possible diff, maximum reuse of existing mechanisms, lowest regression risk. Aggressively defer nice-to-haves and say so explicitly.",
  },
  {
    key: "robustness-edge-cases",
    desc: "Enumerate failure modes first (errors, timeouts, corrupt state, concurrent use); every edge case gets an acceptance criterion or an explicit non-goal.",
  },
  {
    key: "team-workflow-DX",
    desc: "Config ergonomics, sensible defaults, documentation quality, collaboration experience in PR review, adoption friction.",
  },
];

const DOC_RULES = [
  "All four files in Traditional Chinese (繁體中文); code identifiers, paths, commands in English.",
  "proposal.md: 為什麼 (Why) / 範圍 (Scope, In+Out) / Stakeholders. spec.md: 需求描述 (user story + F1..Fn) / 驗收條件 (AC checkboxes, each objectively checkable) / 技術假設. tasks.md: phased T-1..T-n checklist, each item independently verifiable, includes tests + docs + final npm run verify. decisions.md: numbered, Context/Options considered/Chosen/Rationale.",
  "Cite real file paths and function names — no vague language. Return file CONTENTS only; do NOT write any file.",
];

function draftPrompt(lens) {
  return [
    "You are one drafter in a judge panel producing a change proposal for change \"" + input.changeId + "\" (folder: " + input.changePath + ").",
    "USER GOAL: " + input.userGoal,
    "YOUR DESIGN LENS — bias every decision toward it and record the bias in decisions.md: " + lens.desc,
    "",
    input.researchFindings
      ? "RESEARCH FINDINGS (produced by a prior research step — build on these, do not re-research):\n" + input.researchFindings
      : "No research findings were provided — explore the repository yourself (Read/Grep) as needed to ground every claim.",
    "",
    "OUTPUT RULES:",
    DOC_RULES.map((r) => "- " + r).join("\n"),
    "Set lens to \"" + lens.key + "\".",
  ].join("\n");
}

function judgePrompt(n, drafts) {
  return [
    "You are judge #" + n + " in a proposal judge panel for change \"" + input.changeId + "\".",
    "Read ALL drafts below. Verify their factual claims about the codebase (file paths, function names, config keys, line references) by Reading the ACTUAL repository files — every false claim goes into factErrors with the observed reality.",
    drafts.length === 1
      ? "Only one draft survived drafting — skip ranking (return rankings: [1]) but still fact-check it thoroughly."
      : "Rank the drafts best-first by overall fitness to ship (rankings are 1-based draft indices).",
    "Collect bestIdeas worth keeping in the final synthesis regardless of which draft wins.",
    "",
    drafts
      .map(
        (d, i) =>
          "=== DRAFT " + (i + 1) + " [" + d.lens + "] ===\n--- proposal.md ---\n" + d.proposal +
          "\n--- spec.md ---\n" + d.spec +
          "\n--- tasks.md ---\n" + d.tasks +
          "\n--- decisions.md ---\n" + d.decisions,
      )
      .join("\n\n"),
  ].join("\n");
}

function synthPrompt(drafts, judges) {
  return [
    "You are the synthesis agent of a proposal judge panel for change \"" + input.changeId + "\".",
    "Build the FINAL proposal from the materials below:",
    "1. Start from the consensus-winning draft (aggregate the judges' rankings; on a full conflict between judges, decide yourself and note the call in decisions.md).",
    "2. Fix EVERY factError — the judges checked the real code; their `reality` is authoritative over any draft claim.",
    "3. Graft in the bestIdeas that survive scope discipline.",
    "4. Keep the result readable and shippable — a union dump of all drafts is failure.",
    "openQuestions: only genuine decisions the human owner must make (max 6, Traditional Chinese).",
    "",
    "OUTPUT RULES:",
    DOC_RULES.map((r) => "- " + r).join("\n"),
    "",
    "=== JUDGE VERDICTS ===",
    JSON.stringify(judges, null, 1),
    "",
    drafts
      .map(
        (d, i) =>
          "=== DRAFT " + (i + 1) + " [" + d.lens + "] ===\n--- proposal.md ---\n" + d.proposal +
          "\n--- spec.md ---\n" + d.spec +
          "\n--- tasks.md ---\n" + d.tasks +
          "\n--- decisions.md ---\n" + d.decisions,
      )
      .join("\n\n"),
  ].join("\n");
}

phase("drafting");
const drafts = (
  await parallel(
    LENSES.map((l) => () =>
      agent(draftPrompt(l), {
        label: "draft:" + l.key,
        phase: "drafting",
        schema: DRAFT_SCHEMA,
      })
        // Shape-check + catch: tolerate error-shaped results and rejections.
        .then((d) => (d && typeof d.proposal === "string" ? { ...d, lens: l.key } : null))
        .catch(() => null),
    ),
  )
).filter(Boolean);
if (drafts.length === 0) throw new Error("all drafter agents failed");
log("drafting: " + drafts.length + "/" + LENSES.length + " drafts produced");

phase("judging");
const judges = (
  await parallel(
    [1, 2].map((n) => () =>
      agent(judgePrompt(n, drafts), {
        label: "judge:" + n,
        phase: "judging",
        schema: JUDGE_SCHEMA,
      })
        .then((j) =>
          j && Array.isArray(j.rankings) && Array.isArray(j.factErrors) && Array.isArray(j.bestIdeas)
            ? j
            : null,
        )
        .catch(() => null),
    ),
  )
).filter(Boolean);
// Synthesis without ANY fact-checking judge would silently ship unverified
// claims — fail loudly instead so the caller can fall back.
if (judges.length === 0) throw new Error("all judge agents failed");
log("judging: " + judges.length + "/2 judges returned; factErrors total: " + judges.reduce((s, j) => s + j.factErrors.length, 0));

phase("synthesis");
const final = await agent(synthPrompt(drafts, judges), {
  label: "synthesis",
  phase: "synthesis",
  schema: SYNTH_SCHEMA,
}).catch(() => null);
if (!final) throw new Error("synthesis agent failed");

return {
  proposal: final.proposal,
  spec: final.spec,
  tasks: final.tasks,
  decisions: final.decisions,
  openQuestions: final.openQuestions,
  judgeNotes: judges.map((j) => ({
    rankings: j.rankings,
    factErrors: j.factErrors.length,
    bestIdeas: j.bestIdeas.length,
  })),
};
