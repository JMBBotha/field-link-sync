import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * receive-website-lead
 *
 * Public webhook that receives leads from the AC Connection Hub marketing
 * website (Book a Service form + Find Your AC selection wizard).
 * Mirrors receive-vapi-lead's customer-matching / company resolution logic,
 * but geocodes the address up front (website leads always have an address)
 * so the existing trigger_auto_assign_lead DB trigger can broadcast the
 * lead to nearby agents immediately on insert.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function normalizePhone(phone: string): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 10) {
    digits = "27" + digits.slice(1);
  } else if (!digits.startsWith("27") && digits.length === 9) {
    digits = "27" + digits;
  }
  return "+" + digits;
}

function mapPriority(urgency?: string): string {
  switch ((urgency || "").toLowerCase()) {
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
  if (lower.includes("quote") || lower.includes("price") || lower.includes("estimate") || lower.includes("selection") || lower.includes("how much")) return "New Quote";
  if (lower.includes("quote accepted") || lower.includes("book the installation")) return "New Installation";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken") || lower.includes("super service") || lower.includes("maintain") || lower.includes("service plan") || lower.includes("service")) return "Technical Service Call";
  if (lower.includes("install") || lower.includes("new")) return "New Quote";
  return raw;
}

async function geocode(address: string, mapboxToken: string | undefined): Promise<{ lat: number; lng: number } | null> {
  if (!mapboxToken || !address || address.trim().length < 3) return null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json` +
      `?access_token=${mapboxToken}&limit=1&country=za`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const feat = data?.features?.[0];
    if (!feat) return null;
    const [lng, lat] = feat.center as [number, number];
    return { lat, lng };
  } catch {
    return null;
  }
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
    console.log("[receive-website-lead] Incoming:", JSON.stringify(body));

    const {
      full_name,
      phone,
      email,
      service_type,
      address,
      notes,
      urgency,
      preferred_date,
      preferred_time,
      source = "website",
      selection_summary,
      company_id: bodyCompanyId,
    } = body;

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!address) {
      return new Response(JSON.stringify({ error: "address is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(phone);
    const customerName = full_name || "Website Visitor";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mapboxToken = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let resolvedCompanyId: string | null = bodyCompanyId || null;

    let customerId: string | null = null;
    let isExistingCustomer = false;

    const { data: phoneMatch } = await supabase
      .rpc("check_customer_duplicates", {
        p_phone: normalizedPhone,
        p_first_name: customerName.split(" ")[0] || null,
        p_last_name: customerName.split(" ").slice(1).join(" ") || null,
      });

    if (phoneMatch && phoneMatch.length > 0 && phoneMatch[0].match_score >= 0.8) {
      customerId = phoneMatch[0].id;
      isExistingCustomer = true;
      console.log(`[receive-website-lead] Matched existing customer: ${customerId}`);
      if (!resolvedCompanyId) {
        const { data: custData } = await supabase
          .from("customers")
          .select("company_id")
          .eq("id", customerId)
          .single();
        if (custData?.company_id) resolvedCompanyId = custData.company_id;
      }
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

    if (!customerId) {
      const firstName = customerName.split(" ")[0] || "Website";
      const lastName = customerName.split(" ").slice(1).join(" ") || "Visitor";

      const { data: newCustomer, error: custError } = await supabase
        .from("customers")
        .insert({
          name: customerName,
          first_name: firstName,
          last_name: lastName,
          phone: normalizedPhone,
          email: email || null,
          address: address,
          status: "lead",
          lead_source: source,
          company_id: resolvedCompanyId,
        })
        .select("id")
        .single();

      if (custError) {
        console.error("[receive-website-lead] Customer create error:", custError);
      } else {
        customerId = newCustomer.id;
        console.log(`[receive-website-lead] Created new customer: ${customerId}`);
      }
    } else if (email) {
      await supabase
        .from("customers")
        .update({ email })
        .eq("id", customerId)
        .is("email", null);
    }

    const geo = await geocode(address, mapboxToken);

    const noteLines = [
      `Source: ${source} | Phone: ${normalizedPhone}`,
      notes || "",
      preferred_date ? `Preferred date: ${preferred_date}` : "",
      preferred_time ? `Preferred time: ${preferred_time}` : "",
      selection_summary ? `Find Your AC selection: ${JSON.stringify(selection_summary)}` : "",
      isExistingCustomer ? "⭐ Returning customer" : "🆕 New customer (website)",
    ].filter(Boolean).join("\n");

    const leadData: Record<string, any> = {
      customer_name: customerName,
      customer_phone: normalizedPhone,
      customer_address: address,
      service_type: mapServiceType(service_type),
      status: "pending",
      priority: mapPriority(urgency),
      notes: noteLines,
      latitude: geo?.lat ?? 0,
      longitude: geo?.lng ?? 0,
      company_id: resolvedCompanyId,
      scheduled_date: preferred_date || null,
      scheduled_time: preferred_time || null,
    };
    if (customerId) leadData.customer_id = customerId;

    const { data: newLead, error: leadError } = await supabase
      .from("leads")
      .insert(leadData)
      .select("id, customer_name, customer_phone, status")
      .single();

    if (leadError) {
      console.error("[receive-website-lead] Lead create error:", leadError);
      return new Response(JSON.stringify({
        success: false,
        error: "Failed to create lead",
        detail: leadError.message,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[receive-website-lead] Lead created: ${newLead.id} (geocoded: ${!!geo})`);

    let whatsappQueued = false;
    if (customerId) {
      try {
        const { error: notifError } = await supabase
          .from("notification_queue")
          .insert({
            customer_id: customerId,
            lead_id: newLead.id,
            notification_type: "lead_confirmation",
            channel: "whatsapp",
            recipient_phone: normalizedPhone,
            body: `Hi ${customerName.split(" ")[0]}! 👋 Thanks for your request on 0800BeCool.co.za. ` +
              `We've received your ${mapServiceType(service_type).toLowerCase()} request and a specialist will be in touch shortly. 🏠`,
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
          console.error("[receive-website-lead] WhatsApp queue error:", notifError);
        } else {
          whatsappQueued = true;
        }
      } catch (e) {
        console.error("[receive-website-lead] WhatsApp queue exception:", e);
      }
    }

    const response = {
      success: true,
      lead_id: newLead.id,
      customer_id: customerId,
      customer_name: customerName,
      is_existing_customer: isExistingCustomer,
      geocoded: !!geo,
      whatsapp_queued: whatsappQueued,
      company_id: resolvedCompanyId,
      message: "Lead received — a specialist will be in touch shortly.",
    };

    console.log("[receive-website-lead] Success:", JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[receive-website-lead] Unhandled error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Internal server error",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
