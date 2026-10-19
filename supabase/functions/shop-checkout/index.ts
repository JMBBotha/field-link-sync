/**
 * shop-checkout (public POST) - 0800-BE-COOL online shop. 2026-10-19.
 *  { action: "quote", rooms }                       -> server-side price for the cart (sell prices only)
 *  { action: "checkout", rooms, contact, terms_version, preferred?, notes? }
 *     -> when checkout is OFF (default): { disabled: true, message: "Checkout coming soon, talk to Sam", contact }, nothing created
 *     -> when ON: creates a pending shop_order (expires after 24 h), a Yoco hosted checkout, returns { redirectUrl, order_ref }
 * Nothing is booked until Yoco confirms the payment (yoco-webhook -> fl_shop_finalize). Failed/abandoned payments create nothing.
 * Prices always come from the database; the browser never sends a price. CORS allow-list, honeypot, per-IP rate limits.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clientIp, corsFor, hashIp, honeypotTripped, isAllowedOrigin, isForeignBrowserOrigin, rateLimitOk } from "../_shared/websitePublic.ts";
import { SHOP_CONTACT, SHOP_TERMS_VERSION } from "../_shared/shopTerms.ts";
import { dbEnvironment, shopCheckoutEnabled } from "../_shared/shopPayments.ts";
import { getYocoConfig } from "../_shared/yoco.ts";

const MASSAIR_COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const DEFAULT_SITE = "https://www.0800becool.co.za";
const DISABLED_MESSAGE = "Checkout coming soon, talk to Sam";

const clip = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);

function cleanRooms(raw: unknown): Array<{ size: string; tier: string; label: string }> | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 8) return null;
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") return null;
    const o = r as Record<string, unknown>;
    out.push({ size: clip(o.size, 3).toUpperCase(), tier: clip(o.tier, 20).toLowerCase(), label: clip(o.label, 60) });
  }
  return out;
}

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN");
  if (!token || address.length < 5) return null;
  try {
    const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${token}&limit=1&country=za`);
    if (!res.ok) return null;
    const c = (await res.json())?.features?.[0]?.center;
    return Array.isArray(c) ? { lng: Number(c[0]), lat: Number(c[1]) } : null;
  } catch {
    return null;
  }
}

/** Return URLs must stay on the website: use the caller's allowed Origin, else the live domain. */
function siteBase(req: Request): string {
  const origin = req.headers.get("origin") || "";
  return origin && isAllowedOrigin(origin) ? origin.replace(/\/$/, "") : DEFAULT_SITE;
}

Deno.serve(async (req) => {
  const cors = corsFor(req, "POST, OPTIONS");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (isForeignBrowserOrigin(req)) return json({ error: "Origin not allowed" }, 403);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return json({ error: "Invalid JSON" }, 400);
  const action = clip(body.action, 20) || "quote";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const rooms = cleanRooms(body.rooms);
  if (!rooms) return json({ error: "Add between 1 and 8 rooms" }, 400);

  if (action === "quote") {
    if (!(await rateLimitOk(db, req, "shop-quote", 60, 600))) return json({ error: "Too many requests" }, 429);
    const { data, error } = await db.rpc("fl_shop_quote", { p_company: MASSAIR_COMPANY_ID, p_rooms: rooms, p_internal: false });
    if (error) return json({ error: error.code === "22023" ? error.message.replace(/^shop:\s*/, "") : "Prices are not available right now", contact: SHOP_CONTACT }, error.code === "22023" ? 400 : 503);
    return json({ ...data, payment: "full", checkout_enabled: shopCheckoutEnabled() });
  }

  if (action !== "checkout") return json({ error: "Unknown action" }, 400);

  // Bots that fill the hidden field get the same "coming soon" answer and nothing is stored.
  if (honeypotTripped(body)) return json({ disabled: true, message: DISABLED_MESSAGE, contact: SHOP_CONTACT });
  if (!(await rateLimitOk(db, req, "shop-checkout", 5, 600))) return json({ error: "Too many requests" }, 429);

  const c = (body.contact && typeof body.contact === "object" ? body.contact : {}) as Record<string, unknown>;
  const contact = { name: clip(c.name, 120), phone: clip(c.phone, 20), email: clip(c.email, 160).toLowerCase(), address: clip(c.address, 300) };
  if (!contact.name || contact.phone.replace(/\D/g, "").length < 9 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email) || contact.address.length < 5) {
    return json({ error: "Please add your name, phone number, email and the install address" }, 400);
  }
  if (clip(body.terms_version, 40) !== SHOP_TERMS_VERSION) return json({ error: "Please accept the terms to continue", terms_version: SHOP_TERMS_VERSION }, 400);

  // Live payments ship OFF. Nothing is created while the switch is off.
  if (!shopCheckoutEnabled()) return json({ disabled: true, message: DISABLED_MESSAGE, contact: SHOP_CONTACT });

  const cfg = getYocoConfig();
  const environment = dbEnvironment(cfg.environment);
  const geo = await geocode(contact.address);
  const pref = (body.preferred && typeof body.preferred === "object" ? body.preferred : {}) as Record<string, unknown>;
  const preferred = { date: clip(pref.date, 10) || null, time: clip(pref.time, 40) || null };

  const { data: order, error: orderErr } = await db.rpc("fl_shop_order_create", {
    p_company: MASSAIR_COMPANY_ID,
    p_rooms: rooms,
    p_contact: { ...contact, lat: geo?.lat ?? null, lng: geo?.lng ?? null },
    p_preferred: preferred,
    p_notes: clip(body.notes, 1000) || null,
    p_terms_version: SHOP_TERMS_VERSION,
    p_environment: environment,
    p_ip_hash: await hashIp(clientIp(req), Deno.env.get("WEBSITE_RATE_SALT") || Deno.env.get("SUPABASE_URL") || "fl"),
  });
  if (orderErr || !order?.id) {
    const userFacing = orderErr?.code === "22023";
    console.error("[shop-checkout] order create failed", orderErr?.code);
    return json({ error: userFacing ? orderErr!.message.replace(/^shop:\s*/, "") : "We couldn't start checkout. Please talk to Sam.", contact: SHOP_CONTACT }, userFacing ? 400 : 503);
  }

  const base = siteBase(req);
  const ref = encodeURIComponent(order.order_ref);
  const res = await fetch(`${cfg.baseUrl}/checkouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, "Content-Type": "application/json", "Idempotency-Key": `shop-${order.id}` },
    body: JSON.stringify({
      amount: Math.round(Number(order.total_incl) * 100),
      currency: "ZAR",
      successUrl: `${base}/shop/thank-you?ref=${ref}`,
      cancelUrl: `${base}/shop?cancelled=${ref}`,
      failureUrl: `${base}/shop?failed=${ref}`,
      metadata: { shop_order_id: order.id, order_ref: order.order_ref, environment: cfg.environment },
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result?.id || !result?.redirectUrl) {
    console.error("[shop-checkout] Yoco checkout failed", res.status);
    await db.rpc("fl_shop_order_note_event", { p_order: order.id, p_event: { stage: "create_checkout", status: res.status } });
    return json({ error: "The card payment page isn't available right now. Please talk to Sam.", contact: SHOP_CONTACT }, 502);
  }
  await db.rpc("fl_shop_order_set_checkout", { p_order: order.id, p_checkout_id: String(result.id) });

  return json({ redirectUrl: result.redirectUrl, order_ref: order.order_ref, total_incl: order.total_incl });
});
