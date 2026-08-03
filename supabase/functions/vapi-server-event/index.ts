import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * vapi-server-event v2.0
 *
 * THE SINGLE ENTRY POINT for all Vapi events. This replaces Lindy entirely.
 *
 * Handles:
 * 1. tool-calls → forwards lookup_caller to the lookup-caller function
 * 2. end-of-call-report → creates lead in FieldLink Sync + sends WhatsApp confirmation
 * 3. All other events → acknowledged with 200 OK
 *
 * Flow:
 *   Call comes in → Vapi answers (Mandy/Claude) → captures details
 *   → Call ends → Vapi sends end-of-call-report HERE
 *   → We create customer + lead → send WhatsApp confirmation → done
 *
 * No more Lindy. No more notification queue auth issues.
 * Direct Twilio WhatsApp send from this server function.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// ─── Helpers ───────────────────────────────────────────────

function normalizePhone(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "27" + digits.slice(1);
  } else if (!digits.startsWith("27") && digits.length === 9) {
    digits = "27" + digits;
  }
  return "+" + digits;
}

function looksLikeCallerPhone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 || digits.length === 10 ||
    (digits.startsWith("27") && digits.length === 11);
}

function extractCallerNumber(body: any): string {
  const message = body?.message || {};
  const call = message?.call || body?.call || {};
  const explicitCandidates = [
    call?.customer?.number,
    call?.customer?.phoneNumber,
    call?.customer?.phone,
    message?.customer?.number,
    message?.customer?.phoneNumber,
    body?.customer?.number,
    call?.from,
    message?.from,
    body?.from,
  ];

  const explicit = explicitCandidates.find(looksLikeCallerPhone);
  if (explicit) return normalizePhone(explicit);

  // Vapi payload shapes can vary between assistant/tool versions. Search only
  // caller-oriented keys as a final fallback, avoiding `phoneNumber.number`,
  // which is normally the business/Vapi line rather than the caller.
  const callerKeys = new Set(["customer", "caller", "from"]);
  const visit = (value: unknown, path: string[] = []): string => {
    if (looksLikeCallerPhone(value) && path.some((part) => callerKeys.has(part.toLowerCase()))) {
      return normalizePhone(value);
    }
    if (!value || typeof value !== "object") return "";
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const found = visit(child, [...path, key]);
      if (found) return found;
    }
    return "";
  };

  return visit(body);
}

function mapPriority(urgency?: string): string {
  switch (urgency?.toLowerCase()) {
    case "emergency": return "high";
    case "urgent": return "high";
    default: return "medium";
  }
}

function detectServiceType(transcript: string): string {
  const lower = transcript.toLowerCase();
  // Three canonical categories: New Quote / Technical Service Call / New Installation
  if (lower.includes("quote") || lower.includes("price") || lower.includes("pricing") || lower.includes("how much") || lower.includes("cost") || lower.includes("estimate")) return "New Quote";
  if (lower.includes("quote accepted") || lower.includes("accepted the quote") || lower.includes("book the installation") || lower.includes("schedule the installation")) return "New Installation";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken") || lower.includes("not working") || lower.includes("not cooling") || lower.includes("service") || lower.includes("maintain") || lower.includes("clean")) return "Technical Service Call";
  if (lower.includes("install") || lower.includes("new aircon") || lower.includes("new air con") || lower.includes("new unit")) return "New Quote";
  return "General Inquiry";
}

function detectUrgency(transcript: string): string {
  const lower = transcript.toLowerCase();
  if (lower.includes("emergency") || lower.includes("urgent") || lower.includes("immediately") || lower.includes("asap")) return "emergency";
  if (lower.includes("urgent") || lower.includes("soon") || lower.includes("today")) return "urgent";
  return "normal";
}

// Extract caller info from Vapi's structured analysis or transcript
function extractCallerInfo(messages: any[], analysis?: any): {
  name: string | null;
  address: string | null;
  phone_spoken: string | null;
} {
  let name: string | null = null;
  let address: string | null = null;
  let phone_spoken: string | null = null;

  // Try structured analysis first (from Claude's tool use / structured data)
  if (analysis?.structuredData) {
    const sd = analysis.structuredData;
    name = sd.caller_name || sd.name || null;
    address = sd.address || sd.caller_address || null;
  }

  // Fallback: extract from messages
  for (const msg of messages) {
    if (msg.role === "user") {
      const text = msg.message || msg.content || "";

      // Name patterns
      if (!name) {
        const nameMatch = text.match(/(?:my name is|i'm|i am|this is|it's|naam is)\s+([A-Z][a-z]+(?:\s+(?:van\s+)?[A-Z][a-z]+)?)/i);
        if (nameMatch) name = nameMatch[1].trim();
      }

      // Address patterns (SA-style: number + street, or suburb mentions)
      if (!address) {
        const addressMatch = text.match(/(\d+\s+[A-Za-z]+\s+(?:street|road|drive|avenue|lane|crescent|close|way|straat|weg|laan)(?:,?\s+[A-Za-z\s]+)?)/i);
        if (addressMatch) address = addressMatch[1].trim();

        // Also check for suburb mentions
        const suburbMatch = text.match(/(?:in|at|from|near)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s|,|$)/);
        if (!address && suburbMatch) address = suburbMatch[1].trim();
      }

      // Phone number patterns
      if (!phone_spoken) {
        const phoneMatch = text.match(/(\+?(?:27|0)\s*\d[\d\s-]{7,12})/);
        if (phoneMatch) phone_spoken = phoneMatch[1].replace(/[\s-]/g, "");
      }
    }
  }

  return { name, address, phone_spoken };
}

