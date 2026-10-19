import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingLine } from "../_shared/websiteTiming.ts";
import { corsFor, honeypotTripped, isForeignBrowserOrigin, rateLimitOk, withoutHoneypot } from "../_shared/websitePublic.ts";
import { laneFor, mapServiceType, normaliseForm, requestedTimeLine } from "../_shared/websiteLeadMap.ts";

/**
 * receive-website-lead
 *
 * Public webhook that receives leads from the AC Connection Hub marketing
 * website (Book a Service form + Find Your AC selection wizard).
 * Mirrors receive-vapi-lead's customer-matching / company resolution logic,
 * but geocodes the address up front (website leads always have an address)
 * so the existing trigger_auto_assign_lead DB trigger can broadcast the
 * lead to nearby agents immediately on insert.
 *
 * 2026-10-19 (Johan 06:26, website step 1): CORS allow-list, honeypot, per-IP rate limit (5 / 10 min),
 * raw_payload + form tag (booking | find-ac | packs | selection | shop), lane-map fix (quote accepted ->
 * installation), a preferred date is stored as a REQUEST only (no leads.scheduled_*, no appointment
 * confirmation), and client confirmations are EMAIL ONLY (no WhatsApp confirmation or WhatsApp queue).
 */

const MASSAIR_COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
// Staff alert for every website lead (Johan 2026-10-14).
const STAFF_LEAD_EMAIL = "johan@0800becool.co.za";

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function emailShell(inner: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2937">` +
    `<div style="max-width:600px;margin:0 auto;padding:24px 16px">` +
    `<div style="background:#0e7bbf;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0;font-size:20px;font-weight:bold">0800-BE-COOL! <span style="font-size:13px;font-weight:normal">AC Super Service</span></div>` +
    `<div style="background:#fff;padding:22px;border-radius:0 0 10px 10px;font-size:15px;line-height:1.55">${inner}</div>` +
    `</div></body></html>`;
}

// deno-lint-ignore no-explicit-any
async function sendEmail(supabase: any, payload: Record<string, unknown>): Promise<{ ok: boolean; detail?: string }> {
  try {
    const { data: cfg } = await supabase.from("app_webhook_config").select("email_webhook_token").eq("id", 1).single();
    if (!cfg?.email_webhook_token) return { ok: false, detail: "no email webhook token" };
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-email-webhook-token": String(cfg.email_webhook_token) },
      body: JSON.stringify(payload),
    });
    const body = await r.text();
    return { ok: r.ok, detail: body.slice(0, 500) };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

