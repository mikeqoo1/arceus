/**
 * UserPromptSubmit hook — detects magic keywords and injects skill context.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { readStdin, writeOutput, passThrough, getArceusDir, getPluginRoot } from "./utils.js";
import type { UserPromptSubmitInput } from "./types.js";
import { logEvent, listChanges } from "../state/index.js";

// --- Keyword definitions ---

interface KeywordDef {
  patterns: RegExp;
  skill: string;
  description: string;
}

const KEYWORDS: KeywordDef[] = [
  {
    patterns: /\b(autopilot|auto[\s-]?pilot|full[\s-]?auto)\b/i,
    skill: "autopilot",
    description: "Full auto: plan → implement → test → review → complete",
  },
  {
    patterns: /(?:\bpropose\b|提案)/i,
    skill: "propose",
    description: "Draft a change proposal into .arceus/changes/",
  },
  {
    patterns: /(?:\bapply\b|實作)/i,
    skill: "apply",
    description: "Implement an approved change proposal",
  },
  {
    patterns: /(?:\breview[\s-]?change\b|審查)/i,
    skill: "review-change",
    description: "Review a change proposal before implementation",
  },
  {
    patterns: /\b(plan|plan[\s-]?and[\s-]?execute|規劃)\b/i,
    skill: "plan-and-execute",
    description: "Plan first, then execute after user confirmation",
  },
  {
    patterns: /\b(review|code[\s-]?review)\b/i,
    skill: "code-review",
    description: "Multi-perspective code review",
  },
  {
    patterns: /\b(tdd|test[\s-]?first|test[\s-]?driven)\b/i,
    skill: "debug-loop",
    description: "Test-driven / debug loop workflow",
  },
  {
    patterns: /\b(fix|debug|debug[\s-]?loop)\b/i,
    skill: "debug-loop",
    description: "Debug loop: fix → test → repeat until passing",
  },
  {
    patterns: /\b(deep[\s-]?dive|deep[\s-]?analysis|分析)\b/i,
    skill: "deep-analysis",
    description: "Deep code analysis",
  },
  {
    patterns: /\b(sync|同步|task[\s-]?sync)\b/i,
    skill: "task-sync",
    description: "Sync task status to Plane/GitLab/GitHub",
  },
];

// --- Sanitization ---

function sanitizePrompt(text: string): string {
  let sanitized = text;
  // Strip code blocks
  sanitized = sanitized.replace(/```[\s\S]*?```/g, "");
  sanitized = sanitized.replace(/`[^`]+`/g, "");
  // Strip URLs
  sanitized = sanitized.replace(/https?:\/\/\S+/g, "");
  // Strip file paths
  sanitized = sanitized.replace(/(?:\/[\w.-]+)+/g, "");
  // Strip quoted strings
  sanitized = sanitized.replace(/"[^"]*"/g, "");
  sanitized = sanitized.replace(/'[^']*'/g, "");
  return sanitized;
}

function isInformationalContext(text: string, match: RegExpMatchArray): boolean {
  const start = Math.max(0, (match.index ?? 0) - 40);
  const end = Math.min(text.length, (match.index ?? 0) + (match[0]?.length ?? 0) + 40);
  const window = text.slice(start, end).toLowerCase();

  const informationalPatterns = [
    /what is/,
    /how (?:do|does|to)/,
    /explain/,
    /tell me about/,
    /什麼是/,
    /怎麼/,
  ];

  return informationalPatterns.some((p) => p.test(window));
}

// --- Skill loading ---

function loadSkillContent(skillName: string, cwd: string): string | null {
  // Check project-level custom skills first
  const projectSkillPath = join(cwd, ".arceus", "skills", skillName, "SKILL.md");
  if (existsSync(projectSkillPath)) {
    return readFileSync(projectSkillPath, "utf-8");
  }

  // Check plugin built-in skills
  const pluginRoot = getPluginRoot();
  const builtinPath = join(pluginRoot, "skills", skillName, "SKILL.md");
  if (existsSync(builtinPath)) {
    // Substitute the plugin-root placeholder so builtin SKILL.md files can
    // reference plugin-shipped workflow scripts by absolute path. Builtin
    // skills only — project-level overrides control their own paths.
    // Function replacement — a plain string value would interpret `$`
    // replacement patterns ($$, $&, $`, $') appearing in the plugin path.
    return readFileSync(builtinPath, "utf-8").replaceAll(
      "{{ARCEUS_PLUGIN_ROOT}}",
      () => pluginRoot,
    );
  }

  return null;
}

// --- Main ---

async function main(): Promise<void> {
  const input = await readStdin<UserPromptSubmitInput>();
  const sanitized = sanitizePrompt(input.prompt);

  // Detect keywords
  let detectedSkill: KeywordDef | null = null;

  for (const kw of KEYWORDS) {
    const match = sanitized.match(kw.patterns);
    if (match && !isInformationalContext(sanitized, match)) {
      detectedSkill = kw;
      break;
    }
  }

  if (!detectedSkill) {
    passThrough();
    return;
  }

  // Log detection
  const arceusDir = getArceusDir(input.cwd);
  logEvent(arceusDir, input.session_id, {
    timestamp: new Date().toISOString(),
    event: "keyword_detected",
    skill: detectedSkill.skill,
    data: { keyword: detectedSkill.skill, prompt: input.prompt.slice(0, 200) },
  });

  // Load and inject skill content
  const skillContent = loadSkillContent(detectedSkill.skill, input.cwd);

  // For autopilot: surface active change proposals so AI knows to consider routing to `apply`
  let activeChangesNotice = "";
  if (detectedSkill.skill === "autopilot") {
    try {
      const actives = listChanges(arceusDir, { status: "active" });
      if (actives.length > 0) {
        const lines = actives.map((c) => `  - ${c.id} — ${c.title}`).join("\n");
        activeChangesNotice = `\n\n[ACTIVE CHANGE PROPOSALS DETECTED]\n${lines}\n\nBefore planning from scratch, STOP and ask the user whether autopilot should pivot to the \`apply\` skill for one of these proposals (Step 0.5).`;
      }
    } catch {
      // Non-fatal: missing/corrupt changes dir should not block keyword detection
    }
  }

  let additionalContext: string;
  if (skillContent) {
    additionalContext = `<arceus-skill name="${detectedSkill.skill}">
[MAGIC KEYWORD DETECTED: ${detectedSkill.skill.toUpperCase()}]
${detectedSkill.description}${activeChangesNotice}

${skillContent}

---
Original user request:
${input.prompt}
</arceus-skill>`;
  } else {
    // Fallback: instruct Claude to use the skill
    additionalContext = `<arceus-skill name="${detectedSkill.skill}">
[MAGIC KEYWORD DETECTED: ${detectedSkill.skill.toUpperCase()}]
${detectedSkill.description}${activeChangesNotice}

You MUST invoke the Arceus ${detectedSkill.skill} skill. Follow the standard ${detectedSkill.skill} workflow:
1. Understand the user's request
2. Delegate to appropriate arceus agents via subagent
3. Verify results with build/test/lint before marking complete
</arceus-skill>`;
  }

  writeOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  });
}

main().catch((err) => {
  process.stderr.write(`arceus keyword-detector hook error: ${err}\n`);
  process.exit(0);
});
