/**
 * Public website endpoints (0800-BE-COOL site -> Field Lynk), 2026-10-19.
 * Shared guard rails for receive-website-lead, shop-prices and shop-checkout:
 *  - CORS allow-list (www/apex 0800becool.co.za + the website's own Lovable preview/published hosts)
 *  - honeypot (a hidden form field bots fill in): silently accept and drop
 *  - per-IP rate limit (hashed IP only, never the raw address) via fl_website_rate_hit (service_role only)
 */

const EXACT_ORIGINS = new Set([
  "https://www.0800becool.co.za",
  "https://0800becool.co.za",
  // TODO(remove once xneelo SSL is live): plain-http origins, approved by Johan 2026-10-19 10:59 SAST
  // so the live shop + lead form work before Let's Encrypt is enabled on xneelo. Delete these two lines then.
  "http://www.0800becool.co.za",
  "http://0800becool.co.za",
]);
// Lovable hosts for the website project only (a0033055… / ac-connection-hub), incl. id-preview-- / preview-- prefixes.
const LOVABLE_ORIGIN = /^https:\/\/([a-z0-9-]+--)?(a0033055-dead-4c27-b52b-8118cb332010|ac-connection-hub)\.(lovable\.app|lovableproject\.com)$/;

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  const o = origin.trim().toLowerCase().replace(/\/+$/, "");
  return EXACT_ORIGINS.has(o) || LOVABLE_ORIGIN.test(o);
}

/** CORS headers for this request. Unknown browser origins get no Allow-Origin header (the browser blocks them). */
export function corsFor(req: Request, methods = "POST, OPTIONS"): Record<string, string> {
  const origin = req.headers.get("origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** A browser request from a site that is not ours. Server-to-server calls (no Origin) are allowed through. */
export function isForeignBrowserOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return !!origin && !isAllowedOrigin(origin);
}

export const HONEYPOT_FIELDS = ["company_website", "website_url", "hp", "_gotcha"] as const;

/** True when any honeypot field has a value: a bot. Real visitors never see these fields. */
// deno-lint-ignore no-explicit-any
export function honeypotTripped(body: any): boolean {
  if (!body || typeof body !== "object") return false;
  return HONEYPOT_FIELDS.some((k) => typeof body[k] === "string" ? body[k].trim() !== "" : body[k] != null && body[k] !== false);
}

/** Drop honeypot fields before storing a payload. */
// deno-lint-ignore no-explicit-any
export function withoutHoneypot(body: any): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(body || {}) };
  for (const k of HONEYPOT_FIELDS) delete out[k];
  return out;
}

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/**
 * Returns true when this IP may call `endpoint` again (and records the hit), false when over the limit.
 * Fails OPEN on a database error so a DB hiccup never loses a real customer's request.
 */
// deno-lint-ignore no-explicit-any
export async function rateLimitOk(db: any, req: Request, endpoint: string, max: number, windowSeconds: number): Promise<boolean> {
  try {
    const salt = Deno.env.get("WEBSITE_RATE_SALT") || Deno.env.get("SUPABASE_URL") || "fl";
    const ipHash = await hashIp(clientIp(req), salt);
    const { data, error } = await db.rpc("fl_website_rate_hit", {
      p_endpoint: endpoint, p_ip_hash: ipHash, p_max: max, p_window_seconds: windowSeconds,
    });
    if (error) { console.error(`[rate-limit] ${endpoint}:`, error.message); return true; }
    return data !== false;
  } catch (e) {
    console.error(`[rate-limit] ${endpoint}:`, e);
    return true;
  }
}
