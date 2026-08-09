import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authCorsHeaders, requireUser } from "../_shared/auth.ts";
import { getYocoConfig, toCents } from "../_shared/yoco.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...authCorsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: authCorsHeaders });

  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { invoiceId, successUrl, cancelUrl, failureUrl } = await req.json();
    if (!invoiceId) return json({ error: "invoiceId is required" }, 400);

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    // Company scoping: the caller may only bill invoices in their own company.
    let companyId: string | null = null;
    if (auth.userId) {
      const { data: profile } = await db
        .from("profiles")
        .select("company_id")
        .eq("id", auth.userId)
        .maybeSingle();
      companyId = profile?.company_id ?? null;
      if (!companyId) return json({ error: "No company on profile" }, 403);
    }

    const { data: invoice } = await db
      .from("invoices")
      .select("id, invoice_number, grand_total, status, company_id, customer_name, customer_email")
      .eq("id", invoiceId)
      .maybeSingle();

    if (!invoice || (companyId && invoice.company_id !== companyId)) {
      return json({ error: "Invoice not found" }, 404);
    }
    if (invoice.status === "paid") return json({ error: "Invoice already paid" }, 409);

    const amount = Number(invoice.grand_total || 0);
    if (amount <= 0) return json({ error: "Invoice total must be greater than zero" }, 400);

    const cfg = getYocoConfig();

    const res = await fetch(`${cfg.baseUrl}/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.secretKey}`,
        "Content-Type": "application/json",
        // Idempotency so a retried click cannot create a second checkout.
        "Idempotency-Key": `invoice-${invoice.id}-${amount.toFixed(2)}`,
      },
      body: JSON.stringify({
        amount: toCents(amount),
        currency: "ZAR",
        ...(successUrl ? { successUrl: String(successUrl) } : {}),
        ...(cancelUrl ? { cancelUrl: String(cancelUrl) } : {}),
        ...(failureUrl ? { failureUrl: String(failureUrl) } : {}),
        metadata: {
          invoice_id: invoice.id,
          invoice_number: invoice.invoice_number ?? "",
          environment: cfg.environment,
        },
      }),
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result?.id) {
      console.error("Yoco checkout failed", res.status, JSON.stringify(result));
      return json(
        { error: "Payment provider request failed", status: res.status, details: result },
        res.status === 200 ? 502 : res.status,
      );
    }

    const { data: payment, error: insertError } = await db
      .from("payments")
      .insert({
        invoice_id: invoice.id,
        company_id: invoice.company_id,
        amount,
        currency: "ZAR",
        method: "yoco",
        gateway: "yoco",
        checkout_id: result.id,
        status: "pending",
        environment: cfg.environment,
        reference: invoice.invoice_number,
        created_by: auth.userId,
        payment_date: new Date().toISOString().slice(0, 10),
        raw_payload: result,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Failed to record payment", insertError.message);
      return json({ error: "Could not record payment" }, 500);
    }

    return json({
      paymentId: payment.id,
      checkoutId: result.id,
      environment: cfg.environment,
      // Hosted Yoco checkout page the customer is redirected to.
      redirectUrl: result.redirectUrl,
      amount,
    });
  } catch (e) {
    console.error("yoco-create-payment error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
