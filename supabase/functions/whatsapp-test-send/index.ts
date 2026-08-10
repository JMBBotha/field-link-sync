import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getWhatsAppConfig,
  isWhatsAppConfigured,
  sendWhatsApp,
  toE164,
  twilioEnvironment,
} from "../_shared/whatsapp.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Admin-only WhatsApp smoke test.
 *  GET  -> reports config status (environment, sender, whether creds are present)
 *  POST -> { to, body? } sends a plain WhatsApp message and logs it
 */
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "admin",
    });
    if (!isAdmin) return json({ ok: false, error: "Forbidden" }, 403);

    const configured = isWhatsAppConfigured();

    if (req.method === "GET") {
      let from: string | null = null;
      let configError: string | null = null;
      try {
        from = getWhatsAppConfig().from;
      } catch (e) {
        configError = e instanceof Error ? e.message : "not configured";
      }

      // Identify WHICH Twilio account the saved credentials belong to,
      // without ever revealing the secret values.
      const sid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() ?? "";
      const token = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() ?? "";
      let account: Record<string, unknown> | null = null;
      if (sid && token) {
        try {
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
            { headers: { Authorization: `Basic ${btoa(`${sid}:${token}`)}` } },
          );
          const payload = await res.json().catch(() => ({}));
          account = res.ok
            ? {
              friendly_name: payload?.friendly_name ?? null,
              status: payload?.status ?? null,
              type: payload?.type ?? null,
            }
            : { error: payload?.message || `Twilio error ${res.status}` };
        } catch (e) {
          account = { error: e instanceof Error ? e.message : "lookup failed" };
        }
      }

      return json({
        ok: configured,
        environment: twilioEnvironment(),
        configured,
        from,
        // Masked so it can be compared against the Twilio Console safely.
        account_sid_masked: sid ? `${sid.slice(0, 6)}…${sid.slice(-4)}` : null,
        account,
        missing: [
          !Deno.env.get("TWILIO_ACCOUNT_SID")?.trim() && "TWILIO_ACCOUNT_SID",
          !Deno.env.get("TWILIO_AUTH_TOKEN")?.trim() && "TWILIO_AUTH_TOKEN",
        ].filter(Boolean),
        error: configError,
      });
    }


    if (!configured) {
      return json(
        { ok: false, error: "WhatsApp is not configured (missing Twilio credentials)" },
        400,
      );
    }

    const { to, body } = await req.json().catch(() => ({}));
    if (!to) return json({ ok: false, error: "`to` (phone number) is required" }, 400);

    const message =
      body ||
      "✅ Test message from 0800-BE-COOL. If you can read this, the WhatsApp integration is working.";

    const result = await sendWhatsApp({
      to: String(to),
      body: message,
      // Lets Twilio push sent/delivered/failed updates back into whatsapp_messages
      statusCallbackUrl: `${supabaseUrl}/functions/v1/twilio-whatsapp-webhook`,
    });

    await admin.from("whatsapp_messages").insert({
      direction: "outbound",
      environment: result.environment,
      provider_sid: result.sid ?? null,
      from_number: "system",
      to_number: toE164(String(to)),
      body: message,
      media_urls: [],
      status: result.ok ? result.status ?? "queued" : "failed",
      error_message: result.error ?? null,
      raw: { test: true },
    });

    if (!result.ok) {
      return json(
        { ok: false, environment: result.environment, error: result.error },
        result.httpStatus || 502,
      );
    }

    return json({
      ok: true,
      environment: result.environment,
      sid: result.sid,
      status: result.status,
    });
  } catch (err) {
    console.error("whatsapp-test-send error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
