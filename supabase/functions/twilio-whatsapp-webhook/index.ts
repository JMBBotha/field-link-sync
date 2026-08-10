import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractEmail } from "../_shared/appointmentConfirmation.ts";
import {
  classifyInbound,
  describeWhen,
  notifyDispatchTeam,
  parseRequestedWhen,
} from "../_shared/inboundIntent.ts";
import {
  toE164,
  twilioEnvironment,
  twiml,
  verifyTwilioSignature,
} from "../_shared/whatsapp.ts";

/**
 * Twilio WhatsApp webhook.
 *
 * Handles BOTH:
 *  - inbound messages   (Body / From / To / NumMedia...)
 *  - status callbacks   (MessageStatus / MessageSid)
 *
 * Public endpoint (verify_jwt = false) — authenticity comes from the
 * X-Twilio-Signature HMAC, validated against TWILIO_AUTH_TOKEN.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const raw = await req.text();
    const form = new URLSearchParams(raw);
    const params: Record<string, string> = {};
    for (const [k, v] of form.entries()) params[k] = v;

    // Twilio signs the exact URL it was configured with.
    const url = Deno.env.get("TWILIO_WHATSAPP_WEBHOOK_URL")?.trim() || req.url;
    const signature = req.headers.get("X-Twilio-Signature");
    const valid = await verifyTwilioSignature(url, params, signature);

    if (!valid) {
      // Never process unauthenticated traffic; never leak why.
      console.error("[whatsapp-webhook] invalid Twilio signature");
      return new Response("Forbidden", { status: 403 });
    }

    const environment = twilioEnvironment();

    // ---- Status callback -------------------------------------------------
    if (params.MessageStatus && !params.Body && !params.NumMedia) {
      await supabase
        .from("whatsapp_messages")
        .update({
          status: params.MessageStatus,
          error_message: params.ErrorMessage || params.ErrorCode || null,
        })
        .eq("provider_sid", params.MessageSid);
      return twiml();
    }

    // ---- Inbound message -------------------------------------------------
    const from = toE164(String(params.From || "").replace(/^whatsapp:/i, ""));
    const to = toE164(String(params.To || "").replace(/^whatsapp:/i, ""));
    const body = params.Body ?? "";

    const mediaCount = Number(params.NumMedia || 0);
    const mediaUrls: string[] = [];
    for (let i = 0; i < mediaCount; i++) {
      const u = params[`MediaUrl${i}`];
      if (u) mediaUrls.push(u);
    }

    // Best-effort link to an existing customer / most recent lead.
    let customerId: string | null = null;
    let leadId: string | null = null;
    const last9 = from.slice(-9);

    const { data: customer } = await supabase
      .from("customers")
      .select("id")
      .ilike("phone", `%${last9}`)
      .limit(1)
      .maybeSingle();
    if (customer) customerId = customer.id;

    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .or(`phone.ilike.%${last9},customer_phone.ilike.%${last9}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lead) leadId = lead.id;

    const { error: insertError } = await supabase.from("whatsapp_messages").insert({
      direction: "inbound",
      environment,
      provider_sid: params.MessageSid || null,
      from_number: from,
      to_number: to,
      body,
      media_urls: mediaUrls,
      status: params.SmsStatus || "received",
      customer_id: customerId,
      lead_id: leadId,
      raw: params,
    });
    if (insertError) console.error("[whatsapp-webhook] log insert failed", insertError);

    console.log(
      `[whatsapp-webhook] inbound ${environment} from=${from} media=${mediaUrls.length} customer=${customerId} lead=${leadId}`,
    );

    // ---- Conversation state + intent ------------------------------------
    const { data: convState } = await supabase
      .from("whatsapp_conversation_state")
      .select("id, state, customer_id, lead_id")
      .eq("phone", from)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    const replyEmail = extractEmail(body);
    const intent = classifyInbound(body, Boolean(replyEmail));

    const targetCustomerId = convState?.customer_id || customerId;
    const targetLeadId = convState?.lead_id || leadId;

    // Opt-out handling is a legal requirement for business messaging.
    if (intent.isOptOut) {
      if (targetCustomerId) {
        await supabase
          .from("customers")
          .update({ notification_opt_in: false })
          .eq("id", targetCustomerId);
      }
      return twiml(
        "You have been unsubscribed from 0800-BE-COOL WhatsApp updates. Reply START to opt back in.",
      );
    }
    if (intent.isOptIn) {
      if (targetCustomerId) {
        await supabase
          .from("customers")
          .update({ notification_opt_in: true })
          .eq("id", targetCustomerId);
      }
      return twiml("You're subscribed again to 0800-BE-COOL WhatsApp updates.");
    }

    // A single message can carry several intents — collect every reply line
    // instead of returning on the first match.
    const replies: string[] = [];

    // ---- 1. Email capture (never swallows the rest of the message) -------
    if (replyEmail) {
      if (targetCustomerId) {
        await supabase
          .from("customers")
          .update({ email: replyEmail, normalized_email: replyEmail })
          .eq("id", targetCustomerId);
      }
      if (targetLeadId) {
        await supabase.from("leads").update({ email: replyEmail }).eq("id", targetLeadId);
      }
      if (convState?.state === "awaiting_email") {
        await supabase
          .from("whatsapp_conversation_state")
          .delete()
          .eq("id", convState.id);
      }
      console.log(
        `[whatsapp-webhook] captured email for customer=${targetCustomerId} lead=${targetLeadId}`,
      );
      replies.push(
        `Thank you! We've saved ${replyEmail} on your account — your quote, invoice and job report will be sent there. 📧`,
      );
    } else if (convState?.state === "awaiting_email" && !intent.wantsReschedule && !intent.wantsCancel) {
      replies.push(
        "Thanks for the reply! We still need your email address so we can send your quote and invoice — please reply with just your email (e.g. name@example.com).",
      );
    }

    // ---- 2. Reschedule / cancellation ------------------------------------
    if (intent.wantsReschedule || intent.wantsCancel) {
      const requestType = intent.wantsCancel ? "cancellation" : "reschedule";

      // Most recent appointment we hold for this customer.
      let appointment: any = null;
      if (targetLeadId) {
        const { data } = await supabase
          .from("leads")
          .select("id, customer_name, scheduled_date, scheduled_time, service_type")
          .eq("id", targetLeadId)
          .maybeSingle();
        appointment = data;
      }
      if (!appointment && targetCustomerId) {
        const { data } = await supabase
          .from("leads")
          .select("id, customer_name, scheduled_date, scheduled_time, service_type")
          .eq("customer_id", targetCustomerId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        appointment = data;
      }

      const when = intent.wantsCancel
        ? { iso: null, date: null, time: null, phrase: null }
        : parseRequestedWhen(body);
      const requestedLabel = describeWhen(when);

      const currentValue = appointment?.scheduled_date
        ? `${appointment.scheduled_date}${
          appointment.scheduled_time ? ` ${String(appointment.scheduled_time).slice(0, 5)}` : ""
        }`
        : null;

      let changeRequestId: string | null = null;
      if (appointment?.id) {
        const { data: cr, error: crError } = await supabase
          .from("lead_change_requests")
          .insert({
            lead_id: appointment.id,
            request_type: requestType,
            source: "customer_whatsapp",
            status: "pending",
            current_value: currentValue,
            requested_value: intent.wantsCancel
              ? "cancel appointment"
              : (when.date || when.time
                ? `${when.date ?? currentValue?.slice(0, 10) ?? ""} ${when.time ?? ""}`.trim()
                : "unspecified — customer asked to change the time"),
            reason: `Customer WhatsApp request from ${from}`,
            customer_message: body,
          })
          .select("id")
          .maybeSingle();
        if (crError) console.error("[whatsapp-webhook] change request insert failed", crError);
        changeRequestId = cr?.id ?? null;
      }

      const who = appointment?.customer_name || from;
      await notifyDispatchTeam(supabase, {
        type: intent.wantsCancel
          ? "appointment_cancellation_request"
          : "appointment_reschedule_request",
        title: intent.wantsCancel
          ? `Cancellation requested — ${who}`
          : `Reschedule requested — ${who}`,
        body: intent.wantsCancel
          ? `${who} asked to cancel${currentValue ? ` the ${currentValue} appointment` : ""} via WhatsApp: "${body}"`
          : `${who} asked to move${currentValue ? ` the ${currentValue} appointment` : ""}${
            requestedLabel ? ` to ${requestedLabel}` : ""
          } via WhatsApp: "${body}"`,
        relatedId: appointment?.id ?? null,
        metadata: {
          source: "whatsapp",
          phone: from,
          lead_id: appointment?.id ?? null,
          customer_id: targetCustomerId,
          change_request_id: changeRequestId,
          requested_iso: when.iso,
          requested_date: when.date,
          requested_time: when.time,
        },
      });

      console.log(
        `[whatsapp-webhook] ${requestType} request lead=${appointment?.id} cr=${changeRequestId} when=${when.iso}`,
      );

      if (intent.wantsCancel) {
        replies.push(
          "Got it — we've sent your cancellation request to our scheduling team. They'll confirm shortly. Nothing is cancelled until you hear back from us.",
        );
      } else if (requestedLabel) {
        replies.push(
          `Thanks! We've asked our scheduling team to move your appointment to *${requestedLabel}*. They'll confirm as soon as a technician is available — your current booking stays in place until then.`,
        );
      } else {
        replies.push(
          "Thanks! We've passed your request to change the appointment time to our scheduling team. Please reply with the day and time that suits you (e.g. \"Thursday 10:30\") and they'll confirm.",
        );
      }
    }

    // ---- 3. Catch-all: never leave a customer without a reply -------------
    if (!replies.length && intent.isGeneralQuery) {
      const { data: recentLead } = targetLeadId
        ? await supabase
          .from("leads")
          .select("id, customer_name")
          .eq("id", targetLeadId)
          .maybeSingle()
        : { data: null };

      await notifyDispatchTeam(supabase, {
        type: "whatsapp_customer_message",
        title: `WhatsApp message — ${recentLead?.customer_name || from}`,
        body: body.slice(0, 400),
        relatedId: targetLeadId,
        metadata: {
          source: "whatsapp",
          phone: from,
          customer_id: targetCustomerId,
          lead_id: targetLeadId,
        },
      });

      replies.push(
        "Thanks for your message! 👋 Our team has received it and someone will get back to you shortly. For anything urgent please call 0800-BE-COOL.",
      );
    }

    return replies.length ? twiml(replies.join("\n\n")) : twiml();

  } catch (err) {
    console.error("[whatsapp-webhook] error", err);
    // Always 200 to Twilio so it does not retry-storm on our own bugs.
    return twiml();
  }
});
