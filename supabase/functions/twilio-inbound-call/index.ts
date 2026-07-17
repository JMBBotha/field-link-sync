import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * twilio-inbound-call
 *
 * Twilio Voice webhook. Twilio POSTs application/x-www-form-urlencoded with:
 *   From, To, CallSid, Direction, CallerName (optional), CallStatus
 *
 * We:
 *  1. Normalize the caller phone to SA E.164 (+27...)
 *  2. Find or create a customer row for that phone
 *  3. Insert a lead (status='pending', notes tagged with CallSid + Source:phone_call)
 *  4. Return TwiML so Twilio plays a greeting while Indy AI is bridged in
 *
 * SCHEMA NOTES (deviations from the original spec):
 *   - leads.status CHECK constraint rejects 'new'. We use 'pending'.
 *   - leads has no `source` column; we embed "Source: phone_call" in notes.
 *   - admin_settings is a key/value store. We look up a row with
 *     setting_key='default_company_id' first, else use the matched
 *     customer's company, else the first company in the DB.
 *
 * Auth: none (Twilio Studio cannot easily send custom headers). The endpoint
 * only writes a lead row, no secrets are exposed. Add Twilio signature
 * validation later if desired (requires TWILIO_AUTH_TOKEN).
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
    console.log("[twilio-inbound-call] Incoming:", JSON.stringify(body));

    const rawPhone = body.From || body.from || body.Caller || "";
    const callSid  = body.CallSid || body.call_sid || "";
    const toNumber = body.To || body.to || "";
    const direction = body.Direction || body.direction || "inbound";
    const callerName = body.CallerName || body.caller_name || body.name || "Unknown Caller";
    const callStatus = body.CallStatus || "ringing";

    if (!rawPhone) {
      console.warn("[twilio-inbound-call] No From field");
      return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
    }

    const phone = normalizePhoneSA(rawPhone);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase    = createClient(supabaseUrl, serviceKey);

    // ── Resolve company_id ─────────────────────────────────────────
    let companyId: string | null = null;

    // 1. admin_settings key/value lookup
    const { data: setting } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", "default_company_id")
      .maybeSingle();
    if (setting?.setting_value) {
      const v = setting.setting_value as any;
      companyId = typeof v === "string" ? v : v?.value || v?.company_id || null;
    }

    // ── Find or create the customer ────────────────────────────────
    let customerId: string | null = null;
    let matchedName: string | null = null;

    const { data: existing } = await supabase
      .from("customers")
      .select("id, name, first_name, last_name, company_id")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (existing) {
      customerId = existing.id;
      matchedName = existing.name ||
        `${existing.first_name || ""} ${existing.last_name || ""}`.trim() || null;
      if (!companyId && existing.company_id) companyId = existing.company_id;
    }

    // 2. Fallback: first company
    if (!companyId) {
      const { data: firstCompany } = await supabase
        .from("companies")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (firstCompany) companyId = firstCompany.id;
    }

    if (!customerId) {
      const firstName = callerName.split(" ")[0] || "Unknown";
      const lastName  = callerName.split(" ").slice(1).join(" ") || "";
      const { data: newCust, error: custErr } = await supabase
        .from("customers")
        .insert({
          name: callerName,
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
        console.error("[twilio-inbound-call] customer insert failed:", custErr);
      } else {
        customerId = newCust.id;
      }
    }

    // ── Insert lead ────────────────────────────────────────────────
    // NOTE: status='new' rejected by CHECK constraint; using 'pending'.
    // NOTE: no `source` column on leads; embedding "Source: phone_call" in notes.
    const notes = [
      `Source: phone_call`,
      `Incoming call via Twilio - CallSid: ${callSid || "unknown"}`,
      toNumber ? `Called: ${toNumber}` : "",
      `Direction: ${direction}`,
      `Call status: ${callStatus}`,
      matchedName ? "⭐ Returning customer" : "🆕 New caller",
    ].filter(Boolean).join("\n");

    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        customer_id: customerId,
        customer_name: matchedName || callerName,
        customer_phone: phone,
        customer_address: "Address pending — inbound call",
        service_type: "General Inquiry",
        status: "pending",
        priority: "medium",
        notes,
        latitude: 0,
        longitude: 0,
        company_id: companyId,
      })
      .select("id")
      .single();

    if (leadErr) {
      console.error("[twilio-inbound-call] lead insert failed:", leadErr);
    } else {
      console.log(`[twilio-inbound-call] Lead ${lead.id} created for ${phone} (CallSid=${callSid})`);
    }

    return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
  } catch (err: any) {
    console.error("[twilio-inbound-call] Unhandled error:", err);
    // Always return TwiML 200 so the call doesn't drop
    return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
  }
});
