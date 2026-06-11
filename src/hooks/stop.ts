/**
 * Stop hook — saves state before session ends, then evaluates the verification gate.
 */

import { readStdin, passThrough, writeOutput, getArceusDir } from "./utils.js";
import type { StopInput } from "./types.js";
import { logEvent, readConfig, readSessionLog } from "../state/index.js";
import { evaluateStopGate } from "./stop-gate.js";
import type { StopGateConfig } from "./stop-gate.js";

// Default gate config applied when .arceus/config.json is absent or incomplete.
const DEFAULT_EXCLUDED_PATHS = [".arceus/", "*.md"];

async function main(): Promise<void> {
  const input = await readStdin<StopInput>();
  const arceusDir = getArceusDir(input.cwd);

  // Always log session_stop first — gate errors caught below must not lose this event.
  logEvent(arceusDir, input.session_id, {
    timestamp: new Date().toISOString(),
    event: "session_stop",
  });

  // Entire gate block is fail-open: any unexpected error → stderr + passThrough.
  try {
    const config = readConfig(arceusDir);

    // Master switch: disabled in config → bypass immediately. Checked BEFORE
    // loop protection so a disabled gate never emits Arceus-branded messages
    // (stop_hook_active may be set by ANOTHER plugin's Stop hook block).
    if (config.stopGate?.enabled === false) {
      passThrough();
      return;
    }

    // Loop protection: when Claude Code re-enters Stop after a prior block, pass unconditionally.
    if (input.stop_hook_active === true) {
      writeOutput({
        continue: true,
        systemMessage:
          "[Arceus Stop Gate] Verification gate bypassed after a previous block. Check verification status manually.",
      });
      return;
    }

    // Read session log (fail-open: corrupt log → passThrough via outer catch).
    const events = readSessionLog(arceusDir, input.session_id);

    // Build StopGateConfig with defaults.
    const gateConfig: StopGateConfig = {
      enabled: config.stopGate?.enabled ?? true,
      requireVerify: config.stopGate?.requireVerify ?? false,
      excludedPaths: config.stopGate?.excludedPaths ?? DEFAULT_EXCLUDED_PATHS,
    };

    // stopHookActive is always false here — the early-return guard above
    // already handled the true case (loop protection).
    const result = evaluateStopGate({
      events,
      config: gateConfig,
      stopHookActive: false,
    });

    if (result.action === "pass") {
      passThrough();
    } else if (result.action === "warn") {
      writeOutput({ continue: true, systemMessage: result.reason });
    } else {
      // block
      writeOutput({ decision: "block", reason: result.reason });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[arceus] stop-gate internal error: ${msg}, passing through.\n`,
    );
    passThrough();
  }
}

main().catch((err) => {
  process.stderr.write(`arceus stop hook error: ${err}\n`);
  process.exit(0);
});
