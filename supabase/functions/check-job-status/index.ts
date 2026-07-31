import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * check-job-status
 *
 * Called by Vapi (Mandy) as a function/tool call so she can give callers a
 * real-time update on their job pipeline.
 *
 * POST body (Vapi function-call format or direct):
 *   { phone_number: "+27XXXXXXXXX" }  or  { lead_id: "uuid" }
 *
 * Returns a natural-language `status_summary` plus the raw pipeline fields.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

function normalizeForLookup(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants: string[] = [];

  if (digits.startsWith("27") && digits.length >= 11) {
    variants.push("+" + digits);
    variants.push("+27" + digits.slice(2));
    variants.push("0" + digits.slice(2));
  } else if (digits.startsWith("0") && digits.length === 10) {
    variants.push(digits);
    variants.push("+27" + digits.slice(1));
    variants.push("27" + digits.slice(1));
  } else if (digits.length === 9) {
    variants.push("0" + digits);
    variants.push("+27" + digits);
    variants.push("27" + digits);
  } else {
    variants.push(phone);
    variants.push(digits);
  }

  return [...new Set(variants)];
}

const humanize = (v?: string | null) => (v ? v.replace(/_/g, " ") : null);

function formatEta(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Always speak the ETA in South African local time.
  const parts = new Intl.DateTimeFormat("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")} at ${get("hour")}:${get("minute")}`;
}

function buildSummary(lead: any): string {
  const parts: string[] = [];
  const service = lead.service_type || "job";
  parts.push(`Their ${service} job is currently ${humanize(lead.status) || "open"}.`);

  if (lead.order_status) {
    const orderPhrases: Record<string, string> = {
      not_ordered: "The order has not been placed yet.",
      ordered: "The order has been placed with the supplier.",
      in_stock: "The order is in stock at our warehouse.",
      delivered: "The order has been delivered.",
    };
    parts.push(orderPhrases[lead.order_status] || `Order status: ${humanize(lead.order_status)}.`);
  }

  if (lead.parts_status) {
    const partsPhrases: Record<string, string> = {
      pending: "Parts are still pending.",
      in_stock: "The required parts are in stock.",
      backordered: "The parts are on backorder, so there may be a delay.",
    };
    parts.push(partsPhrases[lead.parts_status] || `Parts status: ${humanize(lead.parts_status)}.`);
  }

  const eta = formatEta(lead.technician_eta);
  if (lead.technician_name && eta) {
    parts.push(`${lead.technician_name} is assigned and expected ${eta}.`);
  } else if (lead.technician_name) {
    parts.push(`${lead.technician_name} is assigned to the job.`);
  } else if (eta) {
    parts.push(`A technician is expected ${eta}.`);
  } else {
    parts.push("A technician has not been scheduled yet.");
  }

  return parts.join(" ");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: same pattern as lookup-caller ---
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");

    if (!expectedKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const params = body.message?.functionCall?.parameters ?? body;
    const phoneNumber: string | undefined = params.phone_number;
    const leadId: string | undefined = params.lead_id;

    if (!phoneNumber && !leadId) {
      return new Response(JSON.stringify({
        result: JSON.stringify({
          found: false,
          status_summary: "No phone number or job reference was provided, so I can't look up a job status. Ask the caller for the number the job was booked under.",
        }),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const SELECT =
      "id, customer_name, customer_phone, service_type, status, scheduled_date, scheduled_time, order_status, parts_status, technician_name, technician_eta, created_at";

    let lead: any = null;

    if (leadId) {
      const { data } = await supabase.from("leads").select(SELECT).eq("id", leadId).maybeSingle();
      lead = data;
    } else if (phoneNumber) {
      const variants = normalizeForLookup(phoneNumber);
      console.log("[check-job-status] Phone variants:", variants);

      // Prefer an active lead; fall back to the most recent lead of any status.
      const { data: active } = await supabase
        .from("leads")
        .select(SELECT)
        .in("customer_phone", variants)
        .in("status", ["pending", "accepted", "claimed", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);

      lead = active?.[0] ?? null;

      if (!lead) {
        const { data: recent } = await supabase
          .from("leads")
          .select(SELECT)
          .in("customer_phone", variants)
          .order("created_at", { ascending: false })
          .limit(1);
        lead = recent?.[0] ?? null;
      }
    }

    if (!lead) {
      return new Response(JSON.stringify({
        result: JSON.stringify({
          found: false,
          status_summary: "I couldn't find any job on file for that number. Offer to log a new job for them.",
        }),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = {
      found: true,
      status_summary: buildSummary(lead),
      lead_id: lead.id,
      customer_name: lead.customer_name,
      service_type: lead.service_type,
      status: lead.status,
      scheduled_date: lead.scheduled_date || null,
      scheduled_time: lead.scheduled_time || null,
      order_status: lead.order_status || null,
      parts_status: lead.parts_status || null,
      technician_name: lead.technician_name || null,
      technician_eta: lead.technician_eta || null,
    };

    console.log("[check-job-status] Returning status for lead:", lead.id);

    return new Response(JSON.stringify({ result: JSON.stringify(result) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[check-job-status] Error:", error);
    return new Response(JSON.stringify({
      result: JSON.stringify({
        found: false,
        status_summary: "I had trouble checking the job status just now. Offer to take a message and have the team call back.",
      }),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
