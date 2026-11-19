import { rejectViewerJwt } from "../_shared/auth.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendAppointmentConfirmation } from "../_shared/appointmentConfirmation.ts";
import { companyIsActive } from "../_shared/companyActive.ts";
import {
  bookingCompanyOrRefuse,
  isPlaceholderName,
  phoneRouteArgs,
  storedCallerPhone,
  withVapiCallNote,
} from "../_shared/vapiBookingCompany.ts";

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
 *   service_type: "Technical Service Call",
 *   address?: "2 Thompson Street, Strand",
 *   notes?: "Aircon not cooling",
 *   customer_name?: "Johan Botha"  // for new callers
 * }
 *
 * Creates/updates a lead AND a job record (source of truth for appointments)
 * and returns a spoken-friendly confirmation string.
 *
 * The company comes from phone_route_company (the business line and assistant),
 * the same RPC the end-of-call path uses. New customers and leads are written
 * with that company_id, and existing rows are only matched inside it. No route
 * means no insert — Mandy is told the office will phone back.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
};

const SAST_OFFSET = "+02:00";

/**
 * Classify what the caller actually wants into exactly three categories:
 *  - "New Quote"              (quote / pricing request, including quotes for new installations)
 *  - "Technical Service Call" (repairs + service / maintenance)
 *  - "New Installation"       (only when a quote is already accepted and the install is being scheduled)
 */
