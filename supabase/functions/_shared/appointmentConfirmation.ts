/**
 * Appointment confirmation over WhatsApp.
 *
 * Single place that builds + sends the "your appointment is confirmed" message
 * from data we ALREADY hold on the lead / job / customer, and (when we have no
 * email on file) asks the customer to reply with their email address.
 *
 * The pending email request is recorded in `whatsapp_conversation_state` so the
 * Twilio inbound webhook can match the reply back to the right customer/lead.
 */

import { sendWhatsApp, toE164 } from "./whatsapp.ts";

export interface ConfirmationInput {
  supabase: any;
  phone: string;
  customerName?: string | null;
  serviceType?: string | null;
  /** ISO datetime (preferred) OR pass date + time. */
  scheduledFor?: string | null;
  date?: string | null;
  time?: string | null;
  address?: string | null;
  customerId?: string | null;
  leadId?: string | null;
  jobId?: string | null;
  /** Email already on record — when present we skip the email prompt. */
  email?: string | null;
  /** true when the appointment was moved rather than newly booked. */
  rescheduled?: boolean;
}

export interface ConfirmationResult {
  sent: boolean;
  askedForEmail: boolean;
  sid?: string;
  error?: string;
}

const SAST = "Africa/Johannesburg";

function toIso(input: ConfirmationInput): string | null {
  if (input.scheduledFor) {
    const d = new Date(input.scheduledFor);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    const t = /^\d{1,2}:\d{2}/.test(String(input.time || ""))
      ? String(input.time).slice(0, 5).padStart(5, "0")
      : "09:00";
    const d = new Date(`${input.date}T${t}:00+02:00`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

export function formatWhen(iso: string): { day: string; time: string } {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString("en-ZA", {
      timeZone: SAST,
      weekday: "long",
      day: "numeric",
      month: "long",
    }),
    time: d.toLocaleTimeString("en-ZA", {
      timeZone: SAST,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  };
}

/** Human address — drop postal codes / province noise for the message. */
export function tidyAddress(addr?: string | null): string {
  const parts = String(addr || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^\d{4}$/.test(p))
    .map((p) => p.replace(/\s+\d{4}$/, "").trim())
    .filter(Boolean);
  return parts.slice(0, 3).join(", ");
}

export function isPlaceholderAddress(addr?: string | null): boolean {
  return !addr || /^address (pending|to be confirmed)/i.test(String(addr).trim());
}

export function buildConfirmationMessage(opts: {
  firstName: string;
  serviceType: string;
  day: string;
  time: string;
  address: string;
  rescheduled?: boolean;
  askEmail: boolean;
}): string {
  const lines = [
    `Hi ${opts.firstName}! 👋`,
    "",
    opts.rescheduled
      ? "Your 0800-BE-COOL appointment has been *moved*. Here are the new details:"
      : "Your 0800-BE-COOL appointment is *confirmed*:",
    "",
    `🛠 ${opts.serviceType}`,
    `📅 ${opts.day}`,
    `⏰ ${opts.time}`,
  ];
  if (opts.address) lines.push(`📍 ${opts.address}`);
  lines.push("", "Our technician will call you before arriving.");
  if (opts.askEmail) {
    lines.push(
      "",
      "📧 One quick thing — we don't have your email address yet. Please *reply to this message with your email* so we can send your quote, invoice and job report.",
    );
  }
  lines.push("", "Need to change anything? Just reply here.");
  return lines.join("\n");
}

export async function sendAppointmentConfirmation(
  input: ConfirmationInput,
): Promise<ConfirmationResult> {
  const { supabase } = input;

  const phone = input.phone ? toE164(input.phone) : "";
  if (!phone) return { sent: false, askedForEmail: false, error: "no phone" };

  const iso = toIso(input);
  if (!iso) return { sent: false, askedForEmail: false, error: "no appointment time" };

  // Fill any gaps from the records we already have — never ask the customer.
  let customerName = input.customerName?.trim() || "";
  let email = input.email?.trim() || "";
  let address = input.address?.trim() || "";
  let customerId = input.customerId || null;

  if (customerId) {
    const { data: cust } = await supabase
      .from("customers")
      .select("id, name, first_name, email, address, primary_address_line1")
      .eq("id", customerId)
      .maybeSingle();
    if (cust) {
      customerName = customerName || cust.first_name || cust.name || "";
      email = email || cust.email || "";
      if (isPlaceholderAddress(address)) {
        address = cust.primary_address_line1 || cust.address || address;
      }
    }
  }

  if (input.leadId && (!customerName || !address || !customerId)) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, customer_id, customer_name, customer_address, email, service_type")
      .eq("id", input.leadId)
      .maybeSingle();
    if (lead) {
      customerId = customerId || lead.customer_id;
      customerName = customerName || lead.customer_name || "";
      email = email || lead.email || "";
      if (isPlaceholderAddress(address)) address = lead.customer_address || address;
    }
  }

  const firstName = (customerName || "there").split(" ")[0];
  const when = formatWhen(iso);
  const askEmail = !email;

  const body = buildConfirmationMessage({
    firstName,
    serviceType: input.serviceType?.trim() || "Service appointment",
    day: when.day,
    time: when.time,
    address: isPlaceholderAddress(address) ? "" : tidyAddress(address),
    rescheduled: input.rescheduled,
    askEmail,
  });

  const statusCallbackUrl = Deno.env.get("TWILIO_WHATSAPP_WEBHOOK_URL")?.trim() || undefined;
  const result = await sendWhatsApp({ to: phone, body, statusCallbackUrl });

  // Always log the attempt so the team can see the conversation.
  await supabase.from("whatsapp_messages").insert({
    direction: "outbound",
    environment: result.environment,
    provider_sid: result.sid ?? null,
    from_number: Deno.env.get("TWILIO_WHATSAPP_NUMBER")?.trim() || "system",
    to_number: phone,
    body,
    status: result.ok ? (result.status ?? "queued") : "failed",
    error_message: result.ok ? null : (result.error ?? null),
    customer_id: customerId,
    lead_id: input.leadId ?? null,
    raw: { kind: "appointment_confirmation", scheduled_for: iso, asked_for_email: askEmail },
  });

  if (!result.ok) {
    console.error("[appointment-confirmation] send failed", result.error);
    return { sent: false, askedForEmail: false, error: result.error };
  }

  if (askEmail) {
    await supabase
      .from("whatsapp_conversation_state")
      .upsert(
        {
          phone,
          state: "awaiting_email",
          customer_id: customerId,
          lead_id: input.leadId ?? null,
          job_id: input.jobId ?? null,
          context: { scheduled_for: iso, asked_at: new Date().toISOString() },
          expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        },
        { onConflict: "phone" },
      );
  }

  console.log(
    `[appointment-confirmation] sent to ${phone} lead=${input.leadId} askEmail=${askEmail}`,
  );
  return { sent: true, askedForEmail: askEmail, sid: result.sid };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Extracts an email address from a free-text WhatsApp reply, if present. */
export function extractEmail(text: string): string | null {
  const cleaned = String(text || "")
    .replace(/\s+(at|AT)\s+/g, "@")
    .replace(/\s+(dot|DOT)\s+/g, ".")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(EMAIL_RE);
  return match ? match[0].toLowerCase().replace(/[.,;:]+$/, "") : null;
}
