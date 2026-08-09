import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { crypto as stdCrypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // PayFast sends ITN as application/x-www-form-urlencoded
    const body = await req.text();
    const params = new URLSearchParams(body);

    const paymentStatus = params.get("payment_status");
    const mPaymentId = params.get("m_payment_id"); // Our invoice ID
    const pfPaymentId = params.get("pf_payment_id"); // PayFast's payment ID
    const amountGross = params.get("amount_gross");
    const merchantId = params.get("merchant_id");

    console.log("PayFast ITN received:", {
      paymentStatus,
      mPaymentId,
      pfPaymentId,
      amountGross,
      merchantId,
    });

    // ── 1. Merchant must match our configured account ──
    const expectedMerchantId = Deno.env.get("PAYFAST_MERCHANT_ID");
    if (!expectedMerchantId || merchantId !== expectedMerchantId) {
      console.error("PayFast ITN rejected: merchant_id mismatch");
      return new Response("Invalid merchant", { status: 403, headers: corsHeaders });
    }

    // ── 2. Signature must match the posted data (+ optional passphrase) ──
    const receivedSignature = params.get("signature") ?? "";
    const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
    const pairs: string[] = [];
    for (const [key, value] of params.entries()) {
      if (key === "signature") continue;
      pairs.push(`${key}=${encodeURIComponent(value.trim()).replace(/%20/g, "+")}`);
    }
    let signatureBase = pairs.join("&");
    if (passphrase) {
      signatureBase += `&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, "+")}`;
    }
    const digest = await stdCrypto.subtle.digest(
      "MD5",
      new TextEncoder().encode(signatureBase),
    ).catch(() => null);
    const computedSignature = digest
      ? Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")
      : null;

    if (!computedSignature || computedSignature !== receivedSignature) {
      console.error("PayFast ITN rejected: signature mismatch");
      return new Response("Invalid signature", { status: 403, headers: corsHeaders });
    }

    // ── 3. Server-to-server validation with PayFast ──
    const validateHost = Deno.env.get("PAYFAST_SANDBOX") === "true"
      ? "https://sandbox.payfast.co.za/eng/query/validate"
      : "https://www.payfast.co.za/eng/query/validate";
    const validateRes = await fetch(validateHost, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const validateText = (await validateRes.text()).trim();
    if (!validateRes.ok || !validateText.startsWith("VALID")) {
      console.error("PayFast ITN rejected: server validation failed");
      return new Response("Invalid notification", { status: 403, headers: corsHeaders });
    }

    // Validate required fields
    if (!mPaymentId || !paymentStatus) {
      console.error("Missing required ITN fields");
      return new Response("Missing fields", { status: 400, headers: corsHeaders });
    }

    // Only process completed payments
    if (paymentStatus !== "COMPLETE") {
      console.log(`Payment status is ${paymentStatus}, not COMPLETE. Skipping.`);
      return new Response("OK", { status: 200, headers: corsHeaders });
    }

    // Create Supabase admin client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Update invoice status to paid
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_date: new Date().toISOString().split("T")[0],
        payment_method: "payfast",
        payfast_payment_id: pfPaymentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", mPaymentId);

    if (error) {
      console.error("Error updating invoice:", error);
      return new Response("DB Error", { status: 500, headers: corsHeaders });
    }

    // Also record in payments table
    const { error: paymentError } = await supabase.from("payments").insert({
      invoice_id: mPaymentId,
      amount: parseFloat(amountGross || "0"),
      method: "payfast",
      reference: pfPaymentId,
      payment_date: new Date().toISOString().split("T")[0],
    });

    if (paymentError) {
      console.error("Error recording payment:", paymentError);
      // Don't fail - invoice is already updated
    }

    console.log(`Invoice ${mPaymentId} marked as paid via PayFast`);
    return new Response("OK", { status: 200, headers: corsHeaders });
  } catch (error) {
    console.error("ITN processing error:", error);
    return new Response("Internal Error", { status: 500, headers: corsHeaders });
  }
});
