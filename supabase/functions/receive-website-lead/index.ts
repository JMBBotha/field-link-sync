import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { timingLine } from "../_shared/websiteTiming.ts";
import { sendAppointmentConfirmation } from "../_shared/appointmentConfirmation.ts";

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

const MASSAIR_COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
// Staff alert for every website lead (Johan 2026-10-14).
const STAFF_LEAD_EMAIL = "johan@0800becool.co.za";

// Lane for auto-assign (Johan 2026-10-14): quotes -> sales staff, call-outs -> technicians.
// auto-assign-lead skips leads without primary_intent, which is why website leads were never offered.
function laneFor(mappedServiceType: string): "sales" | "service" | null {
  if (mappedServiceType === "New Quote" || mappedServiceType === "New Installation") return "sales";
  if (mappedServiceType === "Technical Service Call") return "service";
  return null;
}

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
    const customerName = full_name || customerNameAlias || nameAlias || "Website Visitor";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mapboxToken = Deno.env.get("MAPBOX_ACCESS_TOKEN");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      `Source: ${source} | Phone: ${normalizedPhone}`,
      timingLine(preferred_timing, preferred_date, preferred_time),
      notes || "",
      preferred_date ? `Preferred date: ${preferred_date}` : "",
      preferred_time ? `Preferred time: ${preferred_time}` : "",
      selection_summary ? `Find Your AC selection: ${JSON.stringify(selection_summary)}` : "",
      isExistingCustomer ? "⭐ Returning customer" : "🆕 New customer (website)",
    ].filter(Boolean).join("\n");

    const mappedService = mapServiceType(service_type);
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

    // When the website form captured a preferred date, treat it as a booked
    // appointment and send the WhatsApp confirmation straight away.
    let whatsappConfirmed = false;
    let emailRequested = false;
    if (preferred_date) {
      try {
        const conf = await sendAppointmentConfirmation({
          supabase,
          phone: normalizedPhone,
          customerName,
          serviceType: mapServiceType(service_type),
          date: preferred_date,
          time: preferred_time,
          address,
          customerId,
          leadId: newLead.id,
          email: email || null,
        });
        whatsappConfirmed = conf.sent;
        emailRequested = conf.askedForEmail;
      } catch (e) {
        console.error("[receive-website-lead] confirmation send failed:", e);
      }
    }

    // New-lead emails (Johan 2026-10-14): client confirmation + staff alert, via send-transactional-email (Resend, 0800becool.co.za).
    const timing = timingLine(preferred_timing, preferred_date, preferred_time) || "";
    const detailsRows = [
      ["Name", customerName], ["Phone", normalizedPhone], ["Email", email || "-"], ["Address", address],
      ["Request", service_type || mappedService], ["Timing", timing.replace(/^Timing:\s*/, "") || "-"], ["Notes", notes || "-"],
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

    let whatsappQueued = false;
    if (customerId && !whatsappConfirmed) {
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
      lane,
      client_email_sent: clientEmail?.ok ?? false,
      staff_email_sent: staffEmail.ok,
      whatsapp_confirmation_sent: whatsappConfirmed,
      email_requested: emailRequested,
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
