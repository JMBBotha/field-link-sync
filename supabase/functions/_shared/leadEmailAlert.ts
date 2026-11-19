/**
 * Website-lead email results. Shared by receive-website-lead and
 * send-transactional-email so a provider rejection is a short message, not a
 * swallowed status. No Deno APIs — vitest imports this file directly.
 */

/** Johan's business mailbox on the verified 0800becool.co.za domain. */
export const STAFF_ALERT_FROM_EMAIL = "johan@0800becool.co.za";
export const STAFF_ALERT_FROM_NAME = "0800-BE-COOL";

/** First try plus one retry. Each try is its own log row. */
export const LEAD_EMAIL_ATTEMPTS = 2;

const GENERIC = new Set(["PROVIDER_ERROR", "INTERNAL_ERROR", "BAD_REQUEST", "UNAUTHORIZED", "EMAIL_NOT_CONFIGURED"]);

export type SendOutcome = {
  ok: boolean;
  id: string | null;
  error: string | null;
  status: number | null;
};

function readable(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t || GENERIC.has(t)) return null;
  return t.slice(0, 500);
}

/** Pull a human message out of a Resend (or other) error body. */
export function providerErrorMessage(raw: string): string {
  const text = String(raw ?? "");
  try {
    const parsed = JSON.parse(text) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      const msg = readable(parsed.message) || readable(parsed.error) || readable(parsed.details);
      if (msg) return msg;
    }
  } catch {
    /* plain text */
  }
  return readable(text) || "Email provider rejected the message";
}

/** Interpret the HTTP result from send-transactional-email. */
export function parseTransactionalBody(httpOk: boolean, status: number, body: string): SendOutcome {
  let parsed: Record<string, unknown> | null = null;
  try {
    const value = body ? JSON.parse(body) : null;
    if (value && typeof value === "object") parsed = value as Record<string, unknown>;
  } catch {
    parsed = null;
  }
  const id = typeof parsed?.id === "string" && parsed.id ? parsed.id : null;
  const failed = !httpOk || status >= 400 || parsed?.success === false || typeof parsed?.error === "string";
  if (!failed) return { ok: true, id, error: null, status };
  const message = (parsed && (readable(parsed.message) || readable(parsed.details) || readable(parsed.error)))
    || readable(body)
    || `Email was not sent (HTTP ${status || 0})`;
  return { ok: false, id: null, error: message, status };
}

export function leadEmailFailedTitle(name: string): string {
  const who = name.trim() || "Unknown";
  return `Lead email failed: ${who}`;
}
