/**
 * Peach Payments configuration + helpers.
 *
 * Environment separation rule (enforced, not conventional):
 *  - The environment ALWAYS comes from the PEACH_ENVIRONMENT secret.
 *  - There is no hardcoded default of "live"; anything other than the literal
 *    string "live" is treated as sandbox.
 *  - Base URLs are derived from that flag only. No URL is ever hardcoded at a
 *    call site.
 *  - Every payment row and webhook event records the environment it was made
 *    in, so sandbox test traffic can never be reconciled against live money.
 */

export type PeachEnvironment = "sandbox" | "live";

export interface PeachConfig {
  environment: PeachEnvironment;
  entityId: string;
  accessToken: string;
  baseUrl: string;
  webhookKeyHex: string | null;
}

const BASE_URLS: Record<PeachEnvironment, string> = {
  sandbox: "https://eu-test.oppwa.com",
  live: "https://eu-prod.oppwa.com",
};

export function peachEnvironment(): PeachEnvironment {
  return Deno.env.get("PEACH_ENVIRONMENT")?.trim().toLowerCase() === "live"
    ? "live"
    : "sandbox";
}

export function getPeachConfig(): PeachConfig {
  const environment = peachEnvironment();
  const entityId = Deno.env.get("PEACH_ENTITY_ID")?.trim() ?? "";
  const accessToken = Deno.env.get("PEACH_ACCESS_TOKEN")?.trim() ?? "";

  if (!entityId || !accessToken) {
    throw new Error(
      "Peach Payments is not configured (PEACH_ENTITY_ID / PEACH_ACCESS_TOKEN missing)",
    );
  }

  return {
    environment,
    entityId,
    accessToken,
    baseUrl: BASE_URLS[environment],
    webhookKeyHex: Deno.env.get("PEACH_WEBHOOK_KEY")?.trim() || null,
  };
}

/** Peach result codes: successful / successfully processed but manually reviewed. */
const SUCCESS_RE = /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.0[^3]|000\.400\.100)/;
const PENDING_RE = /^(000\.200|800\.400\.5|100\.400\.500)/;

export type PaymentStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";

export function mapResultCode(code: string | undefined | null): PaymentStatus {
  if (!code) return "pending";
  if (SUCCESS_RE.test(code)) return "paid";
  if (PENDING_RE.test(code)) return "processing";
  return "failed";
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/**
 * Decrypts a Peach webhook body (AES-256-GCM, hex encoded) using the
 * configured webhook key. Returns null when the payload cannot be
 * authenticated — callers must treat that as an invalid signature.
 */
export async function decryptPeachWebhook(
  bodyHex: string,
  ivHex: string,
  authTagHex: string,
  keyHex: string,
): Promise<Record<string, unknown> | null> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(keyHex),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const cipher = hexToBytes(bodyHex);
    const tag = hexToBytes(authTagHex);
    const combined = new Uint8Array(cipher.length + tag.length);
    combined.set(cipher);
    combined.set(tag, cipher.length);

    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(ivHex), tagLength: 128 },
      key,
      combined,
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (_e) {
    return null;
  }
}
