/**
 * WhatsApp (Twilio) sender abstraction.
 *
 * Environment separation rule (same pattern as _shared/peach.ts):
 *  - The environment ALWAYS comes from the TWILIO_ENVIRONMENT secret.
 *    Anything other than the literal string "live" is treated as sandbox.
 *  - In sandbox the sender defaults to the Twilio WhatsApp sandbox number
 *    unless TWILIO_WHATSAPP_NUMBER is explicitly set.
 *  - No credentials, numbers or URLs are ever hardcoded at a call site.
 */

export type TwilioEnvironment = "sandbox" | "live";

export interface WhatsAppConfig {
  environment: TwilioEnvironment;
  accountSid: string;
  authToken: string;
  from: string; // always "whatsapp:+E164"
  apiBaseUrl: string;
}

const TWILIO_SANDBOX_WHATSAPP_NUMBER = "+14155238886";

export function twilioEnvironment(): TwilioEnvironment {
  return Deno.env.get("TWILIO_ENVIRONMENT")?.trim().toLowerCase() === "live"
    ? "live"
    : "sandbox";
}

/** Normalise a South African / international number to E.164 with a leading +. */
export function toE164(phone: string): string {
  let cleaned = String(phone).replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (cleaned.startsWith("+")) return cleaned;
  if (cleaned.startsWith("0")) return "+27" + cleaned.slice(1);
  if (cleaned.startsWith("27")) return "+" + cleaned;
  return "+" + cleaned;
}

/** Ensure a value is prefixed with the Twilio `whatsapp:` channel scheme. */
export function whatsappAddress(phone: string): string {
  const raw = String(phone).replace(/^whatsapp:/i, "");
  return `whatsapp:${toE164(raw)}`;
}

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() &&
      Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() &&
      (Deno.env.get("TWILIO_WHATSAPP_NUMBER")?.trim() ||
        twilioEnvironment() === "sandbox"),
  );
}

export function getWhatsAppConfig(): WhatsAppConfig {
  const environment = twilioEnvironment();
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() ?? "";
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() ?? "";
  const configuredFrom = Deno.env.get("TWILIO_WHATSAPP_NUMBER")?.trim() ?? "";

  if (!accountSid || !authToken) {
    throw new Error(
      "WhatsApp is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN missing)",
    );
  }

  const from = configuredFrom ||
    (environment === "sandbox" ? TWILIO_SANDBOX_WHATSAPP_NUMBER : "");
  if (!from) {
    throw new Error("WhatsApp is not configured (TWILIO_WHATSAPP_NUMBER missing)");
  }

  return {
    environment,
    accountSid,
    authToken,
    from: whatsappAddress(from),
    apiBaseUrl: "https://api.twilio.com/2010-04-01",
  };
}

export interface SendWhatsAppInput {
  to: string;
  body: string;
  /** Optional media (PDF/image) URLs — must be publicly reachable by Twilio. */
  mediaUrls?: string[];
  /** Optional approved template SID (required for business-initiated messages). */
  contentSid?: string;
  contentVariables?: Record<string, string>;
  statusCallbackUrl?: string;
}

export interface SendWhatsAppResult {
  ok: boolean;
  sid?: string;
  status?: string;
  environment: TwilioEnvironment;
  error?: string;
  httpStatus?: number;
}

/**
 * Sends a WhatsApp message through Twilio. Never throws for provider errors —
 * the caller gets the provider status/body so it can queue a retry.
 */
export async function sendWhatsApp(
  input: SendWhatsAppInput,
): Promise<SendWhatsAppResult> {
  let config: WhatsAppConfig;
  try {
    config = getWhatsAppConfig();
  } catch (e) {
    return {
      ok: false,
      environment: twilioEnvironment(),
      error: e instanceof Error ? e.message : "WhatsApp not configured",
    };
  }

  const params = new URLSearchParams({
    From: config.from,
    To: whatsappAddress(input.to),
  });
  if (input.contentSid) {
    params.set("ContentSid", input.contentSid);
    if (input.contentVariables) {
      params.set("ContentVariables", JSON.stringify(input.contentVariables));
    }
  }
  if (input.body) params.set("Body", input.body);
  for (const url of input.mediaUrls ?? []) params.append("MediaUrl", url);
  if (input.statusCallbackUrl) params.set("StatusCallback", input.statusCallbackUrl);

  const res = await fetch(
    `${config.apiBaseUrl}/Accounts/${config.accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${config.accountSid}:${config.authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
    },
  );

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[whatsapp] send failed [${res.status}]`, payload);
    return {
      ok: false,
      environment: config.environment,
      error: payload?.message || `Twilio error ${res.status}`,
      httpStatus: res.status,
    };
  }

  return {
    ok: true,
    sid: payload?.sid,
    status: payload?.status,
    environment: config.environment,
  };
}

/**
 * Validates Twilio's X-Twilio-Signature for an inbound webhook.
 * Signature = base64(HMAC-SHA1(authToken, url + sorted concatenated form params)).
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
  if (!authToken || !signature) return false;

  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  // constant-time-ish comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${
      message.replace(/[<>&]/g, (c) =>
        ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))
    }</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
