import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decryptPeachWebhook,
  getPeachConfig,
  mapResultCode,
  peachEnvironment,
} from "../_shared/peach.ts";
import { applyPaymentStatus, reconcileInvoice } from "../_shared/paymentState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-initialization-vector, x-authentication-tag",
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

  const environment = peachEnvironment();
  const raw = await req.text();

  // --- Signature verification -------------------------------------------
  const iv = req.headers.get("x-initialization-vector");
  const tag = req.headers.get("x-authentication-tag");
  let payload: Record<string, any> | null = null;
  let signatureValid = false;

  let webhookKey: string | null = null;
  try {
    webhookKey = getPeachConfig().webhookKeyHex;
  } catch {
    webhookKey = Deno.env.get("PEACH_WEBHOOK_KEY")?.trim() || null;
  }

  if (webhookKey && iv && tag) {
    payload = await decryptPeachWebhook(raw, iv, tag, webhookKey);
    signatureValid = payload !== null;
  }

  if (!signatureValid) {
    // Log the rejected attempt for auditing, then refuse.
    await db.from("payment_events").insert({
      gateway: "peach",
      environment,
      event_type: "rejected",
      signature_valid: false,
      processed: false,
      error_message: webhookKey
        ? "Webhook signature could not be verified"
        : "PEACH_WEBHOOK_KEY not configured",
      payload: { headers_present: Boolean(iv && tag) },
    });
    return json({ error: "Invalid signature" }, 401);
  }

  try {
    const p = (payload.payload ?? payload) as Record<string, any>;
    const eventId: string | null = p.id ?? payload.id ?? null;
    const resultCode: string | undefined = p.result?.code;
    const checkoutId: string | undefined = p.checkoutId ?? p.ndc ?? undefined;
    const invoiceIdParam: string | undefined = p.customParameters?.invoice_id;
    const merchantTxn: string | undefined = p.merchantTransactionId;

    // Idempotency: unique index on (gateway, event_id) rejects replays.
    const { error: dupError } = await db.from("payment_events").insert({
      gateway: "peach",
      environment,
      event_type: payload.type ?? "payment",
      event_id: eventId,
      result_code: resultCode ?? null,
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
    let query = db.from("payments").select("id, invoice_id, company_id, environment, status");
    if (checkoutId) query = query.eq("checkout_id", checkoutId);
    else if (merchantTxn) query = query.eq("reference", merchantTxn);
    else if (invoiceIdParam) query = query.eq("invoice_id", invoiceIdParam);

    const { data: payment } = await query
      .eq("environment", environment) // sandbox events can never touch live rows
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) {
      await db
        .from("payment_events")
        .update({ processed: false, error_message: "No matching payment row" })
        .eq("gateway", "peach")
        .eq("event_id", eventId);
      return json({ ok: true, matched: false });
    }

    const nextStatus = mapResultCode(resultCode);
    const applied = await applyPaymentStatus(db, payment.id, nextStatus, {
      gateway_reference: eventId,
      raw_payload: p,
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
      .eq("gateway", "peach")
      .eq("event_id", eventId);

    return json({
      ok: true,
      environment,
      paymentStatus: applied.status,
      transitionApplied: applied.applied,
      invoiceStatus: reconciliation?.invoiceStatus ?? null,
    });
  } catch (e) {
    console.error("peach-webhook error", e);
    return json({ error: "Webhook processing failed" }, 500);
  }
});
