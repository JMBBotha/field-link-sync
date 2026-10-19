/**
 * shop-prices (public GET) - 0800-BE-COOL online shop price list, computed live from the Massair CT catalogue
 * (shop_tier_map + fixed install prices). Returns sell prices only: no cost, markup or supplier fields ever.
 * CORS allow-list + 60 requests / 10 min per IP. 2026-10-19.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsFor, isForeignBrowserOrigin, rateLimitOk } from "../_shared/websitePublic.ts";
import { SHOP_CONTACT, SHOP_EXTRAS_LINE, SHOP_TERMS_HEADING, SHOP_TERMS_PARAGRAPHS, SHOP_TERMS_VERSION } from "../_shared/shopTerms.ts";
import { shopCheckoutEnabled } from "../_shared/shopPayments.ts";

const MASSAIR_COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";

Deno.serve(async (req) => {
  const cors = corsFor(req, "GET, OPTIONS");
  const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", ...extra } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (isForeignBrowserOrigin(req)) return json({ error: "Origin not allowed" }, 403);
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (!(await rateLimitOk(db, req, "shop-prices", 60, 600))) return json({ error: "Too many requests" }, 429);

  const { data, error } = await db.rpc("fl_shop_price_list", { p_company: MASSAIR_COMPANY_ID });
  if (error || !data) {
    console.error("[shop-prices]", error?.message);
    return json({ error: "Prices are not available right now", contact: SHOP_CONTACT }, 503);
  }
  return json({
    ...data,
    checkout_enabled: shopCheckoutEnabled(),
    payment: "full", // shop orders are paid in full online; phone/Sam quotes stay 70% deposit
    terms: { version: SHOP_TERMS_VERSION, heading: SHOP_TERMS_HEADING, paragraphs: SHOP_TERMS_PARAGRAPHS, extras_line: SHOP_EXTRAS_LINE },
    contact: SHOP_CONTACT,
    generated_at: new Date().toISOString(),
  }, 200, { "Cache-Control": "public, max-age=120" });
});
