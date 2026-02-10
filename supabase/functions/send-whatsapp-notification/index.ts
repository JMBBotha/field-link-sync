import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  notification_type: string;
  customer_id: string;
  lead_id?: string;
  invoice_id?: string;
  variables?: Record<string, string>;
}

// Format South African phone number for WhatsApp
function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) {
    cleaned = "27" + cleaned.slice(1);
  } else if (!cleaned.startsWith("27")) {
    cleaned = "27" + cleaned;
  }
  return cleaned;
}

// Replace template variables with actual values
function processTemplate(template: string, variables: Record<string, string>): string {
  let processed = template;
  for (const [key, value] of Object.entries(variables)) {
    processed = processed.replace(new RegExp(`\\{${key}\\}`, "g"), value || "");
  }
  return processed;
}

// Calculate exponential backoff delay in seconds
function getBackoffDelay(attempt: number): number {
  // Base: 30s, 2min, 8min, 32min, capped at 1hr
  const baseDelay = 30;
  const delay = baseDelay * Math.pow(4, attempt);
  return Math.min(delay, 3600);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userSupabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } }
    });

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await userSupabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userId = claimsData.claims.sub;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: hasAdmin } = await supabase.rpc('has_role', { _user_id: userId, _role: 'admin' });
    const { data: hasAgent } = await supabase.rpc('has_role', { _user_id: userId, _role: 'field_agent' });

    if (!hasAdmin && !hasAgent) {
      return new Response(JSON.stringify({ error: 'Forbidden - Insufficient permissions' }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioWhatsAppNumber = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

    const body = await req.json().catch(() => ({}));
    const { process_queue, ...notificationPayload } = body as { process_queue?: boolean } & NotificationPayload;

    if (process_queue) {
      // Process pending notifications with exponential backoff
      const now = new Date().toISOString();
      const { data: pendingNotifications, error: fetchError } = await supabase
        .from("notification_queue")
        .select("*")
        .in("status", ["pending", "retrying"])
        .eq("channel", "whatsapp")
        .lte("scheduled_at", now)
        .lt("attempts", 5) // Increased max attempts from 3 to 5
        .order("scheduled_at", { ascending: true })
        .limit(10);

      if (fetchError) throw fetchError;

      console.log(`Processing ${pendingNotifications?.length || 0} pending WhatsApp notifications`);

      const results = { processed: 0, sent: 0, failed: 0, retrying: 0, errors: [] as string[] };

      for (const notification of pendingNotifications || []) {
        results.processed++;
        const attemptNumber = notification.attempts;

        try {
          if (!twilioAccountSid || !twilioAuthToken || !twilioWhatsAppNumber) {
            throw new Error("Twilio credentials not configured");
          }

          const phoneNumber = formatPhoneNumber(notification.recipient_phone);
          const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

          const response = await fetch(twilioUrl, {
            method: "POST",
            headers: {
              "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              From: `whatsapp:${twilioWhatsAppNumber}`,
              To: `whatsapp:+${phoneNumber}`,
              Body: notification.body,
            }),
          });

          const twilioResponse = await response.json();

          if (!response.ok) {
            throw new Error(twilioResponse.message || `Twilio error ${response.status}`);
          }

          // Success
          await supabase
            .from("notification_queue")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              attempts: attemptNumber + 1,
              error_message: null,
            })
            .eq("id", notification.id);

          await supabase.from("notification_logs").insert({
            notification_queue_id: notification.id,
            customer_id: notification.customer_id,
            notification_type: notification.notification_type,
            channel: "whatsapp",
            recipient: `+${phoneNumber}`,
            status: "sent",
          });

          results.sent++;
        } catch (err: any) {
          const nextAttempt = attemptNumber + 1;
          const maxAttempts = notification.max_attempts || 5;
          const isFinalFailure = nextAttempt >= maxAttempts;

          // Calculate next retry time with exponential backoff
          const backoffSeconds = getBackoffDelay(nextAttempt);
          const nextScheduledAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

          await supabase
            .from("notification_queue")
            .update({
              status: isFinalFailure ? "failed" : "retrying",
              attempts: nextAttempt,
              error_message: `[Attempt ${nextAttempt}/${maxAttempts}] ${err.message}`,
              // Schedule retry with backoff
              scheduled_at: isFinalFailure ? notification.scheduled_at : nextScheduledAt,
            })
            .eq("id", notification.id);

          await supabase.from("notification_logs").insert({
            notification_queue_id: notification.id,
            customer_id: notification.customer_id,
            notification_type: notification.notification_type,
            channel: "whatsapp",
            recipient: notification.recipient_phone,
            status: isFinalFailure ? "failed" : "retrying",
            error_message: `[Attempt ${nextAttempt}] ${err.message}`,
          });

          if (isFinalFailure) {
            results.failed++;
            console.error(`[WhatsApp] FINAL FAILURE after ${maxAttempts} attempts for ${notification.id}: ${err.message}`);
          } else {
            results.retrying++;
            console.warn(`[WhatsApp] Retry ${nextAttempt}/${maxAttempts} scheduled in ${backoffSeconds}s for ${notification.id}`);
          }
          results.errors.push(`${notification.id}: ${err.message}`);
        }
      }

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Single notification mode
    const { notification_type, customer_id, lead_id, invoice_id, variables = {} } = notificationPayload;

    if (!notification_type || !customer_id) {
      throw new Error("Missing required fields: notification_type and customer_id");
    }

    console.log("[WhatsApp] Single notification:", { notification_type, customer_id, lead_id, invoice_id });

    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customer_id)
      .single();

    if (customerError || !customer) throw new Error("Customer not found");

    if (customer.notification_opt_in === false) {
      return new Response(JSON.stringify({
        success: false,
        message: "Customer has opted out of notifications",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: settings, error: settingsError } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("setting_key", notification_type)
      .eq("enabled", true)
      .single();

    if (settingsError || !settings) {
      throw new Error(`Notification template not found or disabled: ${notification_type}`);
    }

    if (!settings.channels.includes("whatsapp")) {
      return new Response(JSON.stringify({
        success: false,
        message: "WhatsApp channel not enabled for this notification type",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fullVariables: Record<string, string> = {
      customer_name: customer.name,
      ...variables,
    };

    const { data: tokenData } = await supabase.rpc("get_or_create_customer_token", {
      p_customer_id: customer_id,
    });

    if (tokenData) {
      const baseUrl = Deno.env.get("APP_BASE_URL") || `https://${Deno.env.get("SUPABASE_PROJECT_REF")}-preview.lovable.app`;
      fullVariables.portal_link = `${baseUrl}/customer/${tokenData}`;
      fullVariables.feedback_link = `${baseUrl}/customer/${tokenData}/feedback`;
      if (invoice_id) {
        fullVariables.invoice_link = `${baseUrl}/customer/${tokenData}/invoice/${invoice_id}`;
      }
    }

    const messageBody = processTemplate(settings.template_body, fullVariables);

    const { data: queueEntry, error: queueError } = await supabase
      .from("notification_queue")
      .insert({
        customer_id,
        lead_id,
        invoice_id,
        notification_type,
        channel: "whatsapp",
        recipient_phone: customer.phone,
        body: messageBody,
        variables: fullVariables,
        status: "pending",
        scheduled_at: new Date().toISOString(),
        max_attempts: 5,
      })
      .select()
      .single();

    if (queueError) throw queueError;

    // Try immediate send if Twilio configured
    if (twilioAccountSid && twilioAuthToken && twilioWhatsAppNumber) {
      try {
        const phoneNumber = formatPhoneNumber(customer.phone);
        const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`;

        const response = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${btoa(`${twilioAccountSid}:${twilioAuthToken}`)}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: `whatsapp:${twilioWhatsAppNumber}`,
            To: `whatsapp:+${phoneNumber}`,
            Body: messageBody,
          }),
        });

        const twilioResponse = await response.json();

        if (response.ok) {
          await supabase
            .from("notification_queue")
            .update({ status: "sent", sent_at: new Date().toISOString(), attempts: 1 })
            .eq("id", queueEntry.id);

          await supabase.from("notification_logs").insert({
            notification_queue_id: queueEntry.id,
            customer_id,
            notification_type,
            channel: "whatsapp",
            recipient: `+${phoneNumber}`,
            status: "sent",
          });

          return new Response(JSON.stringify({
            success: true,
            message: "WhatsApp notification sent",
            queue_id: queueEntry.id,
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } else {
          // Schedule first retry with backoff
          const backoffSeconds = getBackoffDelay(1);
          const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();
          
          await supabase
            .from("notification_queue")
            .update({
              status: "retrying",
              error_message: `[Attempt 1/5] ${twilioResponse.message || "Twilio API error"}`,
              attempts: 1,
              scheduled_at: nextRetry,
            })
            .eq("id", queueEntry.id);

          await supabase.from("notification_logs").insert({
            notification_queue_id: queueEntry.id,
            customer_id,
            notification_type,
            channel: "whatsapp",
            recipient: `+${phoneNumber}`,
            status: "retrying",
            error_message: twilioResponse.message || "Twilio API error",
          });
        }
      } catch (err: any) {
        const backoffSeconds = getBackoffDelay(1);
        const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();

        await supabase
          .from("notification_queue")
          .update({
            status: "retrying",
            error_message: `[Attempt 1/5] ${err.message || "Network error"}`,
            attempts: 1,
            scheduled_at: nextRetry,
          })
          .eq("id", queueEntry.id);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Notification queued for delivery",
      queue_id: queueEntry.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
