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

function mapPriority(urgency?: string): string {
  switch (urgency?.toLowerCase()) {
    case "emergency": return "high";
    case "urgent": return "high";
    default: return "medium";
  }
}

function detectServiceType(transcript: string): string {
  const lower = transcript.toLowerCase();
  if (lower.includes("install") || lower.includes("new aircon") || lower.includes("new air con") || lower.includes("new unit")) return "New Installation";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken") || lower.includes("not working") || lower.includes("not cooling")) return "Repair";
  if (lower.includes("service") || lower.includes("maintain") || lower.includes("clean")) return "Service / Maintenance";
  if (lower.includes("quote") || lower.includes("price") || lower.includes("how much")) return "Quote Request";
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

function isValidLead(durationSeconds: number, messages: any[]): boolean {
  if (durationSeconds < 15) return false;
  const userMessages = messages.filter((m: any) => m.role === "user");
  return userMessages.length >= 1;
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

    // ─── Handle tool-calls (lookup_caller) ───
    if (messageType === "tool-calls") {
      const toolCallList = body.message.toolCallList || body.message.toolWithToolCallList || [];

      const results: any[] = [];

      for (const toolCall of toolCallList) {
        const fn = toolCall.function || toolCall;
        const name = fn.name || "";

        if (name === "lookup_caller") {
          const params = fn.parameters || {};
          const phoneNumber = params.phone_number || "";

          console.log(`[vapi-server-event] lookup_caller for: ${phoneNumber}`);

          // Forward to lookup-caller function
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;

          try {
            const lookupResponse = await fetch(
              `${supabaseUrl}/functions/v1/lookup-caller`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": apiKey,
                },
                body: JSON.stringify({ phone_number: phoneNumber }),
              }
            );

            const lookupResult = await lookupResponse.json();

            results.push({
              toolCallId: toolCall.id || toolCall.toolCallId,
              result: lookupResult.result || "No customer found. Treat as new caller and ask for their name.",
            });
          } catch (lookupErr: any) {
            console.error("[vapi-server-event] lookup_caller error:", lookupErr);
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
      const recordingUrl = artifact.recording?.url || artifact.recordingUrl || "";

      // Get caller phone
      const customerPhone = call.customer?.number || "";
      const callerPhone = normalizePhone(customerPhone);

      if (!callerPhone) {
        console.log("[vapi-server-event] No caller phone — skipping");
        return new Response(JSON.stringify({ ok: true, skipped: "no phone" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Calculate duration
      const startedAt = call.startedAt ? new Date(call.startedAt).getTime() : 0;
      const endedAt = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
      const durationSeconds = startedAt ? Math.round((endedAt - startedAt) / 1000) : 0;

      // Skip short calls
      if (!isValidLead(durationSeconds, messages)) {
        console.log(`[vapi-server-event] Short call (${durationSeconds}s) — skipping`);
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
