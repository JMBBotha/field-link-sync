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

const SAST = "Africa/Johannesburg";

// Format date nicely, always in South African local time
function formatDate(dateStr: string | null): string {
  if (!dateStr) return "unknown date";
  // Bare date columns ("2026-08-05") must not be shifted by a timezone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split("-").map(Number);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d} ${months[m - 1]} ${y}`;
  }
  const parsed = new Date(dateStr);
  if (Number.isNaN(parsed.getTime())) return "unknown date";
  return parsed.toLocaleDateString("en-ZA", {
    timeZone: SAST,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Current date/time in SAST, spoken-friendly
function nowInSast(): string {
  return new Date().toLocaleString("en-ZA", {
    timeZone: SAST,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// "14:30:00" → "2:30 PM"
function formatTime(timeStr: string | null): string {
  if (!timeStr) return "";
  const [h, m] = String(timeStr).split(":").map(Number);
  if (Number.isNaN(h)) return "";
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m || 0).padStart(2, "0")} ${suffix}`;
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

    // --- Get recent jobs/calls (match by customer_id OR raw phone, since
    //     Vapi-created leads are not always linked to the customer record) ---
    const leadSelect =
      "id, service_type, status, notes, created_at, completed_at, scheduled_date, scheduled_time, assigned_agent_id, technician_name, technician_eta, order_status, parts_status, customer_phone, customer_address";

    const { data: leadsById } = await supabase
      .from("leads")
      .select(leadSelect)
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(5);

    const { data: leadsByPhone } = await supabase
      .from("leads")
      .select(leadSelect)
      .in("customer_phone", phoneVariants)
      .order("created_at", { ascending: false })
      .limit(5);

    const seen = new Set<string>();
    const recentLeads = [...(leadsById || []), ...(leadsByPhone || [])]
      .filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);

    // --- Get equipment ---
    const { data: equipment } = await supabase
      .from("equipment")
      .select("id, type, brand, model, serial_number, install_date, warranty_expiry, location, last_service_date")
      .eq("customer_id", customer.id)
      .order("created_at", { ascending: false })
      .limit(5);

    // --- Active/open jobs (from the merged set) ---
    const todayJobs = recentLeads.filter((l) =>
      ["pending", "accepted", "claimed", "scheduled", "in_progress"].includes((l.status || "").toLowerCase())
    );

    // --- Build context for Mandy ---
    const customerName = customer.first_name || customer.name?.split(" ")[0] || "there";
    const fullName = customer.name || `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
    const address = customer.primary_address_line1 || customer.address || "not on file";

    // Pull the human-readable gist out of a lead's notes (Vapi stores the call
    // summary first, followed by the raw transcript / metadata blocks).
    const summarizeNotes = (notes: string | null): string => {
      if (!notes) return "";
      const cleaned = notes
        .split("\n")
        .filter((line) =>
          line.trim() &&
          !/^(Transcript:|Recording:|Ended reason:|Vapi call:|Source:|---)/i.test(line.trim())
        )
        .join(" ")
        // Strip inline metadata prefixes like "Source: vapi_direct | CallSid: … | Caller: +27… "
        .replace(/^.*?\|\s*Caller:\s*\+?\d[\d\s]*/i, "")
        .replace(/\b(CallSid|Source|Recovered after)\b[^|]*\|?/gi, "")
        // Cut off where the raw transcript starts ("AI: …", "User: …")
        .split(/\b(?:AI|User|Assistant|Bot):\s/)[0]
        .trim();
      return cleaned.slice(0, 400).trim();
    };



    const describeAppointment = (lead: any): string => {
      const parts: string[] = [];
      if (lead.scheduled_date) {
        parts.push(
          `scheduled for ${formatDate(lead.scheduled_date)}${lead.scheduled_time ? ` at ${String(lead.scheduled_time).slice(0, 5)}` : ""}`
        );
      }
      if (lead.technician_name) parts.push(`technician ${lead.technician_name}`);
      if (lead.technician_eta) {
        parts.push(
          `ETA ${new Date(lead.technician_eta).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`
        );
      }
      if (lead.order_status && lead.order_status !== "not_ordered") parts.push(`order ${lead.order_status.replace(/_/g, " ")}`);
      if (lead.parts_status && lead.parts_status !== "pending") parts.push(`parts ${lead.parts_status.replace(/_/g, " ")}`);
      return parts.join(", ");
    };

    // Format job history as natural language
    const jobSummaries = recentLeads.map((lead) => {
      const dateStr = lead.completed_at || lead.created_at;
      const appt = describeAppointment(lead);
      const gist = summarizeNotes(lead.notes);
      return `- ${lead.service_type} (${lead.status}) — ${formatDate(dateStr)} (${timeAgo(dateStr)})${appt ? `; ${appt}` : ""}${gist ? `; what was discussed: ${gist}` : ""}`;
    });

    // Format equipment as natural language
    const equipmentSummaries = (equipment || []).map(eq => {
      const warranty = eq.warranty_expiry
        ? (new Date(eq.warranty_expiry) > new Date() ? "under warranty" : "warranty expired")
        : "warranty unknown";
      return `- ${eq.brand || "Unknown"} ${eq.model || ""} ${eq.type || "unit"} — installed ${formatDate(eq.install_date)}, ${warranty}, last serviced ${formatDate(eq.last_service_date)}`;
    });

    // Active jobs
    const activeJobSummaries = todayJobs.map((job) => {
      const appt = describeAppointment(job);
      return `- ${job.service_type} (${job.status})${appt ? ` — ${appt}` : " — not yet scheduled"}`;
    });

    // Last call recap — this is what makes Mandy sound like she remembers
    const lastLead = recentLeads[0] || null;
    const lastCall = lastLead
      ? {
          when: `${formatDate(lastLead.created_at)} (${timeAgo(lastLead.created_at)})`,
          service_type: lastLead.service_type,
          status: lastLead.status,
          summary: summarizeNotes(lastLead.notes) || "No summary captured.",
          appointment: describeAppointment(lastLead) || "No appointment booked yet.",
          address: lastLead.customer_address || null,
        }
      : null;

    // Build greeting hint
    let greetingHint = `This is ${fullName}, a returning customer. Greet them warmly by their first name "${customerName}".`;

    if (lastCall) {
      greetingHint += ` They last contacted us ${timeAgo(lastLead!.created_at)} about a ${lastCall.service_type} (currently ${lastCall.status}). What was discussed: ${lastCall.summary}. Appointment: ${lastCall.appointment}. Reference this naturally instead of asking them to repeat themselves.`;
    }

    if (activeJobSummaries.length > 0) {
      greetingHint += ` They have an open job — assume the call is about it unless they say otherwise.`;
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
      last_call: lastCall,
      active_jobs: activeJobSummaries,
      recent_jobs: jobSummaries,
      equipment: equipmentSummaries,
      total_jobs: recentLeads.length,
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
