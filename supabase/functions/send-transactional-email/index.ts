import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-email-webhook-token",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return json(503, { error: "EMAIL_NOT_CONFIGURED", message: "RESEND_API_KEY is not configured" });
    }

    // This function is invoked by database triggers. Require the shared webhook
    // token so anonymous callers cannot use it to send arbitrary email.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    const { data: config } = await supabase
      .from("app_webhook_config")
      .select("email_webhook_token")
      .eq("id", 1)
      .single();
    const providedToken = req.headers.get("x-email-webhook-token");
    if (!config?.email_webhook_token || providedToken !== config.email_webhook_token) {
      return json(401, { error: "UNAUTHORIZED" });
    }

    const { to, subject, html, reply_to } = await req.json();
    if (!to || typeof to !== "string" || !subject || !html) {
      return json(400, { error: "BAD_REQUEST", message: "to, subject and html are required" });
    }

    // From address must use a domain verified in Resend.
    const from = Deno.env.get("EMAIL_FROM") ?? "0800-BE-COOL <wcquotes@0800becool.co.za>";

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        ...(reply_to ? { reply_to } : {}),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Resend API error [${response.status}]: ${errorBody}`);
      return json(response.status, {
        error: "PROVIDER_ERROR",
        status: response.status,
        details: errorBody,
      });
    }

    const result = await response.json();
    return json(200, { success: true, id: result.id });
  } catch (err) {
    console.error("send-transactional-email error:", err);
    return json(500, { error: "INTERNAL_ERROR", message: String(err?.message ?? err) });
  }
});
