import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fromCents,
  getYocoConfig,
  mapYocoStatus,
  verifyYocoWebhook,
  yocoEnvironment,
} from "../_shared/yoco.ts";
import { applyPaymentStatus, reconcileInvoice } from "../_shared/paymentState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, webhook-id, webhook-timestamp, webhook-signature",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const environment = yocoEnvironment();
  const raw = await req.text();

  // --- Signature verification -------------------------------------------
  let webhookSecret: string | null = null;
  try {
    webhookSecret = getYocoConfig().webhookSecret;
  } catch {
    webhookSecret = (environment === "live"
      ? Deno.env.get("YOCO_LIVE_WEBHOOK_SECRET")
      : Deno.env.get("YOCO_TEST_WEBHOOK_SECRET"))?.trim() || null;
  }

  const signatureValid = webhookSecret
    ? await verifyYocoWebhook(raw, req.headers, webhookSecret)
    : false;

  if (!signatureValid) {
    await db.from("payment_events").insert({
      gateway: "yoco",
      environment,
      event_type: "rejected",
      signature_valid: false,
      processed: false,
      error_message: webhookSecret
        ? "Webhook signature could not be verified"
        : "Yoco webhook secret not configured",
      payload: { headers_present: Boolean(req.headers.get("webhook-signature")) },
    });
    return json({ error: "Invalid signature" }, 401);
  }

  try {
    const event = JSON.parse(raw) as Record<string, any>;
    const p = (event.payload ?? event) as Record<string, any>;
    const eventType: string = event.type ?? "payment";
    const eventId: string | null = event.id ?? req.headers.get("webhook-id");

    const checkoutId: string | undefined = p.metadata?.checkoutId ?? p.checkoutId ??
      p.checkout_id ?? undefined;
    const invoiceIdParam: string | undefined = p.metadata?.invoice_id;
    const invoiceNumber: string | undefined = p.metadata?.invoice_number;
    const gatewayStatus: string | undefined = p.status;

    // Idempotency: unique index on (gateway, event_id) rejects replays.
    const { error: dupError } = await db.from("payment_events").insert({
      gateway: "yoco",
      environment,
      event_type: eventType,
      event_id: eventId,
      result_code: gatewayStatus ?? null,
      signature_valid: true,
      processed: false,
      payload: p,
      invoice_id: invoiceIdParam ?? null,
    });
    if (dupError) {
      if (dupError.code === "23505") return json({ ok: true, duplicate: true });
      console.error("payment_events insert failed", dupError.message);
    }

    // --- Locate the payment row ------------------------------------------
    let query = db.from("payments").select("id, invoice_id, company_id, environment, status, amount");
    if (checkoutId) query = query.eq("checkout_id", checkoutId);
    else if (invoiceIdParam) query = query.eq("invoice_id", invoiceIdParam);
    else if (invoiceNumber) query = query.eq("reference", invoiceNumber);

    const { data: payment } = await query
      .eq("gateway", "yoco")
      .eq("environment", environment) // test events can never touch live rows
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      await db
        .from("payment_events")
        .update({ processed: false, error_message: "No matching payment row" })
        .eq("gateway", "yoco")
        .eq("event_id", eventId);
      return json({ ok: true, matched: false });
    }

    const nextStatus = mapYocoStatus(gatewayStatus, eventType);
    const applied = await applyPaymentStatus(db, payment.id, nextStatus, {
      gateway_reference: p.id ?? eventId,
      raw_payload: p,
      ...(typeof p.amount === "number" ? { amount: fromCents(p.amount) } : {}),
    });

    let reconciliation = null;
    if (payment.invoice_id) {
      reconciliation = await reconcileInvoice(db, payment.invoice_id);
    }

    await db
      .from("payment_events")
      .update({
        processed: true,
        payment_id: payment.id,
        invoice_id: payment.invoice_id,
        company_id: payment.company_id,
      })
      .eq("gateway", "yoco")
      .eq("event_id", eventId);

    return json({
      ok: true,
      environment,
      paymentStatus: applied.status,
      transitionApplied: applied.applied,
      invoiceStatus: reconciliation?.invoiceStatus ?? null,
    });
  } catch (e) {
    console.error("yoco-webhook error", e);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
