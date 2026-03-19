import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * receive-vapi-lead
 * 
 * Webhook endpoint that receives lead data from Vapi (via Lindy or direct).
 * Creates/finds customer, creates lead, triggers WhatsApp confirmation,
 * and finds the nearest available agent.
 * 
 * Auth: Uses a shared API key (VAPI_WEBHOOK_SECRET) since Lindy/Vapi 
 * can't do Supabase JWT auth. The key is checked in the x-api-key header.
 * 
 * POST body (JSON):
 * {
 *   caller_name?: string,        // From Vapi AI extraction
 *   caller_phone: string,        // Caller ID or spoken number (required)
 *   caller_id_phone?: string,    // Raw caller ID from Vapi
 *   service_type?: string,       // "new_install" | "repair" | "service" | "quote" | "unknown"
 *   address?: string,            // If captured during call
 *   notes?: string,              // Call summary / transcript notes
 *   urgency?: string,            // "emergency" | "urgent" | "normal" | "low"
 *   call_duration_seconds?: number,
 *   call_recording_url?: string,
 *   vapi_call_id?: string,       // For traceability
 *   source?: string,             // "vapi" | "lindy" | "web" | "manual"
 *   whatsapp_consent?: boolean,  // Did caller consent to WhatsApp?
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Normalize SA phone numbers to +27 format
function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "27" + digits.slice(1);
  } else if (!digits.startsWith("27") && digits.length === 9) {
    digits = "27" + digits;
  }
  return "+" + digits;
}

// Map urgency to priority
function mapPriority(urgency?: string): string {
  switch (urgency?.toLowerCase()) {
    case "emergency": return "high";
    case "urgent": return "high";
    case "normal": return "medium";
    case "low": return "low";
    default: return "medium";
  }
}

