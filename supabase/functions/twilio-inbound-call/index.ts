import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * twilio-inbound-call
 *
 * Twilio Voice webhook — POST application/x-www-form-urlencoded with:
 *   From, To, CallSid, Direction, CallerName (optional), CallStatus
 *
 * Pipeline:
 *  1. Normalize the caller phone to SA E.164 (+27…).
 *  2. Deduplicate by CallSid (any lead already tagged with this CallSid → skip).
 *  3. Deduplicate by phone within the last 10 minutes → skip.
 *  4. Find existing customer (multi-format phone: +27…, 27…, 0…), else by
 *     CallerName if provided, else create a new customer.
 *  5. Insert lead (status='pending', notes tagged 'Source: phone_call | CallSid: … | Caller: …').
 *  6. ALWAYS return TwiML 200 so Twilio never drops the call.
 *
 * TODO: geocode customer address (once captured via WhatsApp reply / Indy AI)
 *       and backfill lead.latitude / lead.longitude so the map view shows a
 *       real pin instead of (0,0).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TWIML_HEADERS = { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" };

const TWIML_OK = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling zero eight hundred be cool. Please hold while we connect you.</Say>
</Response>`;

const TWIML_FALLBACK = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling. Please hold.</Say>
</Response>`;

function normalizePhoneSA(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) digits = "27" + digits.slice(1);
  else if (!digits.startsWith("27") && digits.length === 9) digits = "27" + digits;
  return "+" + digits;
}

/** All plausible stored formats for the same SA number. */
function phoneVariants(e164: string): string[] {
  if (!e164) return [];
  const digits = e164.replace(/\D/g, ""); // "27…"
  const local  = digits.startsWith("27") ? "0" + digits.slice(2) : digits;
  return Array.from(new Set([e164, digits, local, "+" + digits]));
}

