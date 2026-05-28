import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeConfig,
  readConfig,
  ensureArceusDir,
  ensureArceusGitignore,
  createChange,
  listChanges,
  getChange,
  archiveChange,
  updateChangeStatus,
  recordVerification,
  readChangeFile,
  ensureChangesDir,
  getAuditDir,
  getAuditLatestPath,
} from "./state/index.js";
import type { ChangeStatus } from "./state/index.js";
import {
  runCheckSpec,
  findBinary,
  isReportOversize,
  AUDIT_SIZE_WARNING_THRESHOLD,
  OVERSIZE_WARNING_MESSAGE,
} from "./integrations/check-spec.js";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function resolveArceusDir(): string {
  return join(process.cwd(), ".arceus");
}

function requireArceus(): string {
  const dir = resolveArceusDir();
  if (!existsSync(dir)) {
    console.error("Arceus not initialized. Run `arceus init` first.");
    process.exit(1);
  }
  return dir;
}

const program = new Command();

program
  .name("arceus")
  .description("Claude Code plugin — multi-agent orchestration with magic keywords")
  .version(getVersion());

program
  .command("init")
  .description("Initialize .arceus/ directory in the current project")
  .action(() => {
    const arceusDir = resolveArceusDir();

    const alreadyInitialized = existsSync(arceusDir);

    if (alreadyInitialized) {
      // Idempotent upgrade: write the nested .gitignore if missing, but
      // don't overwrite existing config or other state.
      ensureArceusGitignore(arceusDir);
      console.log(".arceus/ already exists. Ensured nested .gitignore is present.");
      printCheckSpecTip();
      return;
    }

    ensureArceusDir(arceusDir);
    ensureChangesDir(arceusDir);
    ensureArceusGitignore(arceusDir);
    writeConfig(arceusDir, {
      verification: {
        typecheck: "npm run typecheck",
        lint: "npm run lint",
        test: "npm run test",
        build: "npm run build",
      },
      maxRetries: 3,
    });

    console.log("Initialized .arceus/ directory with default config.");
    console.log("Edit .arceus/config.json to configure task sources and model preferences.");
    printCheckSpecTip();
  });

function printCheckSpecTip(): void {
  const resolved = findBinary("check-spec");
  console.log("");
  if (resolved) {
    console.log(`✓ check-spec detected at ${resolved}`);
    console.log("  Run independent spec/code audits: arceus change verify <id>");
  } else {
    console.log("Tip: Arceus integrates with check-spec for independent spec/code audits.");
    console.log("  Install:   go install github.com/mikeqoo1/check-spec/cmd/check-spec@latest");
    console.log("             # or grab a binary from https://github.com/mikeqoo1/check-spec/releases");
    console.log("  Run:       arceus change verify <id>");
    console.log("  Strict gate (opt-in): set checkSpec.requireApprove=true in .arceus/config.json");
  }
}

program
  .command("status")
  .description("Show Arceus plugin status")
  .action(() => {
    const arceusDir = resolveArceusDir();

    if (!existsSync(arceusDir)) {
      console.log("Arceus not initialized. Run `arceus init` first.");
      return;
    }

    console.log("Arceus Plugin Status");
    console.log("====================");
    console.log(`  Directory: ${arceusDir}`);
    console.log(`  Config: ${existsSync(join(arceusDir, "config.json")) ? "found" : "missing"}`);
    console.log(`  Notepad: ${existsSync(join(arceusDir, "notepad.md")) ? "has content" : "empty"}`);

    const sessionsDir = join(arceusDir, "sessions");
    if (existsSync(sessionsDir)) {
      try {
        const sessions = readdirSync(sessionsDir);
        console.log(`  Sessions: ${sessions.length}`);
      } catch {
        console.log("  Sessions: unknown");
      }
    }

    const activeChanges = existsSync(join(arceusDir, "changes"))
      ? listChanges(arceusDir)
      : [];
    console.log(`  Active changes: ${activeChanges.length}`);
  });

// --- change subcommands ---

const change = program.command("change").description("Manage OpenSpec-style change proposals");

change
  .command("new <title...>")
  .description("Create a new change folder skeleton")
  .option("-a, --author <name>", "Author name to record in meta.json")
  .action((titleParts: string[], opts: { author?: string }) => {
    const arceusDir = requireArceus();
    const title = titleParts.join(" ").trim();
    if (!title) {
      console.error("Title is required.");
      process.exit(1);
    }
    const created = createChange(arceusDir, title, opts.author ? { author: opts.author } : {});
    console.log(`Created change: ${created.id}`);
    console.log(`  ${created.dir}`);
    console.log("  proposal.md  spec.md  tasks.md  decisions.md  meta.json");
  });

