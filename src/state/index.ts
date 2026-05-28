export { readNotepad, writeNotepad, appendToNotepad } from "./notepad.js";
export type { NotepadEntry } from "./notepad.js";

export { logEvent, readSessionLog } from "./session-log.js";
export type { SessionEvent } from "./session-log.js";

export {
  readConfig,
  writeConfig,
  ensureArceusDir,
  ensureArceusGitignore,
} from "./config.js";
export type { ArceusProjectConfig, TaskSourceEntry } from "./config.js";

export {
  runGitPreflight,
  getPreflightMarkerPath,
  isPreflightDone,
  markPreflightDone,
} from "./preflight.js";
export type { PreflightOptions, PreflightResult } from "./preflight.js";

export {
  slugify,
  ensureChangesDir,
  createChange,
  getChange,
  listChanges,
  updateChangeStatus,
  archiveChange,
  deleteChange,
  readChangeFile,
  writeChangeFile,
} from "./changes.js";
export type {
  Change,
  ChangeMeta,
  ChangeStatus,
  ChangeSummary,
  CreateChangeOptions,
  ListChangesOptions,
} from "./changes.js";
