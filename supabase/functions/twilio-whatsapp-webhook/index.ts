import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractEmail } from "../_shared/appointmentConfirmation.ts";
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

    // Opt-out handling is a legal requirement for business messaging.
    const normalised = body.trim().toUpperCase();
    if (["STOP", "UNSUBSCRIBE", "OPTOUT", "OPT OUT"].includes(normalised)) {
      if (customerId) {
        await supabase
          .from("customers")
          .update({ notification_opt_in: false })
          .eq("id", customerId);
      }
      return twiml(
        "You have been unsubscribed from 0800-BE-COOL WhatsApp updates. Reply START to opt back in.",
      );
    }
    if (["START", "UNSTOP", "SUBSCRIBE"].includes(normalised) && customerId) {
      await supabase
        .from("customers")
        .update({ notification_opt_in: true })
        .eq("id", customerId);
      return twiml("You're subscribed again to 0800-BE-COOL WhatsApp updates.");
    }

    // ---- Email capture reply --------------------------------------------
    const { data: convState } = await supabase
      .from("whatsapp_conversation_state")
      .select("id, state, customer_id, lead_id")
      .eq("phone", from)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    const awaitingEmail = convState?.state === "awaiting_email";
    const replyEmail = extractEmail(body);

    if (awaitingEmail || replyEmail) {
      const targetCustomerId = convState?.customer_id || customerId;
      const targetLeadId = convState?.lead_id || leadId;

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
        if (convState) {
          await supabase
            .from("whatsapp_conversation_state")
            .delete()
            .eq("id", convState.id);
        }
        console.log(
          `[whatsapp-webhook] captured email for customer=${targetCustomerId} lead=${targetLeadId}`,
        );
        return twiml(
          `Thank you! We've saved ${replyEmail} on your account — your quote, invoice and job report will be sent there. 📧`,
        );
      }

      if (awaitingEmail) {
        return twiml(
          "Thanks for the reply! We still need your email address so we can send your quote and invoice — please reply with just your email (e.g. name@example.com).",
        );
      }
    }

    // No auto-reply by default — the message is logged for the team to action.
    return twiml();
  } catch (err) {
    console.error("[whatsapp-webhook] error", err);
    // Always 200 to Twilio so it does not retry-storm on our own bugs.
    return twiml();
  }
});
