import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  fromCents,
  getYocoConfig,
  mapYocoStatus,
  verifyYocoWebhook,
  yocoEnvironment,
} from "../_shared/yoco.ts";
import { applyPaymentStatus, reconcileInvoice } from "../_shared/paymentState.ts";
import { dbEnvironment } from "../_shared/shopPayments.ts";
import { shopPaidEmail } from "../_shared/shopEmail.ts";

const MASSAIR_COMPANY_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";

// deno-lint-ignore no-explicit-any
async function sendClientEmail(db: any, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const { data: cfg } = await db.from("app_webhook_config").select("email_webhook_token").eq("id", 1).single();
    if (!cfg?.email_webhook_token) return false;
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-transactional-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-email-webhook-token": String(cfg.email_webhook_token) },
      body: JSON.stringify(payload),
    });
    await r.text();
    return r.ok;
  } catch {
    return false;
  }
}

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

    // --- Online shop orders (2026-10-19) ----------------------------------
    // A shop order has no invoice until Yoco confirms payment. fl_shop_finalize books everything in one
    // transaction (customer, lead, accepted quote, paid invoice, payment, job) and is idempotent.
    const shopOrderId: string | undefined = p.metadata?.shop_order_id;
    if (shopOrderId) {
      const status = mapYocoStatus(gatewayStatus, eventType);
      if (status !== "paid") {
        await db.rpc("fl_shop_order_note_event", { p_order: shopOrderId, p_event: { type: eventType, status: gatewayStatus ?? null, id: p.id ?? null } });
        await db.from("payment_events").update({ processed: true }).eq("gateway", "yoco").eq("event_id", eventId);
        return json({ ok: true, shop: true, booked: false });
      }
      const { data: fin, error: finErr } = await db.rpc("fl_shop_finalize", {
        p_order: shopOrderId,
        p_checkout_id: checkoutId ?? null,
        p_gateway_payment_id: p.id ?? eventId,
        p_amount_cents: typeof p.amount === "number" ? Math.round(p.amount) : null,
        p_environment: dbEnvironment(environment),
        p_payload: p,
      });
      if (finErr || !fin?.ok) {
        console.error("shop finalize failed", finErr?.message ?? fin?.error);
        await db.from("payment_events").update({ processed: false, error_message: `shop: ${finErr?.message ?? fin?.error}` })
          .eq("gateway", "yoco").eq("event_id", eventId);
        // 500 lets Yoco retry a transient DB error; a mismatch is final (flagged to the owner in-app).
        return json({ ok: false, shop: true }, finErr ? 500 : 200);
      }
      let emailed = false;
      if (!fin.already) {
        if (fin.invoice_id) await reconcileInvoice(db, fin.invoice_id);
        if (fin.email) {
          const mail = shopPaidEmail(fin);
          emailed = await sendClientEmail(db, { to: fin.email, subject: mail.subject, html: mail.html, signature_mode: "company", company_id: MASSAIR_COMPANY_ID });
          if (emailed) await db.rpc("fl_shop_mark_emailed", { p_order: shopOrderId });
        }
      }
      await db.from("payment_events").update({ processed: true, payment_id: fin.payment_id ?? null, invoice_id: fin.invoice_id ?? null, company_id: MASSAIR_COMPANY_ID })
        .eq("gateway", "yoco").eq("event_id", eventId);
      return json({ ok: true, shop: true, booked: true, already: Boolean(fin.already), emailed });
    }

    // --- Locate the payment row ------------------------------------------
    let query = db.from("payments").select("id, invoice_id, company_id, environment, status, amount");
    if (checkoutId) query = query.eq("checkout_id", checkoutId);
    else if (invoiceIdParam) query = query.eq("invoice_id", invoiceIdParam);
    else if (invoiceNumber) query = query.eq("reference", invoiceNumber);

    const { data: payment } = await query
      .eq("gateway", "yoco")
      .eq("environment", dbEnvironment(environment)) // test events can never touch live rows (payments use sandbox/live)
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
