/**
 * A short call or hang-up with no name and no details is an admin follow-up,
 * not a lead and not a customer. Real calls (a name, an address, or the caller
 * actually describing the job) stay on the normal lead path.
 *
 * The company threshold lives in company_settings.sales_stage_limits.hangupSeconds
 * (default 15), the same jsonb bag as the other heartbeat limits.
 */

export type SpeechMessage = { role?: string | null; message?: string | null; content?: string | null };

const USER_ROLES = new Set(["user", "customer", "caller"]);
const MISSING_NAME = /^(unknown(\s+caller)?|caller|anonymous|n\/a|na|none|no name)$/i;
const PENDING_ADDRESS = /^address pending\b/i;
/** Reasons that mean nobody had a conversation. A normal "customer-ended-call" is not one of these. */
const NO_CONVERSATION = /silence-timed-out|silence timed|customer-did-not-answer|customer-busy|no-answer|did-not-answer/i;

export function userSpeech(messages?: SpeechMessage[] | null, transcript?: string | null): string {
  const fromMessages = (messages || [])
    .filter((m) => USER_ROLES.has(String(m.role || "").toLowerCase()))
    .map((m) => m.message || m.content || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (fromMessages) return fromMessages;
  return (transcript || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(user|customer|caller)\s*:/i.test(line))
    .map((line) => line.replace(/^(user|customer|caller)\s*:/i, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function capturedName(name?: string | null): string | null {
  const n = (name || "").replace(/\s+/g, " ").trim();
  if (!n || MISSING_NAME.test(n)) return null;
  return n;
}

/** An address, or enough of the caller's own words to be a job. The assistant's greeting is not details. */
export function capturedDetails(input: { address?: string | null; userText?: string | null }): boolean {
  const address = (input.address || "").trim();
  if (address && !PENDING_ADDRESS.test(address)) return true;
  return (input.userText || "").replace(/\s+/g, " ").trim().length >= 24;
}

export function hangupThresholdSeconds(limits: unknown, fallback = 15): number {
  const raw = limits && typeof limits === "object" ? (limits as { hangupSeconds?: unknown }).hangupSeconds : undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isBareHangup(input: {
  durationSeconds?: number | string | null;
  thresholdSeconds?: number | null;
  callerName?: string | null;
  address?: string | null;
  userText?: string | null;
  endedReason?: string | null;
}): boolean {
  if (capturedName(input.callerName) || capturedDetails({ address: input.address, userText: input.userText })) {
    return false;
  }
  if (input.durationSeconds === null || input.durationSeconds === undefined || input.durationSeconds === "") {
    return false;
  }
  const duration = Number(input.durationSeconds);
  if (!Number.isFinite(duration)) return false;
  const threshold = hangupThresholdSeconds(
    input.thresholdSeconds == null ? null : { hangupSeconds: input.thresholdSeconds },
  );
  if (duration < threshold) return true;
  return NO_CONVERSATION.test(input.endedReason || "") && duration < 120;
}
