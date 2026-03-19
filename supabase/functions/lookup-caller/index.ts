import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * lookup-caller
 * 
 * Called by Vapi as a "function call" tool at the start of each inbound call.
 * Takes the caller's phone number and returns customer context so the AI
 * assistant (Mandy) can greet returning customers by name and reference
 * their job history.
 * 
 * Vapi sends this as a tool/function call. The response is injected into
 * the conversation context so Mandy can use it naturally.
 * 
 * POST body (from Vapi function calling):
 * {
 *   message: {
 *     type: "function-call",
 *     functionCall: {
 *       name: "lookup_caller",
 *       parameters: {
 *         phone_number: "+27XXXXXXXXX"
 *       }
 *     }
 *   }
 * }
 * 
 * OR simplified direct call:
 * {
 *   phone_number: "+27XXXXXXXXX"
 * }
 * 
 * Returns customer info + last 5 jobs + equipment list for context.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

// Normalize SA phone numbers for database lookup
function normalizeForLookup(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  const variants: string[] = [];

  // +27XXXXXXXXX format
  if (digits.startsWith("27") && digits.length >= 11) {
    variants.push("+" + digits);
    variants.push("+27" + digits.slice(2));
    variants.push("0" + digits.slice(2));
  }
  // 0XXXXXXXXX format
  else if (digits.startsWith("0") && digits.length === 10) {
    variants.push(digits);
    variants.push("+27" + digits.slice(1));
    variants.push("27" + digits.slice(1));
  }
  // 9-digit without leading 0
  else if (digits.length === 9) {
    variants.push("0" + digits);
    variants.push("+27" + digits);
    variants.push("27" + digits);
  }
  // Fallback
  else {
    variants.push(phone);
    variants.push(digits);
  }

  return [...new Set(variants)];
}

// Format date nicely
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "unknown date";
  const d = new Date(dateStr);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Calculate time ago
function timeAgo(dateStr: string): string {
  const now = new Date();
  const then = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth: check API key ---
    const apiKey = req.headers.get("x-api-key");
    const expectedKey = Deno.env.get("VAPI_WEBHOOK_SECRET");

    if (!expectedKey || apiKey !== expectedKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- Parse body (handle both Vapi function-call format and direct) ---
    const body = await req.json();
    let phoneNumber: string;

    if (body.message?.functionCall?.parameters?.phone_number) {
      // Vapi function-call format
      phoneNumber = body.message.functionCall.parameters.phone_number;
    } else if (body.phone_number) {
      // Direct call format
      phoneNumber = body.phone_number;
    } else {
      return new Response(JSON.stringify({
        result: "No phone number provided. Treat this as a new caller and ask for their name.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[lookup-caller] Looking up: ${phoneNumber}`);

    // --- Init Supabase ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // --- Search for customer by phone variants ---
    const phoneVariants = normalizeForLookup(phoneNumber);
    console.log(`[lookup-caller] Phone variants:`, phoneVariants);

    let customer = null;

    // Try each phone variant against the customers table
    for (const variant of phoneVariants) {
      const { data } = await supabase
        .from("customers")
        .select("id, name, first_name, last_name, phone, email, address, primary_address_line1, city, status, secondary_phone")
        .or(`phone.eq.${variant},secondary_phone.eq.${variant},normalized_phone.eq.${variant.replace(/\D/g, "").replace(/^27/, "0")}`)
        .limit(1)
        .single();

      if (data) {
        customer = data;
        break;
      }
    }

    // --- No match: new caller ---
    if (!customer) {
      console.log("[lookup-caller] No customer found — new caller");
      return new Response(JSON.stringify({
        result: JSON.stringify({
          is_existing_customer: false,
          greeting_hint: "This is a new caller. Ask for their name and how you can help them.",
          customer: null,
          recent_jobs: [],
          equipment: [],
        }),
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[lookup-caller] Found customer: ${customer.name} (${customer.id})`);

    // --- Get recent jobs (last 5 leads for this customer) ---
    const { data: recentLeads } = await supabase
      .from("leads")
      .select("id, service_type, status, notes, created_at, completed_at, scheduled_date, assigned_agent_id")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // --- Get equipment ---
    const { data: equipment } = await supabase
      .from("equipment")
      .select("id, type, brand, model, serial_number, install_date, warranty_expiry, location, last_service_date")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // --- Get any active/pending leads (today's jobs) ---
    const today = new Date().toISOString().split("T")[0];
    const { data: todayJobs } = await supabase
      .from("leads")
      .select("id, service_type, status, scheduled_date, scheduled_time, assigned_agent_id")
      .eq("customer_id", customer.id)
      .in("status", ["pending", "accepted", "in_progress"])
      .order("scheduled_date", { ascending: true })
      .limit(3);

    // --- Build context for Mandy ---
    const customerName = customer.first_name || customer.name?.split(" ")[0] || "there";
    const fullName = customer.name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
    const address = customer.primary_address_line1 || customer.address || "not on file";

    // Format job history as natural language
    const jobSummaries = (recentLeads || []).map(lead => {
      const dateStr = lead.completed_at || lead.created_at;
      return `- ${lead.service_type} (${lead.status}) — ${formatDate(dateStr)} (${timeAgo(dateStr)})`;
    });

    // Format equipment as natural language
    const equipmentSummaries = (equipment || []).map(eq => {
      const warranty = eq.warranty_expiry
        ? (new Date(eq.warranty_expiry) > new Date() ? "under warranty" : "warranty expired")
        : "warranty unknown";
      return `- ${eq.brand || "Unknown"} ${eq.model || ""} ${eq.type || "unit"} — installed ${formatDate(eq.install_date)}, ${warranty}, last serviced ${formatDate(eq.last_service_date)}`;
    });

    // Active jobs
    const activeJobSummaries = (todayJobs || []).map(job => {
      return `- ${job.service_type} (${job.status}) — scheduled ${job.scheduled_date || "unscheduled"}${job.scheduled_time ? ` at ${job.scheduled_time}` : ""}`;
    });

    // Build greeting hint
    let greetingHint = `This is ${fullName}, a returning customer. Greet them warmly by their first name "${customerName}".`;
    
    if (activeJobSummaries.length > 0) {
      greetingHint += ` They have active jobs — ask if they're calling about one of those.`;
    } else if (jobSummaries.length > 0) {
      const lastJob = recentLeads![0];
      greetingHint += ` Their last job was a ${lastJob.service_type} (${timeAgo(lastJob.completed_at || lastJob.created_at)}).`;
    }

    if (equipmentSummaries.length > 0) {
      const eq = equipment![0];
      greetingHint += ` They have a ${eq.brand || ""} ${eq.model || ""} system on file.`;
    }

    const result = {
      is_existing_customer: true,
      greeting_hint: greetingHint,
      customer: {
        id: customer.id,
        name: fullName,
        first_name: customerName,
        phone: customer.phone,
        email: customer.email || null,
        address: address,
        city: customer.city || null,
        status: customer.status,
      },
      active_jobs: activeJobSummaries,
      recent_jobs: jobSummaries,
      equipment: equipmentSummaries,
      total_jobs: recentLeads?.length || 0,
      total_equipment: equipment?.length || 0,
    };

    console.log("[lookup-caller] Returning context for:", fullName);

    return new Response(JSON.stringify({
      result: JSON.stringify(result),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("[lookup-caller] Error:", error);
    return new Response(JSON.stringify({
      result: "Error looking up caller. Treat as new caller and ask for their name.",
    }), {
      status: 200, // Return 200 so Vapi doesn't fail the call
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