function classifyService(rawService: string, notes: string): { label: string; jobType: string } {
  const text = `${rawService} ${notes}`.toLowerCase();
  const has = (...words: string[]) => words.some((w) => text.includes(w));

  // Quote intent wins — even when it's a quote for a new installation.
  if (has("quote", "quotation", "estimate", "price", "pricing", "how much", "cost", "site visit", "assessment", "survey")) {
    return { label: "New Quote", jobType: "quote" };
  }
  // Confirmed installation only when the quote stage is clearly behind us.
  if (
    has("accepted the quote", "quote accepted", "approved the quote", "quote approved", "go ahead with the install", "book the installation", "schedule the installation", "confirmed installation")
  ) {
    return { label: "New Installation", jobType: "installation" };
  }
  if (has("repair", "not cooling", "not working", "broken", "leak", "noise", "noisy", "fault", "error code", "won't switch", "wont switch", "blowing warm", "gas refill", "regas", "re-gas", "service", "maintenance", "clean", "filter", "annual", "check-up", "check up")) {
    return { label: "Technical Service Call", jobType: "service" };
  }
  // Enquiries about a new unit without an accepted quote are still quote-stage.
  if (has("install", "new unit", "new aircon", "new air con", "fit a", "replacement unit", "replace the unit")) {
    return { label: "New Quote", jobType: "quote" };
  }
  return { label: "Technical Service Call", jobType: "service" };
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

  const viewerDenied = await rejectViewerJwt(req);
  if (viewerDenied) return viewerDenied;

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

    // Same RPC shape as end-of-call: the business line and the assistant, never
    // "the first company" and never a null company_id.
    const businessPhone = p.business_phone || p.called_number || null;
    const assistantId = p.assistant_id || p.vapi_assistant_id || null;
    const vapiCallId = String(p.vapi_call_id || "").trim() || null;
    const { data: lineCo, error: routeErr } = await supabase.rpc(
      "phone_route_company",
      phoneRouteArgs(businessPhone, assistantId),
    );
    if (routeErr) console.error("[book-appointment] phone_route_company failed:", routeErr);
    const companyDecision = bookingCompanyOrRefuse(lineCo as string | null);
    if ("refuse" in companyDecision) {
      console.warn("[book-appointment] no company route — not creating a customer or a lead");
      return fail(companyDecision.refuse);
    }
    const companyId = companyDecision.companyId;
    if (!(await companyIsActive(supabase, companyId))) {
      return fail("This company is archived. Say the office will phone back.");
    }

    const variants = phoneVariants(phone);
    const callerPhone = storedCallerPhone(phone);

    // --- Find or create the customer (this company only) ---
    let customer: any = null;
    if (variants.length) {
      const orFilter = [
        ...variants.map((v) => `phone.eq.${v}`),
        ...variants.map((v) => `secondary_phone.eq.${v}`),
        `normalized_phone.eq.${normalized(phone)}`,
      ].join(",");
      const { data } = await supabase
        .from("customers")
        .select("id, name, email, phone, address, primary_address_line1, company_id")
        .eq("company_id", companyId)
        .or(orFilter)
        .limit(1);
      customer = data?.[0] || null;
    }

    if (!customer && (p.customer_name || phone)) {
      const { data: created, error } = await supabase
        .from("customers")
        .insert({
          name: String(p.customer_name || "Phone Caller").trim(),
          phone: callerPhone || phone || null,
          address: p.address || null,
          status: "active",
          lead_source: "other",
          company_id: companyId,
        })
        .select("id, name, email, phone, address, primary_address_line1, company_id")
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

    const bookedName = String(p.customer_name || "").trim();
    if (bookedName && !isPlaceholderName(bookedName) && isPlaceholderName(customer.name)) {
      const { error: nameErr } = await supabase
        .from("customers")
        .update({ name: bookedName })
        .eq("id", customer.id)
        .eq("company_id", companyId);
      if (!nameErr) customer = { ...customer, name: bookedName };
    }

    // --- Resolve the service address (primary saved location wins) ---
    const { data: locs } = await supabase
      .from("customer_locations")
      .select("address, is_primary")
      .eq("customer_id", customer.id)
      .order("is_primary", { ascending: false })
      .limit(1);
    const isPlaceholder = (a?: string | null) =>
      !a || /^address (pending|to be confirmed)/i.test(String(a).trim());
    const resolvedAddress =
      String(p.address || "").trim() ||
      locs?.[0]?.address ||
      customer.primary_address_line1 ||
      (isPlaceholder(customer.address) ? "" : customer.address) ||
      "";
    const address = resolvedAddress || "Address to be confirmed";

    // Backfill any stale placeholder addresses so the dispatch board never shows "Address pending"
    // once the caller has confirmed a real address.
    if (resolvedAddress) {
      await supabase
        .from("leads")
        .update({ customer_address: resolvedAddress })
        .eq("customer_id", customer.id)
        .eq("company_id", companyId)
        .or("customer_address.is.null,customer_address.ilike.Address pending%,customer_address.ilike.Address to be confirmed%");
      await supabase
        .from("jobs")
        .update({ address: resolvedAddress })
        .eq("customer_id", customer.id)
        .eq("company_id", companyId)
        .or("address.is.null,address.eq.,address.ilike.Address pending%,address.ilike.Address to be confirmed%");
      if (isPlaceholder(customer.address)) {
        await supabase.from("customers").update({ address: resolvedAddress }).eq("id", customer.id).eq("company_id", companyId);
      }
    }

    const rawService = String(p.service_type || "").trim();
    const notes = String(p.notes || "").trim();
    const { label: serviceType, jobType } = classifyService(rawService, notes);
    // Mandy bookings: 3 h for a job, 1 h for a quote (sales) visit (Johan, 23 Oct 2026).
    const bookingMinutes = jobType === "quote" ? 60 : 180;


    // --- Reuse the caller's open lead in THIS company (unscheduled OR already scheduled = reschedule) ---
    const { data: openLeads } = await supabase
      .from("leads")
      .select("id, notes, company_id, scheduled_date, customer_name")
      .eq("customer_id", customer.id)
      .eq("company_id", companyId)
      .in("status", ["pending", "new", "converted", "accepted", "claimed", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(1);

    let leadId = openLeads?.[0]?.id || null;
    const isReschedule = !!openLeads?.[0]?.scheduled_date;
    const leadPhone = callerPhone || storedCallerPhone(customer.phone) || phone || customer.phone || "";

    if (leadId) {
      const leadPatch: Record<string, unknown> = {
        status: "accepted",
        scheduled_date: p.date,
        scheduled_time: `${String(p.time || "09:00").padStart(5, "0")}:00`,
        service_type: serviceType,
        customer_address: address,
        notes: withVapiCallNote(
          [openLeads![0].notes, notes && `${isReschedule ? "Rescheduled" : "Booked"} by phone: ${notes}`].filter(Boolean).join("\n"),
          vapiCallId,
        ),
      };
      const nameForLead = bookedName || customer.name;
      if (!isPlaceholderName(nameForLead) && isPlaceholderName(openLeads![0].customer_name)) {
        leadPatch.customer_name = nameForLead;
      }
      const { error } = await supabase
        .from("leads")
        .update(leadPatch)
        .eq("id", leadId)
        .eq("company_id", companyId);
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
          customer_phone: leadPhone,
          customer_address: address,
          service_type: serviceType,
          estimated_duration_minutes: bookingMinutes,
          status: "accepted",
          priority: "normal",
          scheduled_date: p.date,
          scheduled_time: `${String(p.time || "09:00").padStart(5, "0")}:00`,
          notes: withVapiCallNote(notes ? `Booked by phone: ${notes}` : "Booked by phone", vapiCallId),
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
    }

    // --- Create or MOVE the job (the appointment record) — never duplicate ---
    let jobCreated = false;
    let jobMoved = false;
    if (companyId) {
      const { data: existingJobs } = await supabase
        .from("jobs")
        .select("id, description, scheduled_for")
        .eq("customer_id", customer.id)
        .eq("company_id", companyId)
        .in("status", ["scheduled", "pending", "assigned", "dispatched"])
        .order("created_at", { ascending: false })
        .limit(1);

      const existingJob = existingJobs?.[0] || null;
      const existingJobId = existingJob?.id || null;

      if (existingJobId) {
        const previous = existingJob?.scheduled_for
          ? new Date(existingJob.scheduled_for).toLocaleString("en-ZA", {
              timeZone: "Africa/Johannesburg",
              weekday: "long", day: "numeric", month: "long",
              hour: "2-digit", minute: "2-digit", hour12: false,
            })
          : "unscheduled";
        const historyNote = [
          existingJob?.description || "",
          `--- Rescheduled by phone (${new Date().toISOString()}): ${previous} → ${when.spoken}${notes ? ` — ${notes}` : ""}`,
        ].filter(Boolean).join("\n");

        const { error: jobErr } = await supabase
          .from("jobs")
          .update({
            lead_id: leadId,
            title: `${serviceType} — ${customer.name}`,
            job_type: jobType,
            description: historyNote,
            address,
            scheduled_for: when.iso,
            status: "scheduled", // reschedule keeps the job's existing length
          })
          .eq("id", existingJobId)
          .eq("company_id", companyId);
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
          estimated_duration: `${bookingMinutes} minutes`,
          status: "scheduled",
          job_type: jobType,
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


    // --- WhatsApp confirmation (uses data we already captured) -------------
    let whatsappConfirmation = { sent: false, askedForEmail: false } as {
      sent: boolean; askedForEmail: boolean; error?: string;
    };
    try {
      whatsappConfirmation = await sendAppointmentConfirmation({
        supabase,
        phone: phone || customer.phone,
        customerName: customer.name,
        serviceType,
        scheduledFor: when.iso,
        address,
        customerId: customer.id,
        leadId,
        email: customer.email,
        rescheduled: jobMoved,
      });
    } catch (e) {
      console.error("[book-appointment] whatsapp confirmation failed:", e);
    }

    console.log(`[book-appointment] booked lead=${leadId} job=${jobCreated} at ${when.iso}`);

    return new Response(JSON.stringify({
      success: true,
      lead_id: leadId,
      job_created: jobCreated,
      whatsapp_sent: whatsappConfirmation.sent,
      email_requested: whatsappConfirmation.askedForEmail,
      scheduled_for: when.iso,
      address,
      result: confirmation,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[book-appointment] error:", e);
    return fail("Booking failed unexpectedly. Apologise and say the office will phone back to confirm the appointment.");
  }
});