function isValidLead(durationSeconds: number, messages: any[], transcript: string): boolean {
  const userMessages = messages.filter((m: any) => m.role === "user");
  // A real conversation is the strongest signal — accept it even when Vapi
  // reports no/unknown duration (startedAt is sometimes missing on the report).
  if (userMessages.length >= 1) return true;
  // Some Vapi end-of-call payloads contain the full transcript but omit the
  // artifact.messages array. A non-empty transcript is still a real call.
  if (transcript.trim().length > 0) return true;
  return durationSeconds >= 15;
}

// ─── WhatsApp via Twilio ───────────────────────────────────

async function sendWhatsAppConfirmation(
  phone: string,
  customerName: string,
  serviceType: string,
  leadId: string,
): Promise<{ success: boolean; error?: string }> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioWhatsApp = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioWhatsApp) {
    console.warn("[vapi-server-event] Twilio not configured — skipping WhatsApp");
    return { success: false, error: "Twilio credentials not configured" };
  }

  const firstName = customerName.split(" ")[0] || "there";
  const normalizedPhone = phone.replace(/\D/g, "");

  // Message body — friendly, asks for address confirmation
  const body = [
    `Hi ${firstName}! 👋 Thanks for calling 0800BeCool.`,
    ``,
    `We've received your ${serviceType.toLowerCase()} request and a technician will be assigned shortly.`,
    ``,
    `Could you please confirm your address so we can get someone to you as quickly as possible?`,
    `Just reply with your street address and suburb. 🏠`,
    ``,
    `Ref: #${leadId.slice(0, 8)}`,
  ].join("\n");

  try {
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const response = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        From: `whatsapp:${twilioWhatsApp}`,
        To: `whatsapp:+${normalizedPhone}`,
        Body: body,
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`[vapi-server-event] WhatsApp sent to +${normalizedPhone}, SID: ${result.sid}`);
      return { success: true };
    } else {
      console.error(`[vapi-server-event] WhatsApp failed:`, result.message);
      return { success: false, error: result.message || `HTTP ${response.status}` };
    }
  } catch (err: any) {
    console.error(`[vapi-server-event] WhatsApp exception:`, err);
    return { success: false, error: err.message };
  }
}

// ─── Call categorisation ───────────────────────────────────
export function categoriseCall(summary: string | null, transcript: string | null): string {
  const text = `${summary || ""} ${transcript || ""}`.toLowerCase();
  if (/(quote|quotation|estimate|pricing|price for|new unit|new install|installation|replace the unit)/.test(text))
    return "Quote Request";
  if (/(repair|service call|not cooling|leaking|leak|maintenance|fault|broken|breakdown|servicing)/.test(text))
    return "Service Request";
  if (/(order|delivery|spare part|parts|stock|invoice|payment|account balance)/.test(text))
    return "Order Update";
  return "General Inquiry";
}

const ESTIMATE_TRIGGER = /(quote|quotation|estimate|pricing|price for|new unit|new install|installation|new service|replace the unit)/i;

// Notify every admin/dispatcher of the company that a call was logged.
async function notifyCallLogged(admin: any, params: {
  companyId: string | null;
  callId: string | null;
  callerName: string | null;
  callerPhone: string | null;
  isExistingClient: boolean;
  category: string;
  summary: string | null;
  durationSeconds: number;
}) {
  try {
    let userIds: string[] = [];
    if (params.companyId) {
      const { data: staff } = await admin
        .from("profiles")
        .select("id")
        .eq("company_id", params.companyId);
      const ids = (staff || []).map((s: any) => s.id);
      if (ids.length) {
        const { data: roles } = await admin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", ids);
        userIds = (roles || [])
          .filter((r: any) => ["admin", "dispatcher"].includes(r.role))
          .map((r: any) => r.user_id);
        if (!userIds.length) userIds = ids.slice(0, 5);
      }
    }
    if (!userIds.length) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(10);
      userIds = (roles || []).map((r: any) => r.user_id);
    }
    if (!userIds.length) {
      console.warn("[vapi-server-event] No recipients for call notification");
      return;
    }

    const who = params.callerName || params.callerPhone || "Unknown caller";
    const tag = params.isExistingClient ? "Existing client" : "New lead";
    const rows = [...new Set(userIds)].map((uid) => ({
      user_id: uid,
      type: "call_logged",
      title: `Call Logged — ${params.category}`,
      body: `${who} (${params.callerPhone || "no number"}) · ${tag} · ${Math.round(params.durationSeconds)}s${params.summary ? ` — ${params.summary.slice(0, 180)}` : ""}`,
      read: false,
      related_id: params.callId,
      metadata: {
        call_id: params.callId,
        caller_name: params.callerName,
        caller_phone: params.callerPhone,
        category: params.category,
        is_existing_client: params.isExistingClient,
      },
    }));
    const { error } = await admin.from("notifications").insert(rows);
    if (error) console.error("[vapi-server-event] call_logged notification error:", error);
  } catch (err) {
    console.error("[vapi-server-event] notifyCallLogged exception:", err);
  }
}

