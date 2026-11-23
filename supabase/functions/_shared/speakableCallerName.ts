/**
 * Names that must never be spoken in a Mandy greeting (or written into
 * firstMessage / caller_first_name). Used by vapi-server-event and lookup-caller.
 */
const BLOCKED = new Set([
  "unknown",
  "unknown caller",
  "caller",
  "null",
  "undefined",
  "none",
  "n/a",
  "na",
  "anonymous",
  "not available",
  "no name",
  "customer",
  "new caller",
  "test",
  "test caller",
]);

export function isSpeakableCallerName(name?: string | null): boolean {
  if (!name) return false;
  const normalised = String(name)
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalised) return false;
  if (BLOCKED.has(normalised)) return false;
  // Refuse bare placeholders even if wrapped in punctuation: "unknown.", "(null)"
  const stripped = normalised.replace(/[^a-z0-9 ]/g, "").trim();
  if (!stripped || BLOCKED.has(stripped)) return false;
  return true;
}

/** First name we are willing to say out loud, or "" if none. */
export function speakableFirstName(firstName?: string | null, fullName?: string | null): string {
  if (isSpeakableCallerName(firstName)) return String(firstName).trim().split(/\s+/)[0];
  if (isSpeakableCallerName(fullName)) return String(fullName).trim().split(/\s+/)[0];
  return "";
}

/** Full name we are willing to pass as caller_name, or "". */
export function speakableFullName(fullName?: string | null, firstName?: string | null, lastName?: string | null): string {
  if (isSpeakableCallerName(fullName)) return String(fullName).trim();
  const composed = `${firstName || ""} ${lastName || ""}`.trim();
  if (isSpeakableCallerName(composed)) return composed;
  if (isSpeakableCallerName(firstName)) return String(firstName).trim();
  return "";
}

function lastCallAgo(lastCall: { when?: string } | null | undefined): string {
  if (!lastCall?.when) return "";
  return String(lastCall.when).replace(/^.*\(/, "").replace(/\)$/, "");
}

/**
 * Spoken first sentence. Keeps Mandy's existing wording when we have a
 * usable name or a brand-new caller. When we know they have called before
 * but the stored name is a placeholder, welcome them back with no name.
 */
export function buildMandyFirstMessage(opts: {
  firstName: string;
  lastCall?: { when?: string; service_type?: string } | null;
  isReturning: boolean;
  hasCallerNumber: boolean;
}): string {
  const unnamed = "Hi, you've reached 0800BeCool. May I start with your name please?";
  const service = String(opts.lastCall?.service_type || "job").toLowerCase();
  const ago = lastCallAgo(opts.lastCall);
  if (opts.firstName) {
    if (opts.lastCall) {
      return `Hi ${opts.firstName}, welcome back to 0800BeCool. I see you contacted us ${ago} about your ${service}. Are you calling about that?`;
    }
    return `Hi ${opts.firstName}, welcome back to 0800BeCool. How can I help you today?`;
  }
  if (opts.isReturning && opts.lastCall) {
    return `Hi, welcome back to 0800BeCool. I see you contacted us ${ago} about your ${service}. Are you calling about that?`;
  }
  if (opts.isReturning) {
    return "Hi, welcome back to 0800BeCool. How can I help you today?";
  }
  if (opts.hasCallerNumber) return unnamed;
  return unnamed;
}
