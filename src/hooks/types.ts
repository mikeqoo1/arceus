/**
 * Types for Claude Code hook stdin/stdout protocol.
 */

// --- Common input fields (all hooks receive these) ---

export interface HookBaseInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  permission_mode: string;
  hook_event_name: string;
  agent_id?: string;
  agent_type?: string;
}

export interface SessionStartInput extends HookBaseInput {
  hook_event_name: "SessionStart";
  source: "startup" | "resume" | "clear" | "compact";
  model: string;
}

export interface UserPromptSubmitInput extends HookBaseInput {
  hook_event_name: "UserPromptSubmit";
  prompt: string;
}

export interface PreToolUseInput extends HookBaseInput {
  hook_event_name: "PreToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

export interface PostToolUseInput extends HookBaseInput {
  hook_event_name: "PostToolUse";
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_response: string;
  tool_use_id: string;
}

export interface SubagentStopInput extends HookBaseInput {
  hook_event_name: "SubagentStop";
  agent_id: string;
  agent_type: string;
  agent_transcript_path: string;
  last_assistant_message: string;
}

export interface StopInput extends HookBaseInput {
  hook_event_name: "Stop";
  /**
   * True when the assistant is continuing because a prior Stop hook blocked.
   * Used by the stop gate for loop protection: when true the gate passes unconditionally
   * to prevent infinite stop-block cycles.
   */
  stop_hook_active?: boolean;
}

export type HookInput =
  | SessionStartInput
  | UserPromptSubmitInput
  | PreToolUseInput
  | PostToolUseInput
  | SubagentStopInput
  | StopInput;

// --- Hook output (stdout) ---

export interface HookOutput {
  continue?: boolean;
  stopReason?: string;
  suppressOutput?: boolean;
  systemMessage?: string;
  decision?: "block" | "allow" | "deny" | "defer" | "ask";
  reason?: string;
  hookSpecificOutput?: HookSpecificOutput;
}

export interface SessionStartSpecificOutput {
  hookEventName: "SessionStart";
  additionalContext?: string;
}

export interface UserPromptSubmitSpecificOutput {
  hookEventName: "UserPromptSubmit";
  additionalContext?: string;
}

export interface PreToolUseSpecificOutput {
  hookEventName: "PreToolUse";
  permissionDecision?: "allow" | "deny" | "ask" | "defer";
  permissionDecisionReason?: string;
  updatedInput?: Record<string, unknown>;
  additionalContext?: string;
}

export interface PostToolUseSpecificOutput {
  hookEventName: "PostToolUse";
  additionalContext?: string;
}

export interface SubagentStopSpecificOutput {
  hookEventName: "SubagentStop";
  additionalContext?: string;
}

export interface StopSpecificOutput {
  hookEventName: "Stop";
}

export type HookSpecificOutput =
  | SessionStartSpecificOutput
  | UserPromptSubmitSpecificOutput
  | PreToolUseSpecificOutput
  | PostToolUseSpecificOutput
  | SubagentStopSpecificOutput
  | StopSpecificOutput;
