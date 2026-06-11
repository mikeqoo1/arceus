/**
 * Session log — JSONL event log for each session.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

export interface SessionEvent {
  timestamp: string;
  event: string;
  agent?: string;
  skill?: string;
  data?: Record<string, unknown>;
}

function getSessionDir(arceusDir: string, sessionId: string): string {
  return join(arceusDir, "sessions", sessionId);
}

function getLogPath(arceusDir: string, sessionId: string): string {
  return join(getSessionDir(arceusDir, sessionId), "log.jsonl");
}

export function logEvent(
  arceusDir: string,
  sessionId: string,
  event: SessionEvent,
): void {
  const logPath = getLogPath(arceusDir, sessionId);
  const dir = dirname(logPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + "\n", "utf-8");
}

export function readSessionLog(
  arceusDir: string,
  sessionId: string,
): SessionEvent[] {
  const logPath = getLogPath(arceusDir, sessionId);
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      // Tolerate individually corrupt lines (torn/interleaved writes) — one
      // bad line must not discard the whole log, or consumers like the stop
      // gate would silently bypass for the entire session.
      try {
        return [JSON.parse(line) as SessionEvent];
      } catch {
        return [];
      }
    });
}
