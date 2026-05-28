import { Command } from "commander";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  writeConfig,
  ensureArceusDir,
  ensureArceusGitignore,
  createChange,
  listChanges,
  getChange,
  archiveChange,
  updateChangeStatus,
  readChangeFile,
  ensureChangesDir,
} from "./state/index.js";
import type { ChangeStatus } from "./state/index.js";

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
  });

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
    console.log("");
    console.log(readChangeFile(c, file));
  });

change
  .command("status <id> <status>")
  .description("Update change status (draft|active|completed|archived)")
  .action((id: string, status: string) => {
    const arceusDir = requireArceus();
    const allowed: ChangeStatus[] = ["draft", "active", "completed", "archived"];
    if (!allowed.includes(status as ChangeStatus)) {
      console.error(`Invalid status. Expected one of: ${allowed.join(", ")}`);
      process.exit(1);
    }
    const updated = updateChangeStatus(arceusDir, id, status as ChangeStatus);
    console.log(`${updated.id} → ${updated.status}`);
  });

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
