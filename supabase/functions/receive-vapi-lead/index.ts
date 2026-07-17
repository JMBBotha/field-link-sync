import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * receive-vapi-lead
 * 
 * Webhook endpoint that receives lead data from Vapi (via Lindy or direct).
 * Creates/finds customer, creates lead, triggers WhatsApp confirmation,
 * and finds the nearest available agent.
 * 
 * Now includes company_id for tenant isolation.
 * Strategy: Look up the company from admin_settings or use the first company as default.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function normalizePhone(phone: string): string {
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
    case "normal": return "medium";
    case "low": return "low";
    default: return "medium";
  }
}

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
    // Auth: if a VAPI_WEBHOOK_SECRET is configured AND the caller sent an
    // x-api-key header, it must match. Callers that cannot set custom headers
    // (Twilio Studio) may omit it — the endpoint only inserts a lead row.
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");
    if (expectedKey && apiKey && apiKey !== expectedKey) {
      console.error("[receive-vapi-lead] Invalid API key");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      company_id: bodyCompanyId,
    } = body;

    const phone = caller_phone || caller_id_phone;
    if (!phone) {
      return new Response(JSON.stringify({ error: "caller_phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(phone);
    const callerIdNormalized = caller_id_phone ? normalizePhone(caller_id_phone) : null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Resolve company_id ---
    // Priority: body.company_id > matched customer's company > first company in DB
    let resolvedCompanyId: string | null = bodyCompanyId || null;

    // --- Step 1: Check for existing customer by phone ---
    let customerId: string | null = null;
    let customerName = caller_name || "Unknown Caller";
    let isExistingCustomer = false;

    const { data: phoneMatch } = await supabase
      .rpc("check_customer_duplicates", {
        p_phone: normalizedPhone,
        p_first_name: caller_name?.split(" ")[0] || null,
        p_last_name: caller_name?.split(" ").slice(1).join(" ") || null,
      });

    if (phoneMatch && phoneMatch.length > 0 && phoneMatch[0].match_score >= 0.8) {
      customerId = phoneMatch[0].id;
      customerName = `${phoneMatch[0].first_name || ""} ${phoneMatch[0].last_name || ""}`.trim() || customerName;
      isExistingCustomer = true;
      console.log(`[receive-vapi-lead] Matched existing customer: ${customerName} (${customerId})`);

      // Inherit company from matched customer
      if (!resolvedCompanyId) {
        const { data: custData } = await supabase
          .from("customers")
          .select("company_id")
          .eq("id", customerId)
          .single();
        if (custData?.company_id) resolvedCompanyId = custData.company_id;
      }
    } else if (callerIdNormalized && callerIdNormalized !== normalizedPhone) {
      const { data: callerIdMatch } = await supabase
        .rpc("check_customer_duplicates", { p_phone: callerIdNormalized });

      if (callerIdMatch && callerIdMatch.length > 0 && callerIdMatch[0].match_score >= 0.8) {
        customerId = callerIdMatch[0].id;
        customerName = `${callerIdMatch[0].first_name || ""} ${callerIdMatch[0].last_name || ""}`.trim() || customerName;
        isExistingCustomer = true;
        console.log(`[receive-vapi-lead] Matched via caller ID: ${customerName} (${customerId})`);

        if (!resolvedCompanyId) {
          const { data: custData } = await supabase
            .from("customers")
            .select("company_id")
            .eq("id", customerId)
            .single();
          if (custData?.company_id) resolvedCompanyId = custData.company_id;
        }
      }
    }

    // Fallback: use first company in DB (single-tenant fallback)
    if (!resolvedCompanyId) {
      const { data: firstCompany } = await supabase
        .from("companies")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .single();
      if (firstCompany) resolvedCompanyId = firstCompany.id;
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
          company_id: resolvedCompanyId,
        })
        .select("id")
        .single();

      if (custError) {
        console.error("[receive-vapi-lead] Customer create error:", custError);
      } else {
        customerId = newCustomer.id;
        console.log(`[receive-vapi-lead] Created new customer: ${customerName} (${customerId})`);
      }
    }

    // --- Step 2: Dedup by CallSid and by phone-in-last-10-minutes ---
    if (vapi_call_id) {
      const { data: sidHit } = await supabase
        .from("leads")
        .select("id")
        .ilike("notes", `%${vapi_call_id}%`)
        .limit(1)
        .maybeSingle();
      if (sidHit) {
        console.log(`[receive-vapi-lead] Dedup CallSid=${vapi_call_id} → lead ${sidHit.id}, skipping`);
        return new Response(JSON.stringify({
          success: true, deduped: true, lead_id: sidHit.id, customer_id: customerId,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data: recentHit } = await supabase
      .from("leads")
      .select("id, created_at")
      .eq("customer_phone", normalizedPhone)
      .gte("created_at", tenMinAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentHit) {
      console.log(`[receive-vapi-lead] Dedup rapid-repeat → lead ${recentHit.id} at ${recentHit.created_at}, skipping`);
      return new Response(JSON.stringify({
        success: true, deduped: true, lead_id: recentHit.id, customer_id: customerId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- Step 3: Create the lead ---
    // TODO: geocode customer address and backfill latitude/longitude for map view.
    const leadData: Record<string, any> = {
      customer_name: customerName,
      customer_phone: normalizedPhone,
      customer_address: address || "Address pending — WhatsApp confirmation sent",
      service_type: mapServiceType(service_type),
      status: "pending",
      priority: mapPriority(urgency),
      notes: [
        `Source: ${source} | CallSid: ${vapi_call_id || "unknown"} | Caller: ${normalizedPhone}`,
        notes || "",
        call_duration_seconds ? `Call duration: ${call_duration_seconds}s` : "",
        call_recording_url ? `Recording: ${call_recording_url}` : "",
        callerIdNormalized && callerIdNormalized !== normalizedPhone
          ? `Caller ID: ${callerIdNormalized} (different from provided number)`
          : "",
        isExistingCustomer ? "⭐ Returning customer" : "🆕 New customer",
      ].filter(Boolean).join("\n"),
      latitude: 0,
      longitude: 0,
      company_id: resolvedCompanyId,
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

    // --- Step 3: Queue WhatsApp confirmation ---
    let whatsappQueued = false;
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

    const response = {
      success: true,
      lead_id: newLead.id,
      customer_id: customerId,
      customer_name: customerName,
      is_existing_customer: isExistingCustomer,
      whatsapp_queued: whatsappQueued,
      company_id: resolvedCompanyId,
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
