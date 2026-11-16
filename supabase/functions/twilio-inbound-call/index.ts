import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

/**
 * twilio-inbound-call
 *
 * Twilio Voice webhook — POST application/x-www-form-urlencoded with:
 *   From, To, CallSid, Direction, CallerName (optional), CallStatus
 *
 * Answers the call and returns TwiML. It does not create a lead or a customer.
 * A hang-up is not a lead: the end-of-call report reads the duration and the
 * captured name, then either creates the lead or files one admin follow-up.
 *
 * ALWAYS return TwiML 200 so Twilio never drops the call.
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
    const rawPhone = body.From || body.from || body.Caller || "";
    const callSid = body.CallSid || body.call_sid || "";
    if (!rawPhone) {
      console.warn("[twilio-inbound-call] No From field — returning TwiML");
      return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
    }
    const phone = normalizePhoneSA(rawPhone);
    console.log(`[twilio-inbound-call] Answered ${phone} CallSid=${callSid || "unknown"}. Lead is decided when the call ends.`);
    return new Response(TWIML_OK, { status: 200, headers: TWIML_HEADERS });
  } catch (err: any) {
    console.error("[twilio-inbound-call] Unhandled error:", err);
    return new Response(TWIML_FALLBACK, { status: 200, headers: TWIML_HEADERS });
  }
});