change
  .command("list")
  .description("List change proposals")
  .option("-s, --status <status>", "Filter by status (draft|active|completed|archived)")
  .option("--all", "Include archived changes")
  .action((opts: { status?: string; all?: boolean }) => {
    const arceusDir = requireArceus();
    const list = listChanges(arceusDir, {
      ...(opts.status ? { status: opts.status as ChangeStatus } : {}),
      ...(opts.all ? { includeArchived: true } : {}),
    });

    if (list.length === 0) {
      console.log("No changes found.");
      return;
    }

    for (const c of list) {
      const author = c.author ? ` (${c.author})` : "";
      console.log(`  [${c.status.padEnd(9)}] ${c.id}  —  ${c.title}${author}`);
    }
  });

change
  .command("show <id>")
  .description("Print the proposal body for a change")
  .option("-f, --file <name>", "Which file to show (proposal|spec|tasks|decisions)", "proposal")
  .action((id: string, opts: { file?: string }) => {
    const arceusDir = requireArceus();
    const c = getChange(arceusDir, id);
    if (!c) {
      console.error(`Change not found: ${id}`);
      process.exit(1);
    }
    const file = (opts.file ?? "proposal") as keyof typeof c.files;
    if (!(file in c.files)) {
      console.error(`Unknown file: ${file}. Expected one of proposal|spec|tasks|decisions.`);
      process.exit(1);
    }
    console.log(`# ${c.id} — ${c.title}  [${c.status}]`);
    console.log(`# ${c.dir}`);
    if (c.verdict) {
      console.log("");
      console.log("Audit:");
      console.log(`  Verdict:   ${c.verdict}`);
      console.log(`  At:        ${c.verifiedAt ?? "?"}`);
      console.log(`  Base:      ${c.verifiedBase ?? "?"}`);
      console.log(`  Head SHA:  ${c.verifiedSha ?? "?"}`);
      if (c.verificationModel) console.log(`  Model:     ${c.verificationModel}`);
      if (c.verificationBinaryVersion) console.log(`  check-spec: ${c.verificationBinaryVersion}`);
      const latestReport = getAuditLatestPath(arceusDir, c.id);
      if (existsSync(latestReport)) {
        console.log(`  Report:    ${latestReport}`);
      }
    }
    console.log("");
    console.log(readChangeFile(c, file));
  });

