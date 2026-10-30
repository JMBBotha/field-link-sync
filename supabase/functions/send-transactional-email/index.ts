import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { renderSignatureHtml, renderReminderSignatureHtml } from "../_shared/emailSignature.ts";
import { loadSignaturePerson, loadSignatureCompany, replyToFor } from "../_shared/signaturePerson.ts";
import { renderBrandedEmail, finalInvoiceBodyHtml, brandedTransactionalFooter, type EmailBrand, type FinalInvoiceEmailData } from "../_shared/brandedEmail.ts";
import { inlineEmailImages } from "../_shared/inlineEmailImages.ts";

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

    const { to, subject, html: legacyHtml, reply_to, sender_user_id, signature_mode, company_id, layout } = await req.json();
    // Signature (Johan 12 Oct): "person" = whoever sent it (+ reply-to them), "reminder" = salesperson + company,
    // "company" = company block only; no mode = html untouched (old callers). Inserted before </body> once.
    const person = signature_mode === "person" || signature_mode === "reminder" ? await loadSignaturePerson(supabase, sender_user_id) : null;
    // Sending company's own block (Johan 13 Oct): explicit company_id, else the sender's company; none = Massair CT design.
    let coId: string | null = company_id || null;
    if (!coId && sender_user_id && signature_mode) {
      const { data: sp } = await supabase.from("profiles").select("company_id").eq("id", sender_user_id).maybeSingle();
      coId = sp?.company_id || null;
    }
    const sigCompany = signature_mode ? await loadSignatureCompany(supabase, coId) : null;
    const sigHtml = signature_mode === "reminder" ? renderReminderSignatureHtml(person, undefined, sigCompany) : renderSignatureHtml(person, undefined, sigCompany);
    // layout = shared latest-approved client email design (_shared/brandedEmail.ts, Johan 30 Oct 20:47):
    // { template: "final_invoice", brand, kicker, title, greeting_name, data } rendered here, signature inside the card.
    let rawHtml = legacyHtml;
    let branded = false;
    if (layout && typeof layout === "object" && layout.template === "final_invoice" && layout.brand && layout.data) {
      rawHtml = renderBrandedEmail({
        brand: layout.brand as EmailBrand, title: String(layout.title || subject || ""), kicker: String(layout.kicker || ""),
        greetingName: layout.greeting_name ?? null, bodyHtml: finalInvoiceBodyHtml(layout.data as FinalInvoiceEmailData),
        signatureHtml: sigHtml, footerHtml: layout.footer_html ? String(layout.footer_html) : brandedTransactionalFooter(String(layout.brand?.name || "")),
      });
      branded = true;
    }
    let html = signature_mode && !branded && typeof rawHtml === "string" && !rawHtml.includes("data-email-signature")
      ? (rawHtml.includes("</body>") ? rawHtml.replace("</body>", `<div style="max-width:600px;margin:0 auto;padding:0 16px">${sigHtml}</div></body>`) : rawHtml + sigHtml)
      : rawHtml;
    // Logo + signature pictures as CID so Gmail and image-blocking mail apps always show them (Johan 30 Oct 20:46).
    let attachments: Array<{ filename: string; content: string; content_id: string }> = [];
    if (typeof html === "string" && (branded || signature_mode)) {
      const inl = await inlineEmailImages(html);
      html = inl.html; attachments = inl.attachments;
    }
    const replyTo = reply_to || replyToFor(person);
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
        ...(attachments.length ? { attachments } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
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
    return json(500, { error: "INTERNAL_ERROR", message: String((err as any)?.message ?? err) });
  }
});