// Auto-create a basic draft estimate when the call asked for a quote/new work.
async function createDraftEstimate(admin: any, params: {
  companyId: string | null;
  customerId: string | null;
  customerName: string | null;
  leadId: string | null;
  summary: string | null;
  serviceType: string | null;
}): Promise<{ quoteId: string | null; reason: string | null }> {
  try {
    if (!params.customerId) {
      return { quoteId: null, reason: "No customer record could be matched or created for this caller" };
    }
    let salesEngineerId: string | null = null;
    if (params.companyId) {
      const { data: staff } = await admin
        .from("profiles")
        .select("id")
        .eq("company_id", params.companyId)
        .limit(20);
      const ids = (staff || []).map((s: any) => s.id);
      if (ids.length) {
        const { data: roles } = await admin
          .from("user_roles")
          .select("user_id, role")
          .in("user_id", ids);
        salesEngineerId =
          (roles || []).find((r: any) => r.role === "admin")?.user_id ||
          (roles || [])[0]?.user_id ||
          ids[0];
      }
    }
    if (!salesEngineerId) {
      const { data: roles } = await admin
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin")
        .limit(1);
      salesEngineerId = roles?.[0]?.user_id ?? null;
    }
    if (!salesEngineerId) {
      return { quoteId: null, reason: "No admin user available to own the draft estimate" };
    }

    const { data, error } = await admin
      .from("quotes")
      .insert({
        company_id: params.companyId,
        customer_id: params.customerId,
        customer_name: params.customerName,
        lead_id: params.leadId,
        sales_engineer_id: salesEngineerId,
        status: "draft",
        subtotal: 0,
        vat_amount: 0,
        total: 0,
        reference_text: params.serviceType ? `Phone enquiry — ${params.serviceType}` : "Phone enquiry",
        notes: [
          "Draft created automatically from an inbound call.",
          params.summary || "",
        ].filter(Boolean).join("\n"),
      })
      .select("id")
      .single();

    if (error) return { quoteId: null, reason: `Estimate insert failed: ${error.message}` };
    return { quoteId: data.id, reason: null };
  } catch (err: any) {
    return { quoteId: null, reason: `Estimate creation exception: ${err?.message || String(err)}` };
  }
}

