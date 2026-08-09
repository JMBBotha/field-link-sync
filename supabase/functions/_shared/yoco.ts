/**
 * Yoco payment gateway configuration + helpers.
 *
 * Environment separation rule (enforced, not conventional):
 *  - The environment ALWAYS comes from the YOCO_ENVIRONMENT secret.
 *  - There is no hardcoded default of "live"; anything other than the literal
 *    string "live" is treated as test.
 *  - Test and live use SEPARATE secret keys (YOCO_TEST_SECRET_KEY /
 *    YOCO_LIVE_SECRET_KEY) and separate webhook secrets, so a test event can
 *    never be reconciled against live money.
 *  - Every payment row and webhook event records the environment it was made in.
 */

export type YocoEnvironment = "test" | "live";

export interface YocoConfig {
  environment: YocoEnvironment;
  secretKey: string;
  baseUrl: string;
  webhookSecret: string | null;
}

/** Yoco uses a single API host; the key itself selects test vs live. */
const YOCO_API_BASE = "https://payments.yoco.com/api";

export function yocoEnvironment(): YocoEnvironment {
  return Deno.env.get("YOCO_ENVIRONMENT")?.trim().toLowerCase() === "live"
    ? "live"
    : "test";
}

export function getYocoConfig(): YocoConfig {
  const environment = yocoEnvironment();
  const secretKey = (environment === "live"
    ? Deno.env.get("YOCO_LIVE_SECRET_KEY")
    : Deno.env.get("YOCO_TEST_SECRET_KEY"))?.trim() ?? "";

  if (!secretKey) {
    throw new Error(
      `Yoco is not configured (${
        environment === "live" ? "YOCO_LIVE_SECRET_KEY" : "YOCO_TEST_SECRET_KEY"
      } missing)`,
    );
  }

  // Guard against a live key being used while the flag says test (and vice versa).
  const expectedPrefix = environment === "live" ? "sk_live_" : "sk_test_";
  if (!secretKey.startsWith(expectedPrefix)) {
    throw new Error(
      `Yoco key/environment mismatch: YOCO_ENVIRONMENT=${environment} expects a ${expectedPrefix}... key`,
    );
  }

  const webhookSecret = (environment === "live"
    ? Deno.env.get("YOCO_LIVE_WEBHOOK_SECRET")
    : Deno.env.get("YOCO_TEST_WEBHOOK_SECRET"))?.trim() || null;

  return { environment, secretKey, baseUrl: YOCO_API_BASE, webhookSecret };
}

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "refunded";

/** Maps a Yoco checkout/payment state to our internal payment status. */
export function mapYocoStatus(
  status: string | undefined | null,
  eventType?: string | null,
): PaymentStatus {
  const s = (status ?? "").toLowerCase();
  const e = (eventType ?? "").toLowerCase();

  if (e === "refund.succeeded" || s === "refunded") return "refunded";
  if (e === "payment.succeeded" || s === "succeeded" || s === "successful") {
    return "paid";
  }
  if (e === "payment.failed" || s === "failed") return "failed";
  if (s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "processing" || s === "pending") return "processing";
  return "pending";
}

/** ZAR rands → integer cents (Yoco amounts are always minor units). */
export function toCents(amount: number): number {
  return Math.round(Number(amount || 0) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(Number(cents || 0)) / 100;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a Yoco webhook (Standard Webhooks / Svix scheme).
 *
 * Signed content = `${webhook-id}.${webhook-timestamp}.${rawBody}`
 * Signature      = base64(HMAC-SHA256(secretBytes, signedContent))
 * The `webhook-signature` header may carry several space-separated
 * `v1,<sig>` values — any match is accepted.
 */
export async function verifyYocoWebhook(
  rawBody: string,
  headers: Headers,
  webhookSecret: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatureHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  // Replay window guard.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const secretBytes = webhookSecret.startsWith("whsec_")
    ? base64ToBytes(webhookSecret.slice("whsec_".length))
    : new TextEncoder().encode(webhookSecret);

  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return signatureHeader
    .split(" ")
    .map((part) => part.split(",")[1] ?? "")
    .some((sig) => sig && timingSafeEqual(sig, expected));
}
