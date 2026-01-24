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
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, "");
  
  // Handle South African numbers
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioWhatsAppNumber = Deno.env.get("TWILIO_WHATSAPP_NUMBER");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Check if we're processing the queue or sending a single notification
    const body = await req.json().catch(() => ({}));
    const { process_queue, ...notificationPayload } = body as { process_queue?: boolean } & NotificationPayload;

    if (process_queue) {
      // Process pending notifications from the queue
      const { data: pendingNotifications, error: fetchError } = await supabase
        .from("notification_queue")
        .select("*")
        .eq("status", "pending")
        .eq("channel", "whatsapp")
        .lte("scheduled_at", new Date().toISOString())
        .lt("attempts", 3)
        .order("scheduled_at", { ascending: true })
        .limit(10);

      if (fetchError) {
        throw fetchError;
      }

      console.log(`Processing ${pendingNotifications?.length || 0} pending WhatsApp notifications`);

      const results = {
        processed: 0,
        sent: 0,
        failed: 0,
        errors: [] as string[],
      };

      for (const notification of pendingNotifications || []) {
        results.processed++;
        
        try {
          // Check if Twilio is configured
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
            throw new Error(twilioResponse.message || "Failed to send WhatsApp message");
          }

          // Update notification as sent
          await supabase
            .from("notification_queue")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              attempts: notification.attempts + 1,
            })
            .eq("id", notification.id);

          // Log successful send
          await supabase.from("notification_logs").insert({
            notification_queue_id: notification.id,
            customer_id: notification.customer_id,
            notification_type: notification.notification_type,
            channel: "whatsapp",
            recipient: `+${phoneNumber}`,
            status: "sent",
          });

          results.sent++;
          console.log(`Sent WhatsApp to +${phoneNumber}: ${notification.notification_type}`);

        } catch (err: any) {
          results.failed++;
          results.errors.push(`${notification.id}: ${err.message}`);

          // Update notification with error
          await supabase
            .from("notification_queue")
            .update({
              status: notification.attempts + 1 >= 3 ? "failed" : "pending",
              attempts: notification.attempts + 1,
              error_message: err.message,
            })
            .eq("id", notification.id);

          // Log failed attempt
          await supabase.from("notification_logs").insert({
            notification_queue_id: notification.id,
            customer_id: notification.customer_id,
            notification_type: notification.notification_type,
            channel: "whatsapp",
            recipient: notification.recipient_phone,
            status: "failed",
            error_message: err.message,
          });
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

    // Get customer details
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("*")
      .eq("id", customer_id)
      .single();

    if (customerError || !customer) {
      throw new Error("Customer not found");
    }

    // Check notification opt-in
    if (customer.notification_opt_in === false) {
      return new Response(JSON.stringify({
        success: false,
        message: "Customer has opted out of notifications",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get notification template
    const { data: settings, error: settingsError } = await supabase
      .from("notification_settings")
      .select("*")
      .eq("setting_key", notification_type)
      .eq("enabled", true)
      .single();

    if (settingsError || !settings) {
      throw new Error(`Notification template not found or disabled: ${notification_type}`);
    }

    // Check if WhatsApp is enabled for this notification type
    if (!settings.channels.includes("whatsapp")) {
      return new Response(JSON.stringify({
        success: false,
        message: "WhatsApp channel not enabled for this notification type",
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build full variables object
    const fullVariables: Record<string, string> = {
      customer_name: customer.name,
      ...variables,
    };

    // Get customer portal token
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

    // Process the template
    const messageBody = processTemplate(settings.template_body, fullVariables);

    // Queue the notification
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
      })
      .select()
      .single();

    if (queueError) {
      throw queueError;
    }

    // If Twilio is configured, try to send immediately
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
          // Update as sent
          await supabase
            .from("notification_queue")
            .update({
              status: "sent",
              sent_at: new Date().toISOString(),
              attempts: 1,
            })
            .eq("id", queueEntry.id);

          // Log success
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
          console.error("Twilio error:", twilioResponse);
          // Keep in queue for retry
        }
      } catch (err) {
        console.error("Error sending WhatsApp:", err);
        // Keep in queue for retry
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