change
  .command("status <id> <status>")
  .description("Update change status (draft|active|completed|archived)")
  .option("--force", "Strict mode only: bypass the check-spec completion gate (logged to audit/force-overrides.log)")
  .option("--reason <text>", "Free-text reason recorded with --force entries")
  .action((id: string, status: string, opts: { force?: boolean; reason?: string }) => {
    const arceusDir = requireArceus();
    const allowed: ChangeStatus[] = ["draft", "active", "completed", "archived"];
    if (!allowed.includes(status as ChangeStatus)) {
      console.error(`Invalid status. Expected one of: ${allowed.join(", ")}`);
      process.exit(1);
    }
    try {
      const updated = updateChangeStatus(arceusDir, id, status as ChangeStatus, {
        ...(opts.force ? { force: true } : {}),
        ...(opts.reason ? { forceReason: opts.reason } : {}),
      });
      console.log(`${updated.id} → ${updated.status}`);
    } catch (err) {
      process.stderr.write(`[arceus] ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  });

change
  .command("verify <id>")
  .description("Run check-spec against a change and record the verdict in meta.json")
  .option("--base <ref>", "Base git ref to diff against", "origin/main")
  .option("--head <ref>", "Head git ref", "HEAD")
  .option("--format <fmt>", "Report format saved to audit/ (markdown|json)", "markdown")
  .option("--model <id>", "LLM model id forwarded to check-spec")
  .option("--no-save", "Skip writing the report and meta.json (dry-run)")
  .action((id: string, opts: {
    base: string;
    head: string;
    format: string;
    model?: string;
    save: boolean;  // commander inverts --no-save → save: false
  }) => {
    const arceusDir = requireArceus();
    const change = getChange(arceusDir, id);
    if (!change) {
      console.error(`Change not found: ${id}`);
      process.exit(1);
    }

    if (opts.format !== "markdown" && opts.format !== "json") {
      console.error(`Invalid --format: ${opts.format}. Expected markdown|json.`);
      process.exit(1);
    }

    const config = readConfig(arceusDir);
    const checkSpec = config.checkSpec ?? {};
    const enabled = checkSpec.enabled !== false;
    const binary = checkSpec.binary ?? "check-spec";

    const result = runCheckSpec(arceusDir, id, {
      base: opts.base,
      head: opts.head,
      format: opts.format,
      binary,
      ...(opts.model ? { model: opts.model } : {}),
    });

    // Surface errors actionably before touching meta.json.
    if (result.errorKind) {
      process.stderr.write(`[arceus] ${result.errorMessage ?? "check-spec failed"}\n`);
      // Preserve any partial output for diagnostics if save is requested.
      if (opts.save && result.report) {
        persistReport(arceusDir, id, result, opts.format);
      }
      process.exit(2);
    }

    const tooLarge = isReportOversize(result.report);
    if (tooLarge) {
      process.stderr.write(`${OVERSIZE_WARNING_MESSAGE}\n`);
    }

    // Disabled mode: write the audit report (so users can still debug) but
    // do NOT touch meta.json, per spec.md F4.
    if (!enabled) {
      if (opts.save) {
        persistReport(arceusDir, id, result, opts.format, { warnIfOversize: tooLarge });
      }
      process.stderr.write(
        "[arceus] checkSpec.enabled=false — report saved but verdict not recorded to meta.json.\n",
      );
      reportSummary(result, /* persisted= */ opts.save, /* metaWritten= */ false);
      return;
    }

    if (!opts.save) {
      // Dry-run: print but don't persist.
      reportSummary(result, /* persisted= */ false, /* metaWritten= */ false);
      return;
    }

    // Resolve current HEAD so meta.json's verifiedSha is authoritative.
    const headResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" });
    const headSha = headResult.status === 0 ? (headResult.stdout?.trim() ?? "") : "";

    persistReport(arceusDir, id, result, opts.format, { warnIfOversize: tooLarge });

    // verdict is non-null in success path — narrow for the type system.
    if (result.verdict !== null) {
      recordVerification(arceusDir, id, {
        verdict: result.verdict,
        verifiedSha: headSha,
        verifiedBase: opts.base,
        ...(opts.model ? { verificationModel: opts.model } : {}),
        verificationBinaryVersion: result.binaryVersion,
      });
    }

    reportSummary(result, /* persisted= */ true, /* metaWritten= */ result.verdict !== null);
  });

function persistReport(
  arceusDir: string,
  id: string,
  result: { report: string; format: "markdown" | "json"; verdict: string | null; binaryVersion: string },
  requestedFormat: string,
  options: { warnIfOversize?: boolean } = {},
): { reportPath: string; latestPath: string } {
  const auditDir = getAuditDir(arceusDir, id);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });

  const ext = requestedFormat === "json" ? "json" : "md";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(auditDir, `${stamp}.${ext}`);

  const header = renderAuditHeader(result, options.warnIfOversize ?? false);
  const body =
    requestedFormat === "markdown"
      ? `${header}\n${result.report}`
      : result.report;

  writeFileSync(reportPath, body, "utf-8");

  // Maintain audit/latest.md as a copy of the latest markdown report. For
  // json runs we still write latest.md by wrapping the JSON in a fence so a
  // human reviewer always has one canonical entrypoint.
  const latestPath = getAuditLatestPath(arceusDir, id);
  if (requestedFormat === "markdown") {
    copyFileSync(reportPath, latestPath);
  } else {
    writeFileSync(
      latestPath,
      `${header}\n\`\`\`json\n${result.report}\n\`\`\`\n`,
      "utf-8",
    );
  }

  return { reportPath, latestPath };
}

function renderAuditHeader(
  result: { verdict: string | null; binaryVersion: string },
  oversize: boolean,
): string {
  const lines = ["<!-- arceus check-spec audit -->", `> **Verdict (recorded by arceus)**: ${result.verdict ?? "unparseable"}`, `> **check-spec version**: ${result.binaryVersion}`];
  if (oversize) {
    lines.push(`> [!WARNING]`);
    lines.push(`> ${OVERSIZE_WARNING_MESSAGE}`);
    lines.push(`> Threshold: ${AUDIT_SIZE_WARNING_THRESHOLD} chars; this report: ${"unknown"}.`);
  }
  lines.push("");
  return lines.join("\n");
}

function reportSummary(
  result: { verdict: string | null; binaryVersion: string; format: "markdown" | "json"; report: string },
  persisted: boolean,
  metaWritten: boolean,
): void {
  console.log("");
  console.log(`Verdict:   ${result.verdict ?? "unparseable"}`);
  console.log(`check-spec: ${result.binaryVersion}`);
  console.log(`Format:    ${result.format}`);
  console.log(`Size:      ${result.report.length} chars`);
  console.log(`Persisted: ${persisted ? "yes" : "no"}`);
  console.log(`meta.json: ${metaWritten ? "verdict recorded" : "untouched"}`);
}

change
  .command("archive <id>")
  .description("Archive a completed change (moves folder to changes/archive/)")
  .action((id: string) => {
    const arceusDir = requireArceus();
    const archived = archiveChange(arceusDir, id);
    console.log(`Archived: ${archived.id}`);
    console.log(`  ${archived.dir}`);
  });

program.parse();