async function parseBody(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try { return await req.json(); } catch { return {}; }
  }
  const text = await req.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  params.forEach((v, k) => { out[k] = v; });
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
  }

  try {
    const body = await parseBody(req);
    console.log("[twilio-inbound-call] ▶ Incoming:", JSON.stringify(body));

    const rawPhone   = body.From || body.from || body.Caller || "";
    const callSid    = body.CallSid || body.call_sid || "";
    const toNumber   = body.To || body.to || "";
    const direction  = body.Direction || body.direction || "inbound";
    const callerName = (body.CallerName || body.caller_name || body.name || "").trim();
    const callStatus = body.CallStatus || "ringing";

    if (!rawPhone) {
      console.warn("[twilio-inbound-call] ✗ No From field — returning TwiML");
      return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
    }

    const phone = normalizePhoneSA(rawPhone);
    const variants = phoneVariants(phone);
    console.log(`[twilio-inbound-call] ✓ Phone normalized: ${rawPhone} → ${phone} (variants: ${variants.join(", ")})`);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    // ── Resolve company_id from admin_settings ─────────────────────
    let companyId: string | null = null;
    const { data: setting } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "default_company_id")
      .maybeSingle();
    if (setting?.setting_value) {
      const v = setting.setting_value as any;
      companyId = typeof v === "string" ? v : v?.value || v?.company_id || null;
    }

    // ── Dedup #1: CallSid already logged ───────────────────────────
    if (callSid) {
      const { data: sidHit } = await supabase
        .from("leads")
        .select("id")
        .ilike("notes", `%CallSid: ${callSid}%`)
        .limit(1)
        .maybeSingle();
      if (sidHit) {
        console.log(`[twilio-inbound-call] ⊘ Dedup CallSid=${callSid} → existing lead ${sidHit.id}, skipping insert`);
        return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
      }
    }

    // ── Dedup #2: same phone in the last 10 minutes ────────────────
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentHit } = await supabase
      .from("leads")
      .select("id, created_at")
      .in("customer_phone", variants)
      .gte("created_at", tenMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentHit) {
      console.log(`[twilio-inbound-call] ⊘ Dedup rapid-repeat → existing lead ${recentHit.id} at ${recentHit.created_at}, skipping insert`);
      return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
    }

    // ── Find customer (phone variants → then name fallback) ────────
    let customerId: string | null = null;
    let matchedName: string | null = null;

    const { data: byPhone } = await supabase
      .from("customers")
      .select("id, name, first_name, last_name, company_id, phone")
      .in("phone", variants)
      .limit(1)
      .maybeSingle();

    if (byPhone) {
      customerId  = byPhone.id;
      matchedName = byPhone.name ||
        `${byPhone.first_name || ""} ${byPhone.last_name || ""}`.trim() || null;
      if (!companyId && byPhone.company_id) companyId = byPhone.company_id;
      console.log(`[twilio-inbound-call] ✓ Customer matched by phone: ${matchedName} (${customerId})`);
    } else if (callerName) {
      const { data: byName } = await supabase
        .from("customers")
        .select("id, name, company_id")
        .ilike("name", callerName)
        .limit(1)
        .maybeSingle();
      if (byName) {
        customerId  = byName.id;
        matchedName = byName.name;
        if (!companyId && byName.company_id) companyId = byName.company_id;
        console.log(`[twilio-inbound-call] ✓ Customer matched by name: ${matchedName} (${customerId})`);
      }
    }

    // Fallback company: first company in DB
    if (!companyId) {
      const { data: firstCompany } = await supabase
        .from("companies")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstCompany) companyId = firstCompany.id;
    }
    console.log(`[twilio-inbound-call] ✓ company_id=${companyId}`);

    // ── Create customer if none found ──────────────────────────────
    if (!customerId) {
      const displayName = callerName || "Unknown Caller";
      const firstName   = displayName.split(" ")[0] || "Unknown";
      const lastName    = displayName.split(" ").slice(1).join(" ") || "";
      const { data: newCust, error: custErr } = await supabase
        .from("customers")
        .insert({
          name: displayName,
          first_name: firstName,
          last_name: lastName,
          phone,
          address: "",
          status: "lead",
          company_id: companyId,
        })
        .select("id")
        .single();
      if (custErr) {
        console.error("[twilio-inbound-call] ✗ Customer insert failed:", custErr);
      } else {
        customerId  = newCust.id;
        matchedName = displayName;
        console.log(`[twilio-inbound-call] ✓ Customer created: ${displayName} (${customerId})`);
      }
    }

    // ── Insert lead ────────────────────────────────────────────────
    // TODO: geocode `customers.address` (once captured) and backfill
    //       leads.latitude / leads.longitude so map pins are accurate.
    const noteHeader = `Source: phone_call | CallSid: ${callSid || "unknown"} | Caller: ${phone}`;
    const notes = [
      noteHeader,
      `Incoming call via Twilio`,
      toNumber ? `Called: ${toNumber}` : "",
      `Direction: ${direction}`,
      `Call status: ${callStatus}`,
      matchedName ? "⭐ Returning customer" : "🆕 New caller",
    ].filter(Boolean).join("\n");

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        customer_id: customerId,
        customer_name: matchedName || callerName || "Unknown Caller",
        customer_phone: phone,
        customer_address: "Address pending — inbound call",
        service_type: "General Inquiry",
        status: "pending", // schema CHECK forbids 'new'
        priority: "medium",
        notes,
        latitude: 0,   // TODO: geocode from customer.address
        longitude: 0,  // TODO: geocode from customer.address
        company_id: companyId,
      })
      .select("id")
      .single();

    if (leadErr) {
      console.error("[twilio-inbound-call] ✗ Lead insert failed:", leadErr);
    } else {
      console.log(`[twilio-inbound-call] ✓ Lead ${lead.id} created for ${phone} (CallSid=${callSid})`);
    }

    return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
  } catch (err: any) {
    console.error("[twilio-inbound-call] ✗ Unhandled error:", err);
    // Always return TwiML 200 so Twilio doesn't drop the call
    return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
  }
});