// ─── Call log ──────────────────────────────────────────────
// Persists every Vapi call and links it to the matched customer + lead so the
// admin panel can show call history and appointment outcomes per client.
// Also: verifies the linked lead really exists (no false badges), auto-creates
// a draft estimate for quote-type calls, and notifies staff for EVERY call.
async function recordCall(input: {
  providerCallId: string;
  callerPhone: string;
  callerName: string | null;
  businessPhone: string | null;
  leadId: string | null;
  customerId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  endedReason: string | null;
  serviceType: string | null;
  urgency: string | null;
  summary: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  outcome: string;
}) {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    let customerId = input.customerId;
    let companyId: string | null = null;
    let leadId = input.leadId;
    let outcome = input.outcome;
    let errorReason: string | null = null;

    // Verify the lead actually exists — a missing record must never produce a badge.
    if (leadId) {
      const { data: leadRow } = await admin
        .from("leads")
        .select("id, customer_id, company_id")
        .eq("id", leadId)
        .maybeSingle();
      if (!leadRow) {
        console.warn(`[vapi-server-event] Lead ${leadId} not found — dropping link`);
        errorReason = `Lead ${leadId} was not found in the database`;
        leadId = null;
        if (outcome === "lead_created" || outcome === "lead_enriched") outcome = "lead_failed";
      } else {
        customerId = customerId || leadRow.customer_id;
        companyId = leadRow.company_id ?? null;
      }
    }

    if (!customerId && input.callerPhone) {
      const tail = input.callerPhone.replace(/\D/g, "").slice(-9);
      const { data: cust } = await admin
        .from("customers")
        .select("id, company_id")
        .ilike("phone", `%${tail}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cust) {
        customerId = cust.id;
        companyId = companyId || cust.company_id;
      }
    }

    let customerName: string | null = input.callerName;
    let isExistingClient = false;
    if (customerId) {
      const { data: cust } = await admin
        .from("customers")
        .select("id, name, company_id, created_at")
        .eq("id", customerId)
        .maybeSingle();
      if (!cust) {
        // Stale reference — do not link it.
        customerId = null;
      } else {
        companyId = companyId || cust.company_id;
        customerName = cust.name || customerName;
        // Treat as existing client when the record predates this call.
        const createdMs = cust.created_at ? new Date(cust.created_at).getTime() : Date.now();
        isExistingClient = Date.now() - createdMs > 5 * 60 * 1000;
      }
    }

    const category = categoriseCall(input.summary, input.transcript);

    // Auto-create a draft estimate for quote / new-work calls.
    let quoteId: string | null = null;
    const wantsEstimate =
      category === "Quote Request" ||
      ESTIMATE_TRIGGER.test(`${input.summary || ""} ${input.transcript || ""} ${input.serviceType || ""}`);

    if (wantsEstimate) {
      // Don't duplicate a draft for the same call on webhook retries.
      const { data: existingCall } = input.providerCallId
        ? await admin
            .from("vapi_calls")
            .select("quote_id")
            .eq("provider_call_id", input.providerCallId)
            .maybeSingle()
        : { data: null as any };

      if (existingCall?.quote_id) {
        quoteId = existingCall.quote_id;
      } else {
        const res = await createDraftEstimate(admin, {
          companyId,
          customerId,
          customerName,
          leadId,
          summary: input.summary,
          serviceType: input.serviceType,
        });
        quoteId = res.quoteId;
        if (res.reason) {
          errorReason = [errorReason, res.reason].filter(Boolean).join(" | ");
          console.error("[vapi-server-event] Draft estimate not created:", res.reason);
        } else {
          console.log(`[vapi-server-event] Draft estimate ${quoteId} created from call`);
        }
      }
    }

    const row = {
      provider: "vapi",
      provider_call_id: input.providerCallId || null,
      direction: "inbound",
      company_id: companyId,
      customer_id: customerId,
      lead_id: leadId,
      caller_phone: input.callerPhone || null,
      caller_name: input.callerName,
      business_phone: input.businessPhone,
      started_at: input.startedAt,
      ended_at: input.endedAt,
      // Vapi sends fractional seconds (e.g. 87.439) — the column is an integer,
      // and a float here fails the whole insert (22P02) and loses the call log.
      duration_seconds: Math.max(0, Math.round(Number(input.durationSeconds) || 0)),
      ended_reason: input.endedReason,
      service_type: input.serviceType,
      urgency: input.urgency,
      summary: input.summary,
      transcript: input.transcript,
      recording_url: input.recordingUrl,
      outcome,
      call_category: category,
      is_existing_client: isExistingClient,
      quote_id: quoteId,
      error_reason: errorReason,
    };

    let savedId: string | null = null;
    const { data: saved, error } = input.providerCallId
      ? await admin.from("vapi_calls").upsert(row, { onConflict: "provider_call_id" }).select("id").maybeSingle()
      : await admin.from("vapi_calls").insert(row).select("id").maybeSingle();

    if (error) {
      console.error("[vapi-server-event] vapi_calls write error:", error);
      // Never lose a call: retry with a minimal, always-valid row so the
      // customer's call history is complete even if one column is rejected.
      const minimal = {
        provider: "vapi",
        provider_call_id: row.provider_call_id,
        direction: "inbound",
        company_id: companyId,
        customer_id: customerId,
        lead_id: leadId,
        caller_phone: row.caller_phone,
        caller_name: row.caller_name,
        duration_seconds: row.duration_seconds,
        summary: row.summary,
        recording_url: row.recording_url,
        outcome,
        call_category: category,
        is_existing_client: isExistingClient,
      };
      const { data: retrySaved, error: retryError } = row.provider_call_id
        ? await admin.from("vapi_calls").upsert(minimal, { onConflict: "provider_call_id" }).select("id").maybeSingle()
        : await admin.from("vapi_calls").insert(minimal).select("id").maybeSingle();
      if (retryError) console.error("[vapi-server-event] vapi_calls fallback write failed:", retryError);
      else {
        savedId = retrySaved?.id ?? null;
        console.log("[vapi-server-event] Call logged via fallback row");
      }
    } else {
      savedId = saved?.id ?? null;
      console.log(`[vapi-server-event] Call logged (lead=${leadId}, customer=${customerId}, category=${category})`);
    }

    // EVERY call produces a notification, whatever the outcome.
    await notifyCallLogged(admin, {
      companyId,
      callId: savedId,
      callerName: customerName || input.callerName,
      callerPhone: input.callerPhone,
      isExistingClient,
      category,
      summary: input.summary,
      durationSeconds: row.duration_seconds,
    });
  } catch (err) {
    console.error("[vapi-server-event] recordCall exception:", err);
  }
}


// ─── Main Handler ──────────────────────────────────────────


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
    const body = await req.json();
    const messageType = body?.message?.type;

    console.log(`[vapi-server-event] Event: ${messageType}`);

    // ─── Handle assistant-request (fires BEFORE Mandy speaks) ───
    // Doing the caller lookup here means the identity is already known when
    // the call is answered — no mid-greeting "please hold" pause, and the
    // first sentence can use the customer's name and last-call context.
    if (messageType === "assistant-request") {
      const callerNumber = extractCallerNumber(body);
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;

      // Vapi keeps the caller on ringback until we respond, so the lookup runs
      // "while the phone rings". Cap it: after ~3.5s (about two rings) we answer
      // with the generic greeting rather than leaving the caller ringing.
      const LOOKUP_BUDGET_MS = 3500;
      const startedAt = Date.now();

      let context: any = null;
      if (callerNumber) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/lookup-caller`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": apiKey },
            body: JSON.stringify({ phone_number: callerNumber }),
            signal: AbortSignal.timeout(LOOKUP_BUDGET_MS),
          });
          const json = await res.json();
          context = typeof json.result === "string" ? JSON.parse(json.result) : json.result;
        } catch (err) {
          console.error(
            `[vapi-server-event] assistant-request lookup failed after ${Date.now() - startedAt}ms:`,
            err,
          );
        }
      }
      console.log(`[vapi-server-event] pre-answer lookup took ${Date.now() - startedAt}ms`);


      const known = context?.is_existing_customer && context?.customer?.name;
      const firstName = known
        ? (context.customer.first_name || context.customer.name.split(" ")[0])
        : "";

      // Read the caller ID back in a speakable way: +27824455332 → "0 8 2 4 4 5 5 3 3 2"
      const spokenNumber = (() => {
        if (!callerNumber) return "";
        let digits = callerNumber.replace(/\D/g, "");
        if (digits.startsWith("27") && digits.length === 11) digits = "0" + digits.slice(2);
        return digits.split("").join(" ");
      })();

      let firstMessage = "Hi, you've reached 0800BeCool. May I start with your name please?";
      if (known) {
        const lastCall = context.last_call;
        firstMessage = lastCall
          ? `Hi ${firstName}, welcome back to 0800BeCool. I see you contacted us ${lastCall.when.replace(/^.*\(/, "").replace(/\)$/, "")} about your ${String(lastCall.service_type || "job").toLowerCase()}. Are you calling about that?`
          : `Hi ${firstName}, welcome back to 0800BeCool. How can I help you today?`;
      } else if (callerNumber) {
        firstMessage = "Hi, you've reached 0800BeCool. I don't have your number on file yet — may I start with your name please?";
      }

      // Everything Mandy says about dates must be anchored to SA local time.
      const nowSast = new Date().toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        weekday: "long", day: "numeric", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      });
      const timeBlock = [
        `TIME CONTEXT: right now it is ${nowSast} in South Africa (SAST, UTC+2). Every date and time you hear or say is South African time — never convert time zones.`,
        `SPEECH FORMAT — DATES: when you say an appointment date, say ONLY the weekday, day and month, e.g. "Monday, 3 August". NEVER say the year. NEVER say "2026".`,
        `SPEECH FORMAT — ADDRESSES: when you read an address back, say ONLY the street and suburb, e.g. "2 Thompson Street, Strand". NEVER say the province (Western Cape, Gauteng, etc.) and NEVER say the postal code, even if they appear in the data.`,
        `APPOINTMENT RULES: only ever state an existing appointment that appears verbatim in the data below. If nothing is booked, say so plainly and OFFER TO BOOK IT NOW.`,
        `BOOKING RULES: you can book appointments yourself. Propose a specific day and time, get a clear yes, confirm the service address, then call the book_appointment tool with phone_number, date (YYYY-MM-DD), time (HH:MM 24-hour), service_type and address. Read back the confirmed date (no year) and address (street and suburb only) afterwards. If the caller is moving an existing appointment, use the same tool — it reschedules the existing job instead of creating a second one. Only say "someone will call you back" if the tool reports a failure.`,
      ].join("\n");



      const unknownScript = [
        `CALLER IDENTITY: NOT RECOGNISED (${callerNumber ? `caller ID ${callerNumber}` : "number withheld"}). Treat as a NEW caller.`,
        `FALLBACK FLOW — complete these steps BEFORE discussing the job, one question at a time:`,
        `1. Ask for their full name and wait for the answer. Repeat it back to confirm if it is unusual.`,
        callerNumber
          ? `2. Confirm the contact number: say "I have your number as ${spokenNumber} — is that the best number to reach you on?" If they say no, ask for the correct number, read it back digit by digit and get a yes before continuing.`
          : `2. Their number is withheld, so ask for the best contact number, read it back digit by digit and get a yes before continuing.`,
        `3. Only once you have a confirmed name AND a confirmed phone number, continue: ask what they need help with and their address.`,
        `Never guess or invent a name. If they refuse to give a name, use "Unknown Caller" but still confirm a callback number.`,
        `There is NO appointment on file for this caller — never confirm or imply an existing booking.`,
      ].filter(Boolean).join("\n");

      const hasAppointment = !!known && (context.has_confirmed_appointment ||
        (context.active_jobs || []).some((j: string) => /scheduled for/i.test(j)));

      const contextBlock = [
        timeBlock,
        known
          ? [
              `CALLER IDENTITY (already verified from caller ID ${callerNumber}) — do NOT ask who is calling and do NOT ask them to hold while you check.`,
              context.customer_address
                ? `SERVICE ADDRESS ON FILE: ${context.customer_address}. Read it back and ask them to confirm it — NEVER say you have no address on file.`
                : `NO address on file — ask for the service address and read it back.`,
              context.greeting_hint,
              context.last_call
                ? `Last contact: ${context.last_call.when} — ${context.last_call.service_type} (${context.last_call.status}). Discussed: ${context.last_call.summary} Appointment: ${context.last_call.appointment}`
                : "",
              context.call_history_summary && context.calls_last_7_days
                ? `CALL HISTORY — ${context.calls_last_7_days} contact(s) in the last 7 days, ${context.calls_today || 0} today:\n${context.call_history_summary}`
                : "",
              context.likely_intent
                ? `LIKELY REASON FOR THIS CALL: ${context.likely_intent} Acknowledge the repeat contact naturally in your first or second sentence.`
                : "",
              context.confirmed_appointments?.length
                ? `Confirmed appointments:\n${context.confirmed_appointments.join("\n")}`
                : "",
              context.active_jobs?.length ? `Open enquiries/jobs:\n${context.active_jobs.join("\n")}` : "",
              context.recent_jobs?.length ? `Job history:\n${context.recent_jobs.join("\n")}` : "",
              context.equipment?.length ? `Equipment on file:\n${context.equipment.join("\n")}` : "",
              hasAppointment
                ? ""
                : `NO CONFIRMED APPOINTMENT is on file. If the caller believes one was made, apologise, explain it was logged as an enquiry only, and book it now with the book_appointment tool.`,
            ].filter(Boolean).join("\n")
          : unknownScript,
      ].join("\n");



      console.log(`[vapi-server-event] assistant-request for ${callerNumber || "(no number)"} — known=${!!known}`);

      const assistantId = Deno.env.get("VAPI_ASSISTANT_ID") ||
        body?.message?.phoneNumber?.assistantId ||
        body?.message?.call?.assistantId ||
        body?.call?.assistantId || "";

      // assistant-request is an assistant-selection webhook. Vapi ignores a
      // response containing only `assistantOverrides`; it must also identify
      // the saved assistant (or provide a complete transient assistant).
      // Returning the ID here keeps the caller ringing while lookup-caller
      // runs, then starts Mandy with the resolved identity and job context.
      if (!assistantId) {
        console.error("[vapi-server-event] assistant-request has no VAPI_ASSISTANT_ID; cannot select Mandy");
        return new Response(JSON.stringify({ error: "Assistant is not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        assistantId,
        assistantOverrides: {
          firstMessage,
          variableValues: {
            caller_phone: callerNumber || "",
            caller_name: known ? context.customer.name : "",
            caller_first_name: firstName,
            is_existing_customer: !!known,
            customer_address: known ? (context.customer_address || "") : "",
            caller_context: contextBlock,
            call_history_summary: known ? (context.call_history_summary || "") : "",
            likely_intent: known ? (context.likely_intent || "") : "",
            calls_today: known ? (context.calls_today || 0) : 0,
          },
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Handle tool-calls (lookup_caller / check_job_status) ───
    if (messageType === "tool-calls") {
      const toolCallList = body.message.toolCallList || body.message.toolWithToolCallList || [];

      // Caller ID from the call payload — used when Vapi sends no phone_number argument
      const callerNumber = extractCallerNumber(body);

      const results: any[] = [];

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;

      for (const toolCall of toolCallList) {
        const fn = toolCall.function || toolCall;
        const name = fn.name || "";

        // Vapi sends either `parameters` (object) or `arguments` (object or JSON string)
        let params: any = fn.parameters ?? fn.arguments ?? {};
        if (typeof params === "string") {
          try { params = JSON.parse(params); } catch { params = {}; }
        }

        if (name === "book_appointment") {
          const phoneNumber = params.phone_number || callerNumber || "";
          console.log(`[vapi-server-event] book_appointment for ${phoneNumber}:`, JSON.stringify(params));
          try {
            const res = await fetch(`${supabaseUrl}/functions/v1/book-appointment`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-api-key": apiKey },
              body: JSON.stringify({ ...params, phone_number: phoneNumber }),
            });
            const json = await res.json();
            results.push({
              toolCallId: toolCall.id || toolCall.toolCallId,
              result: json.result || "Booking failed. Apologise and say the office will phone back to confirm.",
            });
          } catch (bookErr: any) {
            console.error("[vapi-server-event] book_appointment error:", bookErr);
            results.push({
              toolCallId: toolCall.id || toolCall.toolCallId,
              result: "Booking failed. Apologise and say the office will phone back to confirm the appointment.",
            });
          }
        } else if (name === "lookup_caller" || name === "check_job_status") {
          const phoneNumber = params.phone_number || callerNumber || "";
          const target = name === "lookup_caller" ? "lookup-caller" : "check-job-status";


          console.log(
            `[vapi-server-event] ${name} for: ${phoneNumber || "(no number)"} (arg=${params.phone_number || "none"}, callerId=${callerNumber || "none"})`
          );

          try {
            const lookupResponse = await fetch(
              `${supabaseUrl}/functions/v1/${target}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                },
                body: JSON.stringify({
                  phone_number: phoneNumber,
                  ...(params.lead_id ? { lead_id: params.lead_id } : {}),
                }),
              }
            );

            const lookupResult = await lookupResponse.json();
            let toolResult = lookupResult.result || "No customer found. Treat as new caller and ask for their name.";

            // lookup-caller returns structured context as a JSON string. Convert
            // the identity into an explicit instruction so the assistant does
            // not merely repeat/confirm the phone number and overlook the name.
            if (name === "lookup_caller" && typeof toolResult === "string") {
              try {
                const context = JSON.parse(toolResult);
                if (context?.is_existing_customer && context?.customer?.name) {
                  const firstName = context.customer.first_name || context.customer.name.split(" ")[0];
                  toolResult = [
                    `IDENTITY MATCH CONFIRMED: The caller is ${context.customer.name}.`,
                    `Immediately address the caller as ${firstName}; do not ask for their name again.`,
                    context.greeting_hint || "",
                    context.last_call
                      ? `LAST CONTACT: ${context.last_call.when} — ${context.last_call.service_type} (${context.last_call.status}). Discussed: ${context.last_call.summary} Appointment: ${context.last_call.appointment}`
                      : "",
                    context.active_jobs?.length ? `OPEN JOBS: ${context.active_jobs.join(" | ")}` : "",
                    `Customer context: ${JSON.stringify(context)}`,
                  ].filter(Boolean).join(" ");

                } else {
                  const spoken = (() => {
                    if (!phoneNumber) return "";
                    let d = String(phoneNumber).replace(/\D/g, "");
                    if (d.startsWith("27") && d.length === 11) d = "0" + d.slice(2);
                    return d.split("").join(" ");
                  })();
                  toolResult = [
                    "NO IDENTITY MATCH: this number is not linked to any customer. Treat as a NEW caller.",
                    "FALLBACK FLOW, one question at a time, before discussing the job:",
                    "1. Ask for their full name and wait for the answer.",
                    spoken
                      ? `2. Confirm the number: "I have your number as ${spoken} — is that the best number to reach you on?" If not, take the correct number and read it back digit by digit for a yes.`
                      : "2. The number is withheld — ask for the best contact number and read it back digit by digit for a yes.",
                    "3. Only after a confirmed name AND phone number, continue with the service request and address.",
                    "Never invent a name.",
                  ].join(" ");
                }
              } catch {
                // Preserve a plain-text tool response if the downstream
                // function intentionally did not return structured JSON.
              }
            }

            console.log(`[vapi-server-event] ${name} response: ${toolResult.slice(0, 240)}`);

            results.push({
              toolCallId: toolCall.id || toolCall.toolCallId,
              result: toolResult,
            });
          } catch (lookupErr: any) {
            console.error(`[vapi-server-event] ${name} error:`, lookupErr);
            results.push({
              toolCallId: toolCall.id || toolCall.toolCallId,
              result: "Error looking up caller. Treat as new caller and ask for their name.",
            });
          }
        } else {
          // Unknown tool — return empty result
          results.push({
            toolCallId: toolCall.id || toolCall.toolCallId,
            result: "Tool not recognized.",
          });
        }
      }


      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Handle end-of-call-report ───
    if (messageType === "end-of-call-report") {
      const call = body.message.call || {};
      const artifact = body.message.artifact || {};
      const analysis = body.message.analysis || call.analysis || {};
      const endedReason = body.message.endedReason || "unknown";
      const summary = body.message.summary || analysis.summary || "";
      const transcript = artifact.transcript || "";
      const messages = artifact.messages || [];
      const recordingUrl =
        artifact.recording?.url ||
        artifact.recordingUrl ||
        artifact.recording?.mono?.combinedUrl ||
        artifact.stereoRecordingUrl ||
        artifact.recording?.stereoUrl ||
        "";


      // Get caller phone (fall back to other payload shapes Vapi uses)
      const callerPhone = extractCallerNumber(body);

      if (!callerPhone) {
        console.log("[vapi-server-event] No caller phone — logging call only");
        await recordCall({
          providerCallId: call.id || "",
          callerPhone: "",
          callerName: null,
          businessPhone: call?.phoneNumber?.number || null,
          leadId: null,
          customerId: null,
          startedAt: call.startedAt ? new Date(call.startedAt).toISOString() : null,
          endedAt: call.endedAt ? new Date(call.endedAt).toISOString() : null,
          durationSeconds: Number(body.message.durationSeconds) || 0,
          endedReason,
          serviceType: null,
          urgency: null,
          summary: summary || null,
          transcript: transcript || null,
          recordingUrl: recordingUrl || null,
          outcome: "no_lead",
        });
        return new Response(JSON.stringify({ ok: true, skipped: "no phone", logged: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }


      // Calculate duration — Vapi may send it directly, or only timestamps
      const startedAtRaw = call.startedAt || body.message.startedAt;
      const endedAtRaw = call.endedAt || body.message.endedAt;
      const startedAt = startedAtRaw ? new Date(startedAtRaw).getTime() : 0;
      const endedAt = endedAtRaw ? new Date(endedAtRaw).getTime() : Date.now();
      const durationSeconds =
        Number(body.message.durationSeconds) ||
        (Number(body.message.durationMs) ? Math.round(Number(body.message.durationMs) / 1000) : 0) ||
        (startedAt ? Math.round((endedAt - startedAt) / 1000) : 0);

      // Skip short calls (still logged so the admin call history is complete)
      if (!isValidLead(durationSeconds, messages, transcript)) {
        console.log(`[vapi-server-event] Short call (${durationSeconds}s, ${messages.length} msgs) — skipping`);
        await recordCall({
          providerCallId: call.id || "",
          callerPhone,
          callerName: null,
          businessPhone: call?.phoneNumber?.number || null,
          leadId: null,
          customerId: null,
          startedAt: startedAtRaw ? new Date(startedAtRaw).toISOString() : null,
          endedAt: endedAtRaw ? new Date(endedAtRaw).toISOString() : null,
          durationSeconds,
          endedReason,
          serviceType: null,
          urgency: null,
          summary: summary || null,
          transcript: transcript || null,
          recordingUrl: recordingUrl || null,
          outcome: "no_lead",
        });
        return new Response(JSON.stringify({
          ok: true,
          skipped: "too short",
          duration: durationSeconds,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Extract info from conversation
      const callerInfo = extractCallerInfo(messages, analysis);
      const callerName = callerInfo.name || "Unknown Caller";
      const serviceType = detectServiceType(transcript);
      const urgency = detectUrgency(transcript);

      console.log(`[vapi-server-event] Lead: ${callerName} (${callerPhone}), ${serviceType}, ${urgency}, ${durationSeconds}s`);

      // ─── Enrichment-based dedup ───
      // twilio-inbound-call creates a placeholder lead the moment the phone
      // rings, tagged with the Twilio CallSid (which is NOT the same as
      // Vapi's call.id). We therefore look up an existing lead in two ways:
      //   (1) by the Vapi call.id in notes (in case a previous attempt tagged it), and
      //   (2) by the caller's phone number in the last 10 minutes — this is
      //       what actually catches the Twilio placeholder.
      // If found, enrich in place instead of creating a duplicate lead.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;
      const callSid = call.id || "";

      try {
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabaseAdmin = createClient(supabaseUrl, serviceKey);

        let existing: { id: string; customer_id: string | null; notes: string | null; service_type: string | null; priority: string | null; customer_address: string | null } | null = null;

        if (callSid) {
          const { data } = await supabaseAdmin
            .from("leads")
            .select("id, customer_id, notes, service_type, priority, customer_address")
            .eq("customer_phone", callerPhone)
            .ilike("notes", `%${callSid}%`)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          existing = data ?? null;
        }

        if (!existing) {
          const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
          const { data } = await supabaseAdmin
            .from("leads")
            .select("id, customer_id, notes, service_type, priority, customer_address")
            .eq("customer_phone", callerPhone)
            .gte("created_at", tenMinAgo)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          existing = data ?? null;
        }

        // (3) A lead that the book_appointment tool created/rescheduled DURING
        // this very call, or any still-open lead for this caller. Without this
        // every call ends up creating a brand-new duplicate "New Quote" lead
        // even though the booking already updated the existing one.
        if (!existing) {
          const digits = callerPhone.replace(/\D/g, "");
          const tail = digits.slice(-9);
          const variants = [...new Set([
            callerPhone,
            digits,
            "+" + digits,
            "0" + tail,
            "+27" + tail,
            "27" + tail,
          ])];
          const orFilter = variants.map((v) => `customer_phone.eq.${v}`).join(",");
          const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
          const { data } = await supabaseAdmin
            .from("leads")
            .select("id, customer_id, notes, service_type, priority, customer_address, updated_at")
            .or(orFilter)
            .in("status", ["pending", "new", "accepted", "claimed", "scheduled", "converted"])
            .gte("created_at", since)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          existing = (data as any) ?? null;
        }

        if (existing) {
          console.log(`[vapi-server-event] Enriching existing lead ${existing.id} for CallSid ${callSid || "n/a"}`);
          const enrichedNotes = [
            existing.notes || "",
            "",
            `--- End-of-call update (${durationSeconds}s, ${endedReason}) ---`,
            `Vapi call: ${callSid || "unknown"}`,
            summary || "",
            transcript ? `Transcript: ${transcript.slice(0, 2000)}` : "",
            recordingUrl ? `Recording: ${recordingUrl}` : "",
          ].filter(Boolean).join("\n");

          const patch: Record<string, any> = { notes: enrichedNotes };
          if (!existing.service_type || existing.service_type === "General Inquiry") {
            patch.service_type = serviceType;
          }
          if (!existing.priority || existing.priority === "medium") {
            patch.priority = mapPriority(urgency);
          }
          if (
            callerInfo.address &&
            (!existing.customer_address ||
              existing.customer_address === "Address pending — inbound call" ||
              existing.customer_address === "Address pending — WhatsApp confirmation sent")
          ) {
            patch.customer_address = callerInfo.address;
          }

          await supabaseAdmin.from("leads").update(patch).eq("id", existing.id);

          await recordCall({
            providerCallId: callSid,
            callerPhone,
            callerName,
            businessPhone: call?.phoneNumber?.number || null,
            leadId: existing.id,
            customerId: existing.customer_id,
            startedAt: startedAtRaw ? new Date(startedAtRaw).toISOString() : null,
            endedAt: endedAtRaw ? new Date(endedAtRaw).toISOString() : null,
            durationSeconds,
            endedReason,
            serviceType,
            urgency,
            summary,
            transcript,
            recordingUrl,
            outcome: "lead_enriched",
          });

          return new Response(JSON.stringify({
            ok: true,
            event: "end-of-call-report",
            lead: { success: true, lead_id: existing.id, customer_id: existing.customer_id, enriched: true },
            caller: { name: callerName, phone: callerPhone, service: serviceType, urgency, duration_seconds: durationSeconds },
          }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      } catch (dedupErr) {
        console.warn("[vapi-server-event] Enrichment check failed, proceeding to create:", dedupErr);
      }


      // ─── Create customer + lead via receive-vapi-lead ───

      const leadPayload = {
        caller_name: callerName,
        caller_phone: callerPhone,
        caller_id_phone: callerPhone,
        service_type: serviceType,
        address: callerInfo.address || undefined,
        notes: [
          summary || `Call transcript (${durationSeconds}s):`,
          transcript.slice(0, 2000),
          "",
          `Ended reason: ${endedReason}`,
          callerInfo.address ? `Address mentioned: ${callerInfo.address}` : "",
        ].filter(Boolean).join("\n"),
        urgency,
        call_duration_seconds: durationSeconds,
        call_recording_url: recordingUrl,
        vapi_call_id: call.id || "",
        source: "vapi_direct",
        whatsapp_consent: true,
      };

      let leadResult: any = {};
      try {
        const leadResponse = await fetch(
          `${supabaseUrl}/functions/v1/receive-vapi-lead`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
            },
            body: JSON.stringify(leadPayload),
          }
        );
        leadResult = await leadResponse.json();
        console.log(`[vapi-server-event] Lead result:`, JSON.stringify(leadResult));
      } catch (leadErr: any) {
        console.error("[vapi-server-event] Lead creation error:", leadErr);
        leadResult = { success: false, error: leadErr.message };
      }

      await recordCall({
        providerCallId: call.id || "",
        callerPhone,
        callerName,
        businessPhone: call?.phoneNumber?.number || null,
        leadId: leadResult?.lead_id || null,
        customerId: leadResult?.customer_id || null,
        startedAt: startedAtRaw ? new Date(startedAtRaw).toISOString() : null,
        endedAt: endedAtRaw ? new Date(endedAtRaw).toISOString() : null,
        durationSeconds,
        endedReason,
        serviceType,
        urgency,
        summary: summary || null,
        transcript: transcript || null,
        recordingUrl: recordingUrl || null,
        outcome: leadResult?.lead_id ? "lead_created" : "lead_failed",
      });



      // ─── Send WhatsApp confirmation DIRECTLY (no queue) ───
      let whatsappResult: { success: boolean; error?: string } = { success: false, error: "skipped" };

      if (leadResult.success && leadResult.lead_id && durationSeconds > 15) {
        whatsappResult = await sendWhatsAppConfirmation(
          callerPhone,
          callerName,
          serviceType,
          leadResult.lead_id,
        );

        // Also log the WhatsApp attempt in the notification_logs table
        try {
          const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
          const supabase = createClient(supabaseUrl, supabaseServiceKey);

          await supabase.from("notification_logs").insert({
            customer_id: leadResult.customer_id,
            notification_type: "lead_confirmation",
            channel: "whatsapp",
            recipient: callerPhone,
            status: whatsappResult.success ? "sent" : "failed",
            error_message: whatsappResult.error || null,
          }).then(({ error }) => {
            if (error) console.warn("[vapi-server-event] notification_logs insert error:", error);
          });
        } catch (logErr) {
          console.warn("[vapi-server-event] Could not log notification:", logErr);
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        event: "end-of-call-report",
        lead: leadResult,
        whatsapp: whatsappResult,
        caller: {
          name: callerName,
          phone: callerPhone,
          service: serviceType,
          urgency,
          duration_seconds: durationSeconds,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── All other events → 200 OK ───
    return new Response(JSON.stringify({ ok: true, event: messageType }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[vapi-server-event] Error:", error);
    // Always return 200 to Vapi
    return new Response(JSON.stringify({ ok: true, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