// Map service description to service_type
function mapServiceType(raw?: string): string {
  if (!raw) return "General Inquiry";
  const lower = raw.toLowerCase();
  if (lower.includes("install") || lower.includes("new")) return "New Installation";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken")) return "Repair";
  if (lower.includes("service") || lower.includes("maintain")) return "Service / Maintenance";
  if (lower.includes("quote") || lower.includes("price")) return "Quote Request";
  return raw;
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
    // --- Auth: check API key ---
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");

    if (!expectedKey || apiKey !== expectedKey) {
      console.error("[receive-vapi-lead] Invalid or missing API key");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Parse body ---
    const body = await req.json();
    console.log("[receive-vapi-lead] Incoming:", JSON.stringify(body));

    const {
      caller_name,
      caller_phone,
      caller_id_phone,
      service_type,
      address,
      notes,
      urgency,
      call_duration_seconds,
      call_recording_url,
      vapi_call_id,
      source = "vapi",
      whatsapp_consent,
    } = body;

    // Phone is required
    const phone = caller_phone || caller_id_phone;
    if (!phone) {
      return new Response(JSON.stringify({ error: "caller_phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(phone);
    const callerIdNormalized = caller_id_phone ? normalizePhone(caller_id_phone) : null;

    // --- Init Supabase (service role — this is a server-to-server webhook) ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Step 1: Check for existing customer by phone ---
    let customerId: string | null = null;
    let customerName = caller_name || "Unknown Caller";
    let isExistingCustomer = false;

    // Search by the phone number spoken in the call
    const { data: phoneMatch } = await supabase
      .rpc("check_customer_duplicates", {
        p_phone: normalizedPhone,
        p_first_name: caller_name?.split(" ")[0] || null,
        p_last_name: caller_name?.split(" ").slice(1).join(" ") || null,
      });

    if (phoneMatch && phoneMatch.length > 0 && phoneMatch[0].match_score >= 0.8) {
      // Strong match — use existing customer
      customerId = phoneMatch[0].id;
      customerName = `${phoneMatch[0].first_name || ""} ${phoneMatch[0].last_name || ""}`.trim() || customerName;
      isExistingCustomer = true;
      console.log(`[receive-vapi-lead] Matched existing customer: ${customerName} (${customerId})`);
    } else if (callerIdNormalized && callerIdNormalized !== normalizedPhone) {
      // Try caller ID number too
      const { data: callerIdMatch } = await supabase
        .rpc("check_customer_duplicates", { p_phone: callerIdNormalized });

      if (callerIdMatch && callerIdMatch.length > 0 && callerIdMatch[0].match_score >= 0.8) {
        customerId = callerIdMatch[0].id;
        customerName = `${callerIdMatch[0].first_name || ""} ${callerIdMatch[0].last_name || ""}`.trim() || customerName;
        isExistingCustomer = true;
        console.log(`[receive-vapi-lead] Matched via caller ID: ${customerName} (${customerId})`);
      }
    }

    // If no match, create a new customer
    if (!customerId) {
      const firstName = caller_name?.split(" ")[0] || "Unknown";
      const lastName = caller_name?.split(" ").slice(1).join(" ") || "";

      const { data: newCustomer, error: custError } = await supabase
        .from("customers")
        .insert({
          name: customerName,
          first_name: firstName,
          last_name: lastName,
          phone: normalizedPhone,
          address: address || "",
          status: "lead",
        })
        .select("id")
        .single();

      if (custError) {
        console.error("[receive-vapi-lead] Customer create error:", custError);
        // Don't fail — proceed without customer_id
      } else {
        customerId = newCustomer.id;
        console.log(`[receive-vapi-lead] Created new customer: ${customerName} (${customerId})`);
      }
    }

    // --- Step 2: Create the lead ---
    const leadData: Record<string, any> = {
      customer_name: customerName,
      customer_phone: normalizedPhone,
      customer_address: address || "Address pending — WhatsApp confirmation sent",
      service_type: mapServiceType(service_type),
      status: "pending",
      priority: mapPriority(urgency),
      notes: [
        notes || "",
        `Source: ${source}`,
        vapi_call_id ? `Vapi Call ID: ${vapi_call_id}` : "",
        call_duration_seconds ? `Call duration: ${call_duration_seconds}s` : "",
        call_recording_url ? `Recording: ${call_recording_url}` : "",
        callerIdNormalized && callerIdNormalized !== normalizedPhone
          ? `Caller ID: ${callerIdNormalized} (different from provided number)`
          : "",
        isExistingCustomer ? "⭐ Returning customer" : "🆕 New customer",
      ].filter(Boolean).join("\n"),
      // Default coords (0,0) — will be updated when address is confirmed
      latitude: 0,
      longitude: 0,
    };

    if (customerId) {
      leadData.customer_id = customerId;
    }

    const { data: newLead, error: leadError } = await supabase
      .from("leads")
      .insert(leadData)
      .select("id, customer_name, customer_phone, status")
      .single();

    if (leadError) {
      console.error("[receive-vapi-lead] Lead create error:", leadError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to create lead",
        detail: leadError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[receive-vapi-lead] Lead created: ${newLead.id}`);

    // --- Step 3: Queue WhatsApp confirmation (if we have a number) ---
    let whatsappQueued = false;

    // Only send WhatsApp if consent was given OR if it's a genuine lead (not a hangup)
    const shouldSendWhatsapp = whatsapp_consent !== false && 
      (call_duration_seconds === undefined || call_duration_seconds > 15);

    if (shouldSendWhatsapp && customerId) {
      try {
        const { error: notifError } = await supabase
          .from("notification_queue")
          .insert({
            customer_id: customerId,
            lead_id: newLead.id,
            notification_type: "lead_confirmation",
            channel: "whatsapp",
            recipient_phone: normalizedPhone,
            body: `Hi ${customerName.split(" ")[0]}! 👋 Thanks for calling 0800BeCool. ` +
              `We've received your ${mapServiceType(service_type).toLowerCase()} request. ` +
              `Could you please confirm your address so we can get someone to you as quickly as possible? ` +
              `Reply with your street address and suburb. 🏠`,
            variables: {
              customer_name: customerName,
              service_type: mapServiceType(service_type),
              lead_id: newLead.id,
            },
            status: "pending",
            scheduled_at: new Date().toISOString(),
            max_attempts: 5,
          });

        if (notifError) {
          console.error("[receive-vapi-lead] WhatsApp queue error:", notifError);
        } else {
          whatsappQueued = true;
          console.log("[receive-vapi-lead] WhatsApp confirmation queued");
        }
      } catch (e) {
        console.error("[receive-vapi-lead] WhatsApp queue exception:", e);
      }
    }

    // --- Step 4: Find nearest agents (for logging/future auto-assign) ---
    let nearbyAgentCount = 0;
    // We can't do geofencing without coords yet, but log for reference
    // Once the customer confirms their address, the admin can assign via the map view

    // --- Build response ---
    const response = {
      success: true,
      lead_id: newLead.id,
      customer_id: customerId,
      customer_name: customerName,
      is_existing_customer: isExistingCustomer,
      whatsapp_queued: whatsappQueued,
      message: isExistingCustomer
        ? `Returning customer "${customerName}" — lead created and queued.`
        : `New customer "${customerName}" — created and lead queued.`,
    };

    console.log("[receive-vapi-lead] Success:", JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[receive-vapi-lead] Unhandled error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Internal server error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