const clip = (v: unknown, n: number): string => String(v ?? "").trim().slice(0, n);

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
  const corsHeaders = corsFor(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (isForeignBrowserOrigin(req)) {
    return new Response(JSON.stringify({ error: "Origin not allowed" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const rawBody = await req.json().catch(() => null);
    if (!rawBody || typeof rawBody !== "object") {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Honeypot: a bot filled the hidden field. Pretend success, store nothing, send nothing.
    if (honeypotTripped(rawBody)) {
      console.log("[receive-website-lead] honeypot tripped, dropped");
      return new Response(JSON.stringify({ success: true, message: "Lead received — a specialist will be in touch shortly." }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mapboxToken = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Basic spam protection: 5 leads per IP per 10 minutes.
    if (!(await rateLimitOk(supabase, req, "website-lead", 5, 600))) {
      return new Response(JSON.stringify({ success: false, error: "Too many requests. Please call (021) 802 2889 or WhatsApp 069 683 8624." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = withoutHoneypot(rawBody) as Record<string, any>;
    console.log("[receive-website-lead] Incoming fields:", Object.keys(body).join(","));

    const {
      full_name,
      customer_name: customerNameAlias,
      name: nameAlias,
      phone,
      email,
      service_type,
      address,
      notes,
      urgency,
      preferred_date,
      preferred_time,
      preferred_timing,
      source: rawSource,
      selection_summary,
      form: rawForm,
      company_id: bodyCompanyId,
    } = body;
    const source = clip(rawSource || "website", 40);
    const form = normaliseForm(rawForm ?? (rawSource === "website" ? "booking" : rawSource));

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

    if (String(phone).replace(/\D/g, "").length < 9) {
      return new Response(JSON.stringify({ error: "phone looks too short" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedPhone = normalizePhone(String(phone));
    const customerName = clip(full_name || customerNameAlias || nameAlias, 120) || "Website Visitor";



    // 0800-BE-COOL website belongs to Massair CT (Johan 2026-10-13): website leads ALWAYS
    // go to Massair, and customer matching only looks inside Massair. Never another company.
    const resolvedCompanyId: string = MASSAIR_COMPANY_ID;
    void bodyCompanyId;

    let customerId: string | null = null;
    let isExistingCustomer = false;

    const { data: massairMatch } = await supabase
      .from("customers")
      .select("id")
      .eq("company_id", resolvedCompanyId)
      .eq("phone", normalizedPhone)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (massairMatch?.id) {
      customerId = massairMatch.id;
      isExistingCustomer = true;
      console.log(`[receive-website-lead] Matched existing Massair customer: ${customerId}`);
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
      `Source: ${source} (${form}) | Phone: ${normalizedPhone}`,
      timingLine(preferred_timing, preferred_date, preferred_time),
      clip(notes, 2000),
      requestedTimeLine(preferred_date, preferred_time),
      selection_summary ? `Website selection: ${JSON.stringify(selection_summary).slice(0, 1500)}` : "",
      isExistingCustomer ? "⭐ Returning customer" : "🆕 New customer (website)",
    ].filter(Boolean).join("\n");

    const mappedService = mapServiceType(service_type, form);
    const lane = laneFor(mappedService);
    const leadData: Record<string, any> = {
      customer_name: customerName,
      email: email || null,
      source: "website_form",
      primary_intent: lane,
      customer_phone: normalizedPhone,
      customer_address: address,
      service_type: mappedService,
      status: "pending",
      priority: mapPriority(urgency),
      notes: noteLines,
      latitude: geo?.lat ?? 0,
      longitude: geo?.lng ?? 0,
      company_id: resolvedCompanyId,
      // A preferred date is a request, not a booking: never written to scheduled_date/scheduled_time.
      raw_payload: {
        source: "website",
        form,
        service_type: clip(service_type, 200) || null,
        selection_summary: selection_summary ?? null,
        requested: { timing: preferred_timing ?? null, date: preferred_date ?? null, time: preferred_time ?? null },
        received_at: new Date().toISOString(),
      },
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

    // Email confirmations only (Johan 2026-10-19): no WhatsApp appointment confirmation, no WhatsApp queue.
    const whatsappConfirmed = false;
    const emailRequested = false;
    const requestedTime = !!(preferred_date || preferred_time);

    // New-lead emails (Johan 2026-10-14): client confirmation + staff alert, via send-transactional-email (Resend, 0800becool.co.za).
    const timing = timingLine(preferred_timing, preferred_date, preferred_time) || "";
    const detailsRows = [
      ["Name", customerName], ["Phone", normalizedPhone], ["Email", email || "-"], ["Address", address],
      ["Request", clip(service_type, 200) || mappedService], ["Timing", (timing.replace(/^Timing:\s*/, "") || "-") + (requestedTime ? " (requested, not booked yet)" : "")], ["Notes", clip(notes, 2000) || "-"],
    ].map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#6b7280;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("");
    let clientEmail: { ok: boolean; detail?: string } | null = null;
    if (email) {
      clientEmail = await sendEmail(supabase, {
        to: email,
        subject: "We've received your request - 0800-BE-COOL",
        company_id: resolvedCompanyId,
        signature_mode: "company",
        html: emailShell(
          `<p>Hi ${esc(customerName.split(" ")[0])},</p>` +
          `<p>Thank you for contacting 0800-BE-COOL. We've received your request and one of our team will be in touch shortly.</p>` +
          (requestedTime ? `<p><b>Your time isn't booked yet.</b> We'll contact you to confirm a time that works.</p>` : "") +
          `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">${detailsRows}</table>` +
          `<p>Need us sooner? Call (021) 802 2889 or WhatsApp 069 683 8624.</p>`,
        ),
      });
    }
    const staffEmail = await sendEmail(supabase, {
      to: STAFF_LEAD_EMAIL,
      subject: `New website lead: ${customerName} - ${mappedService}${lane ? ` (${lane})` : " (needs a lane)"}`,
      company_id: resolvedCompanyId,
      signature_mode: "company",
      reply_to: email || undefined,
      html: emailShell(
        `<p><b>New website lead</b> for Massair CT (Pty) Ltd.</p>` +
        `<table style="border-collapse:collapse;font-size:14px;margin:12px 0">${detailsRows}` +
        `<tr><td style="padding:4px 10px 4px 0;color:#6b7280">Lane</td><td>${esc(lane ?? "none - assign manually")}</td></tr>` +
        `<tr><td style="padding:4px 10px 4px 0;color:#6b7280">Lead ID</td><td>${esc(newLead.id)}</td></tr></table>`,
      ),
    });
    if (clientEmail && !clientEmail.ok) console.error("[receive-website-lead] client email failed:", clientEmail.detail);
    if (!staffEmail.ok) console.error("[receive-website-lead] staff email failed:", staffEmail.detail);

    const whatsappQueued = false;

    const response = {
      success: true,
      lead_id: newLead.id,
      customer_id: customerId,
      customer_name: customerName,
      is_existing_customer: isExistingCustomer,
      geocoded: !!geo,
      whatsapp_queued: whatsappQueued,
      lane,
      client_email_sent: clientEmail?.ok ?? false,
      staff_email_sent: staffEmail.ok,
      whatsapp_confirmation_sent: whatsappConfirmed,
      email_requested: emailRequested,
      company_id: resolvedCompanyId,
      form,
      message: requestedTime
        ? "Request received — we'll contact you to confirm your time."
        : "Lead received — a specialist will be in touch shortly.",
    };

    console.log("[receive-website-lead] Success:", JSON.stringify({ lead_id: newLead.id, lane, form, staff_email_sent: staffEmail.ok }));

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
