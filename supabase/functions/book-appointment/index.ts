import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * book-appointment
 *
 * Called by Vapi (Mandy) as a tool so she can actually CONFIRM a booking
 * during the call instead of promising a call-back.
 *
 * Body (direct or via vapi-server-event tool proxy):
 * {
 *   phone_number: "+27696838624",
 *   date: "2026-08-05",            // ISO date, SAST
 *   time: "10:00",                 // 24h HH:MM, SAST
 *   service_type: "Service / Maintenance",
 *   address?: "2 Thompson Street, Strand",
 *   notes?: "Aircon not cooling",
 *   customer_name?: "Johan Botha"  // for new callers
 * }
 *
 * Creates/updates a lead AND a job record (source of truth for appointments)
 * and returns a spoken-friendly confirmation string.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const SAST_OFFSET = "+02:00";

/**
 * Classify what the caller actually wants into a canonical service label +
 * a `jobs.job_type` value. Prevents everything defaulting to "new installation".
 */
function classifyService(rawService: string, notes: string): { label: string; jobType: string } {
  const text = `${rawService} ${notes}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  if (has("quote", "quotation", "estimate", "price for", "how much", "site visit", "assessment", "survey")) {
    return { label: "Quote / Site Visit", jobType: "survey" };
  }
  if (has("install", "new unit", "new aircon", "new air con", "fit a", "replacement unit", "replace the unit")) {
    return { label: "New Installation", jobType: "installation" };
  }
  if (has("repair", "not cooling", "not working", "broken", "leak", "noise", "noisy", "fault", "error code", "won't switch", "wont switch", "blowing warm", "gas refill", "regas", "re-gas")) {
    return { label: "Repair", jobType: "repair" };
  }
  if (has("service", "maintenance", "clean", "filter", "annual", "check-up", "check up")) {
    return { label: "Service / Maintenance", jobType: "service" };
  }
  return { label: rawService || "Service / Maintenance", jobType: "service" };
}


function phoneVariants(phone: string): string[] {
  const digits = String(phone || "").replace(/\D/g, "");
  const out: string[] = [];
  if (digits.startsWith("27") && digits.length >= 11) {
    out.push("+" + digits, "0" + digits.slice(2), digits);
  } else if (digits.startsWith("0") && digits.length === 10) {
    out.push(digits, "+27" + digits.slice(1), "27" + digits.slice(1));
  } else if (digits.length === 9) {
    out.push("0" + digits, "+27" + digits, "27" + digits);
  } else if (digits) {
    out.push(digits);
  }
  return [...new Set(out)];
}

function normalized(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.startsWith("27") ? "0" + d.slice(2) : d;
}

/** Address as it should be SPOKEN: street + suburb only, no province / postal code. */
function spokenAddress(addr: string): string {
  const parts = String(addr || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    // drop pure postal codes and province names
    .filter((p) => !/^\d{4}$/.test(p))
    .filter((p) => !/^(western cape|eastern cape|northern cape|gauteng|kwazulu[- ]natal|free state|limpopo|mpumalanga|north ?west|south africa)\b/i.test(p))
    // strip a trailing postal code glued onto a part ("Strand 7140")
    .map((p) => p.replace(/\s+\d{4}$/, "").trim())
    .filter(Boolean);
  return parts.slice(0, 2).join(", ") || String(addr || "").trim();
}

function parseWhen(date: string, time: string): { iso: string; spoken: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const t = /^\d{1,2}:\d{2}$/.test(time || "") ? time.padStart(5, "0") : "09:00";
  const iso = `${date}T${t}:00${SAST_OFFSET}`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // Spoken form: day of week + day + month, NO year.
  const spoken = d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    weekday: "long", day: "numeric", month: "long",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return { iso, spoken };
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const fail = (msg: string) =>
    new Response(JSON.stringify({ success: false, result: msg }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = req.headers.get("x-api-key");
    const expected = Deno.env.get("VAPI_WEBHOOK_SECRET");
    if (!expected || apiKey !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const p = body?.message?.functionCall?.parameters || body;

    const phone = String(p.phone_number || "").trim();
    const when = parseWhen(String(p.date || ""), String(p.time || ""));
    if (!when) {
      return fail("Booking failed: I need a full date (YYYY-MM-DD) and time. Ask the caller to confirm the exact day and time, then try again.");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const variants = phoneVariants(phone);

    // --- Find or create the customer ---
    let customer: any = null;
    if (variants.length) {
      const orFilter = [
        ...variants.map((v) => `phone.eq.${v}`),
        ...variants.map((v) => `secondary_phone.eq.${v}`),
        `normalized_phone.eq.${normalized(phone)}`,
      ].join(",");
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone, address, primary_address_line1, company_id")
        .or(orFilter)
        .limit(1);
      customer = data?.[0] || null;
    }

    if (!customer && (p.customer_name || phone)) {
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          name: String(p.customer_name || "Phone Caller").trim(),
          phone: phone || null,
          address: p.address || null,
          status: "active",
          lead_source: "other",
        })
        .select("id, name, phone, address, primary_address_line1, company_id")
        .single();
      if (error) {
        console.error("[book-appointment] customer insert failed:", error);
      } else {
        customer = created;
      }
    }

    if (!customer) {
      return fail("Booking failed: I could not create the customer record. Apologise and say the office will phone back to confirm.");
    }

    // --- Resolve the service address (primary saved location wins) ---
    const { data: locs } = await supabase
      .from("customer_locations")
      .select("address, is_primary")
      .eq("customer_id", customer.id)
      .order("is_primary", { ascending: false })
      .limit(1);
    const address =
      String(p.address || "").trim() ||
      locs?.[0]?.address ||
      customer.primary_address_line1 ||
      customer.address ||
      "Address to be confirmed";

    const rawService = String(p.service_type || "").trim();
    const notes = String(p.notes || "").trim();
    const { label: serviceType, jobType } = classifyService(rawService, notes);


    // --- Reuse the caller's open lead (unscheduled OR already scheduled = reschedule) ---
    const { data: openLeads } = await supabase
      .from("leads")
      .select("id, notes, company_id, scheduled_date")
      .eq("customer_id", customer.id)
      .in("status", ["pending", "new", "converted", "accepted", "claimed", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(1);

    let leadId = openLeads?.[0]?.id || null;
    const isReschedule = !!openLeads?.[0]?.scheduled_date;
    let companyId = openLeads?.[0]?.company_id || customer.company_id || null;

    if (leadId) {
      const { error } = await supabase
        .from("leads")
        .update({
          status: "accepted",
          scheduled_date: p.date,
          scheduled_time: `${String(p.time || "09:00").padStart(5, "0")}:00`,
          service_type: serviceType,
          customer_address: address,
          notes: [openLeads![0].notes, notes && `${isReschedule ? "Rescheduled" : "Booked"} by phone: ${notes}`].filter(Boolean).join("\n"),
        })
        .eq("id", leadId);
      if (error) {
        console.error("[book-appointment] lead update failed:", error);
        return fail("Booking failed on our side. Apologise and say the office will phone back to confirm the appointment.");
      }
    } else {
      const { data: newLead, error } = await supabase
        .from("leads")
        .insert({
          customer_id: customer.id,
          customer_name: customer.name,
          customer_phone: phone || customer.phone,
          customer_address: address,
          service_type: serviceType,
          status: "accepted",
          priority: "normal",
          scheduled_date: p.date,
          scheduled_time: `${String(p.time || "09:00").padStart(5, "0")}:00`,
          notes: notes ? `Booked by phone: ${notes}` : "Booked by phone",
          latitude: 0,
          longitude: 0,
          company_id: companyId,
        })
        .select("id, company_id")
        .single();
      if (error) {
        console.error("[book-appointment] lead insert failed:", error);
        return fail("Booking failed on our side. Apologise and say the office will phone back to confirm the appointment.");
      }
      leadId = newLead.id;
      companyId = newLead.company_id || companyId;
    }

    // --- Create or MOVE the job (the appointment record) — never duplicate ---
    let jobCreated = false;
    let jobMoved = false;
    if (companyId) {
      const { data: existingJobs } = await supabase
        .from("jobs")
        .select("id")
        .eq("customer_id", customer.id)
        .in("status", ["scheduled", "pending", "assigned", "dispatched"])
        .order("created_at", { ascending: false })
        .limit(1);

      const existingJobId = existingJobs?.[0]?.id || null;

      if (existingJobId) {
        const { error: jobErr } = await supabase
          .from("jobs")
          .update({
            lead_id: leadId,
            title: `${serviceType} — ${customer.name}`,
            job_type: jobType,

            address,
            scheduled_for: when.iso,
            status: "scheduled",
          })
          .eq("id", existingJobId);
        if (jobErr) console.error("[book-appointment] job reschedule failed:", jobErr);
        else { jobCreated = true; jobMoved = true; }
      } else {
        const { error: jobErr } = await supabase.from("jobs").insert({
          company_id: companyId,
          customer_id: customer.id,
          lead_id: leadId,
          title: `${serviceType} — ${customer.name}`,
          description: notes || `Booked by phone on ${new Date().toISOString()}`,
          address,
          scheduled_for: when.iso,
          status: "scheduled",
          job_type: "service",
          priority: "normal",
        });
        if (jobErr) console.error("[book-appointment] job insert failed:", jobErr);
        else jobCreated = true;
      }
    } else {
      console.warn("[book-appointment] no company_id — job record skipped, lead is scheduled");
    }

    const confirmation =
      `BOOKING ${jobMoved ? "MOVED" : "CONFIRMED"}. Read this back to the caller exactly, and speak it exactly as written — no year, no province, no postal code: their ${serviceType.toLowerCase()} is ${jobMoved ? "now moved to" : "booked for"} ${when.spoken} at ${spokenAddress(address)}. ` +
      `Tell them it is confirmed in the system and they will get a reminder. Do not say anyone needs to call them back.`;


    console.log(`[book-appointment] booked lead=${leadId} job=${jobCreated} at ${when.iso}`);

    return new Response(JSON.stringify({
      success: true,
      lead_id: leadId,
      job_created: jobCreated,
      scheduled_for: when.iso,
      address,
      result: confirmation,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[book-appointment] error:", e);
    return fail("Booking failed unexpectedly. Apologise and say the office will phone back to confirm the appointment.");
  }
});
