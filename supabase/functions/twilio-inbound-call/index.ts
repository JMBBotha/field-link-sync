import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * twilio-inbound-call
 *
 * Public webhook that Twilio (Studio Flow "Make HTTP Request" widget, or a
 * Voice webhook) can POST to when a call comes in. It creates a lead with
 * status='pending' so the call shows up in the dispatch queue immediately,
 * before Indy AI has finished the conversation.
 *
 * Accepts:
 *   - application/x-www-form-urlencoded  (classic Twilio voice webhook)
 *   - application/json                   (Studio "Make HTTP Request" widget)
 *
 * Recognised fields (all optional except caller phone):
 *   From / caller_phone / phone_number   -> caller's phone (E.164)
 *   To   / called                        -> the business number that was dialled
 *   CallSid / call_sid                   -> Twilio call SID (stored in notes)
 *   CallerName / caller_name / name      -> caller's name if the flow captured it
 *   CallStatus / call_status             -> Twilio call status
 *   service_type                         -> free-text if the flow classified it
 *   notes                                -> free-text summary if provided
 *
 * Returns 200 + JSON on success. Always returns 200 so Twilio does not retry
 * and hang up the call. Errors are logged.
 *
 * NO x-api-key header required — Twilio Studio cannot easily add custom
 * headers. Protection here is: verify_jwt=false in config.toml, but the
 * endpoint only writes a lead row (no secrets returned).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(phone: string): string {
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
  // form-urlencoded (Twilio default) or multipart
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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await parseBody(req);
    console.log("[twilio-inbound-call] Incoming:", JSON.stringify(body));

    const rawPhone =
      body.From || body.from ||
      body.caller_phone || body.phone_number || body.Caller || "";

    if (!rawPhone) {
      console.warn("[twilio-inbound-call] No caller phone in webhook");
      return new Response(JSON.stringify({ ok: false, error: "no caller phone" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(rawPhone);
    const callerName =
      body.CallerName || body.caller_name || body.name || "Unknown Caller";
    const callSid = body.CallSid || body.call_sid || "";
    const calledNumber = body.To || body.called || "";
    const callStatus = body.CallStatus || body.call_status || "ringing";
    const serviceType = body.service_type || "General Inquiry";
    const extraNotes = body.notes || body.transcript || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Resolve company_id — inherit from an existing customer match, else first company
    let resolvedCompanyId: string | null = null;
    let customerId: string | null = null;
    let matchedCustomerName: string | null = null;

    try {
      const { data: matches } = await supabase.rpc("check_customer_duplicates", {
        p_phone: normalizedPhone,
      });
      if (matches && matches.length > 0 && matches[0].match_score >= 0.8) {
        customerId = matches[0].id;
        matchedCustomerName =
          `${matches[0].first_name || ""} ${matches[0].last_name || ""}`.trim() || null;
        const { data: cust } = await supabase
          .from("customers")
          .select("company_id")
          .eq("id", customerId)
          .single();
        if (cust?.company_id) resolvedCompanyId = cust.company_id;
      }
    } catch (e) {
      console.warn("[twilio-inbound-call] duplicate check failed:", e);
    }

    if (!resolvedCompanyId) {
      const { data: firstCompany } = await supabase
        .from("companies")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (firstCompany) resolvedCompanyId = firstCompany.id;
    }

    // Create customer if we didn't match one
    if (!customerId) {
      const firstName = callerName.split(" ")[0] || "Unknown";
      const lastName = callerName.split(" ").slice(1).join(" ") || "";
      const { data: newCustomer, error: custErr } = await supabase
        .from("customers")
        .insert({
          name: callerName,
          first_name: firstName,
          last_name: lastName,
          phone: normalizedPhone,
          address: "",
          status: "lead",
          company_id: resolvedCompanyId,
        })
        .select("id")
        .single();
      if (custErr) {
        console.error("[twilio-inbound-call] customer insert error:", custErr);
      } else {
        customerId = newCustomer.id;
      }
    }

    const displayName = matchedCustomerName || callerName;

    const notesLines = [
      `Source: twilio_inbound`,
      callSid ? `Twilio CallSid: ${callSid}` : "",
      calledNumber ? `Called: ${calledNumber}` : "",
      `Call status: ${callStatus}`,
      matchedCustomerName ? "⭐ Returning customer" : "🆕 New caller",
      extraNotes ? `\n${extraNotes}` : "",
    ].filter(Boolean);

    // NOTE: leads.status CHECK constraint only allows:
    // pending / accepted / in_progress / completed / cancelled / converted / qualified / won
    // "new" would be rejected — we use "pending".
    const { data: newLead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        customer_id: customerId,
        customer_name: displayName,
        customer_phone: normalizedPhone,
        customer_address: "Address pending — inbound call",
        service_type: serviceType,
        status: "pending",
        priority: "medium",
        notes: notesLines.join("\n"),
        latitude: 0,
        longitude: 0,
        company_id: resolvedCompanyId,
      })
      .select("id")
      .single();

    if (leadErr) {
      console.error("[twilio-inbound-call] lead insert error:", leadErr);
      return new Response(JSON.stringify({
        ok: false,
        error: "lead insert failed",
        detail: leadErr.message,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[twilio-inbound-call] Lead ${newLead.id} created for ${displayName} (${normalizedPhone})`);

    return new Response(JSON.stringify({
      ok: true,
      lead_id: newLead.id,
      customer_id: customerId,
      customer_name: displayName,
      phone: normalizedPhone,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[twilio-inbound-call] Unhandled error:", err);
    // Always 200 so Twilio does not retry / drop the call
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
