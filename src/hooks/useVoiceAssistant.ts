/**
 * Types only. The old Vapi browser session (which called the `nl-voice-session`
 * edge function) was unlinked from the UI — in-app voice is Mandy (MandyDock).
 * `nl-voice-session` itself is kept because phone Mandy / Vapi shares its assistant ids.
 */
export interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

export interface PendingConfirmation {
  /** nl_audit_log row id of the queued write — used to make the modal one-shot. */
  id?: string;
  tool_name: string;
  args: Record<string, unknown>;
}

export type VoiceStatus = "idle" | "connecting" | "live" | "ended" | "error";
