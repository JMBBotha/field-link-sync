import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authCorsHeaders, requireUser } from "../_shared/auth.ts";
import { getPeachConfig } from "../_shared/peach.ts";

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
    const { invoiceId, returnUrl } = await req.json();
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

    const cfg = getPeachConfig();

    const body = new URLSearchParams({
      entityId: cfg.entityId,
      amount: amount.toFixed(2),
      currency: "ZAR",
      paymentType: "DB",
      merchantTransactionId: invoice.invoice_number ?? invoice.id,
      "customer.email": invoice.customer_email ?? "",
      "customParameters[invoice_id]": invoice.id,
      "customParameters[environment]": cfg.environment,
    });
    if (returnUrl) body.set("shopperResultUrl", String(returnUrl));

    const res = await fetch(`${cfg.baseUrl}/v1/checkouts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result?.id) {
      console.error("Peach checkout failed", res.status, JSON.stringify(result));
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
        method: "peach",
        gateway: "peach",
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
      // Hosted checkout widget script for this checkout id
      checkoutScriptUrl: `${cfg.baseUrl}/v1/paymentWidgets.js?checkoutId=${result.id}`,
      amount,
    });
  } catch (e) {
    console.error("peach-create-payment error", e);
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
