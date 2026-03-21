import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * vapi-server-event
 * 
 * Receives ALL Vapi server events (status-update, end-of-call-report,
 * tool-calls, etc). We only act on "end-of-call-report" — everything
 * else gets a 200 OK and is ignored.
 * 
 * This replaces Lindy as the lead creation trigger. When a call ends,
 * Vapi sends the full transcript + call data here INSTANTLY.
 * 
 * Vapi payload format:
 * {
 *   "message": {
 *     "type": "end-of-call-report",
 *     "endedReason": "hangup",
 *     "call": { id, phoneNumber, customer, startedAt, endedAt, ... },
 *     "artifact": {
 *       "recording": { url, ... },
 *       "transcript": "AI: ...\nUser: ...",
 *       "messages": [{ role, message }, ...]
 *     }
 *   }
 * }
 * 
 * Also handles "tool-calls" for the lookup_caller function.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Normalize SA phone numbers to +27 format
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

// Map priority
function mapPriority(urgency?: string): string {
  switch (urgency?.toLowerCase()) {
    case "emergency": return "high";
    case "urgent": return "high";
    default: return "medium";
  }
}

// Extract service type from transcript
function detectServiceType(transcript: string): string {
  const lower = transcript.toLowerCase();
  if (lower.includes("install") || lower.includes("new aircon") || lower.includes("new air con") || lower.includes("new unit")) return "New Installation";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken") || lower.includes("not working") || lower.includes("not cooling")) return "Repair";
  if (lower.includes("service") || lower.includes("maintain") || lower.includes("clean")) return "Service / Maintenance";
  if (lower.includes("quote") || lower.includes("price") || lower.includes("how much")) return "Quote Request";
  return "General Inquiry";
}

// Extract caller name from messages (look for when user gives name)
function extractCallerName(messages: any[]): string | null {
  for (const msg of messages) {
    if (msg.role === "user") {
      // Look for "my name is X" or "it's X" or "I'm X" patterns
      const text = msg.message || msg.content || "";
      const nameMatch = text.match(/(?:my name is|i'm|i am|this is|it's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
      if (nameMatch) return nameMatch[1].trim();
    }
  }
  return null;
}

// Check if call was too short to be a real lead (hangups, spam)
function isValidLead(durationSeconds: number, messages: any[]): boolean {
  if (durationSeconds < 15) return false;
  // Count user messages (not system/assistant)
  const userMessages = messages.filter((m: any) => m.role === "user");
  return userMessages.length >= 1;
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
    const body = await req.json();
    const messageType = body?.message?.type;

    console.log(`[vapi-server-event] Received event: ${messageType}`);

    // --- Handle tool-calls (for lookup_caller) ---
    if (messageType === "tool-calls") {
      const toolCalls = body.message.toolCallList || body.message.toolWithToolCallList || [];
      
      for (const toolCall of toolCalls) {
        const name = toolCall.name || toolCall.function?.name;
        if (name === "lookup_caller") {
          const params = toolCall.parameters || toolCall.function?.parameters || {};
          const phoneNumber = params.phone_number;

          // Forward to lookup-caller function
          const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
          const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;

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

          return new Response(JSON.stringify({
            results: [{
              toolCallId: toolCall.id || toolCall.toolCall?.id,
              result: lookupResult.result || "No customer found. Treat as new caller.",
            }],
          }), {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      // Unknown tool call — return empty
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Only process end-of-call-report ---
    if (messageType !== "end-of-call-report") {
      // Acknowledge all other events (status-update, hang, etc.)
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Process end-of-call-report ---
    const call = body.message.call || {};
    const artifact = body.message.artifact || {};
    const endedReason = body.message.endedReason || "unknown";
    const summary = body.message.summary || call.analysis?.summary || "";
    const transcript = artifact.transcript || "";
    const messages = artifact.messages || [];
    const recordingUrl = artifact.recording?.url || artifact.recordingUrl || "";

    // Get caller phone from Vapi call object
    const customerPhone = call.customer?.number || "";
    const callerPhone = normalizePhone(customerPhone);

    if (!callerPhone) {
      console.log("[vapi-server-event] No caller phone number — skipping");
      return new Response(JSON.stringify({ ok: true, skipped: "no phone number" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate duration
    const startedAt = call.startedAt ? new Date(call.startedAt).getTime() : 0;
    const endedAt = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
    const durationSeconds = startedAt ? Math.round((endedAt - startedAt) / 1000) : 0;

    // Check if this is a real lead (not a hangup or spam)
    if (!isValidLead(durationSeconds, messages)) {
      console.log(`[vapi-server-event] Short call (${durationSeconds}s) — skipping lead creation`);
      return new Response(JSON.stringify({
        ok: true,
        skipped: "call too short or no user interaction",
        duration_seconds: durationSeconds,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract info from the conversation
    const callerName = extractCallerName(messages) || "Unknown Caller";
    const serviceType = detectServiceType(transcript);

    console.log(`[vapi-server-event] Processing lead: ${callerName} (${callerPhone}), ${serviceType}, ${durationSeconds}s`);

    // --- Forward to receive-vapi-lead for actual lead creation ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const apiKey = Deno.env.get("VAPI_WEBHOOK_SECRET")!;

    const leadPayload = {
      caller_name: callerName,
      caller_phone: callerPhone,
      caller_id_phone: callerPhone,
      service_type: serviceType,
      notes: summary || `Call transcript (${durationSeconds}s):\n${transcript.slice(0, 2000)}`,
      urgency: "normal",
      call_duration_seconds: durationSeconds,
      call_recording_url: recordingUrl,
      vapi_call_id: call.id || "",
      source: "vapi_direct",
      whatsapp_consent: true, // Default to true for real conversations
    };

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

    const leadResult = await leadResponse.json();
    console.log(`[vapi-server-event] Lead result:`, JSON.stringify(leadResult));

    return new Response(JSON.stringify({
      ok: true,
      event: "end-of-call-report",
      lead: leadResult,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[vapi-server-event] Error:", error);
    // Always return 200 to Vapi so it doesn't retry
    return new Response(JSON.stringify({ ok: true, error: error.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
