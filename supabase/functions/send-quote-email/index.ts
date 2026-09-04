import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatZAR(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function buildHtmlEmail(clientName: string, quoteNumber: string, date: string, totalAmount: number, unsubscribeUrl: string, quoteUrl?: string | null): string {
  const formattedTotal = formatZAR(totalAmount);
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Your Quote from 0800-BE-COOL!</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
<tr><td align="center" style="padding:24px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <tr>
    <td style="background-color:#1B3A5C;padding:28px 32px;text-align:center;">
      <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">0800-BE-COOL!</h1>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">AC Super Service — Professional HVAC Solutions</p>
    </td>
  </tr>

  <tr>
    <td style="background-color:#F59E0B;height:6px;font-size:0;line-height:0;">&nbsp;</td>
  </tr>

  <tr>
    <td style="padding:32px 32px 24px;">
      <p style="margin:0 0 20px;font-size:16px;color:#111827;line-height:1.6;">
        Dear <strong>${clientName || "Valued Customer"}</strong>,
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
        Thank you for choosing 0800-BE-COOL! AC Super Service. We're pleased to present your air conditioning quotation. Please find the details below and the full quote PDF attached.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:12px;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Quote Number</p>
                  <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#1B3A5C;">${quoteNumber || "—"}</p>
                </td>
                <td style="padding-bottom:12px;text-align:right;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Date</p>
                  <p style="margin:4px 0 0;font-size:14px;color:#111827;">${date}</p>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="border-top:1px solid #bfdbfe;padding-top:14px;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total Amount (Incl. VAT)</p>
                  <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#1B3A5C;">${formattedTotal}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      ${quoteUrl ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td align="center">
            <a href="${quoteUrl}" style="display:inline-block;background-color:#F59E0B;color:#1B3A5C;text-decoration:none;font-size:16px;font-weight:800;padding:14px 40px;border-radius:8px;letter-spacing:0.3px;">
              View &amp; Accept Quote
            </a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:12px;">
            <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
              If the button does not work, copy this link into your browser:<br/>
              <span style="color:#1B3A5C;word-break:break-all;">${quoteUrl}</span>
            </p>
          </td>
        </tr>
      </table>` : `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td align="center">
            <p style="margin:0;font-size:13px;color:#6b7280;">Reply to this email or call 0800 232 665 to accept your quote.</p>
          </td>
        </tr>
      </table>`}

      <p style="margin:0 0 8px;font-size:13px;color:#6b7280;line-height:1.5;">
        ⏱ This quotation is valid for <strong>30 days</strong> from the date of issue. A 50% deposit is required upon acceptance.
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
        📎 The full itemised quotation PDF is attached to this email.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px;">
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"/>
    </td>
  </tr>

  <tr>
    <td style="padding:24px 32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#111827;">0800-BE-COOL! AC Super Service</p>
            <p style="margin:0 0 2px;font-size:12px;color:#6b7280;">📞 0800 232 665</p>
            <p style="margin:0 0 2px;font-size:12px;color:#6b7280;">✉️ info@0800becool.co.za</p>
            <p style="margin:0;font-size:12px;color:#6b7280;">🌐 www.0800becool.co.za</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 12px;">
      <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.5;">
        This email and any attachments are confidential and intended solely for the addressee. If you have received this email in error, please notify the sender immediately and delete this email. Prices quoted are in South African Rand (ZAR) and include VAT at 15% where indicated. Terms and conditions apply — see attached quotation for full details. © ${currentYear} 0800-BE-COOL! AC Super Service. All rights reserved.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 24px;">
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">
        You received this email because you requested a quote or are a valued client of 0800BeCool.
        <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from future marketing emails</a>
      </p>
    </td>
  </tr>

</table>

</td></tr>
</table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Prevent this branded sender from being used as an open relay.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { to, subject, quoteNumber, clientName, pdfBase64, totalAmount, unsubscribeToken, quoteId, customerId, region, quoteUrl } =
      await req.json();

    if (!to) {
      return new Response(JSON.stringify({ error: "Missing 'to' email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client for DB operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if recipient has unsubscribed
    const { data: pref } = await supabase
      .from("email_preferences")
      .select("unsubscribed")
      .eq("email", to.toLowerCase())
      .maybeSingle();

    if (pref?.unsubscribed) {
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "Recipient has unsubscribed from marketing emails." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate token and upsert into email_preferences
    const token = unsubscribeToken || crypto.randomUUID();

    await supabase
      .from("email_preferences")
      .upsert(
        { email: to.toLowerCase(), unsubscribe_token: token, updated_at: new Date().toISOString() },
        { onConflict: "email" },
      );

    const supabaseFunctionsUrl = supabaseUrl.replace("https://", "https://").replace(".supabase.co", ".supabase.co/functions/v1");
    const unsubscribeUrl = `${supabaseFunctionsUrl}/unsubscribe?token=${token}&email=${encodeURIComponent(to)}`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY || !RESEND_API_KEY.trim()) {
      console.error("RESEND_API_KEY not configured – refusing to fake a send");
      return new Response(
        JSON.stringify({
          error: "Email not configured",
          code: "EMAIL_NOT_CONFIGURED",
          message: "RESEND_API_KEY is not set. Configure Resend in project secrets to enable quote email.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    
    // Sender mailbox: Western Cape quotes mailbox on the verified 0800becool.co.za domain.
    const QUOTES_MAILBOX = Deno.env.get("QUOTES_FROM_EMAIL") || "wcquotes@0800becool.co.za";
    const FROM_ADDRESS = `0800-BE-COOL! Quotes <${QUOTES_MAILBOX}>`;

    // Stable quote reference used in the subject, headers and metadata so that
    // client replies can be linked back to the correct quote / customer.
    const quoteRef = quoteNumber || (quoteId ? `Q-${String(quoteId).slice(0, 8)}` : "");
    const baseSubject = subject || `Your 0800BeCool Quote`;
    const emailSubject = quoteRef && !baseSubject.includes(quoteRef)
      ? `${baseSubject} [Ref: ${quoteRef}]`.trim()
      : baseSubject.trim();

    const date = new Date().toLocaleDateString("en-ZA");
    const htmlBody = buildHtmlEmail(clientName, quoteNumber, date, totalAmount || 0, unsubscribeUrl, quoteUrl || null);
    const textFallback = `Dear ${clientName || "Valued Customer"},\n\nYour quote ${quoteRef ? `(${quoteRef}) ` : ""}totalling ${formatZAR(totalAmount || 0)} is ready.${quoteUrl ? `\n\nView and accept it here: ${quoteUrl}` : ""}\n\nThis quote is valid for 30 days. To accept, reply to this email (keep the reference ${quoteRef || ""} in the subject) or call 0800 232 665.\n\nKind regards,\n0800-BE-COOL! Team`;

    const attachments: Array<{ filename: string; content: string }> = [];
    if (pdfBase64) {
      attachments.push({ filename: `Quote-${quoteRef || "draft"}.pdf`, content: pdfBase64 });
    }

    // Custom headers travel with the message and come back on replies (In-Reply-To /
    // References threading), which is what the future inbound processor will use to
    // resolve the quote/customer without guessing from free text.
    const headers: Record<string, string> = {
      "X-BeCool-Quote-Ref": quoteRef || "unknown",
      "X-BeCool-Region": region || "western-cape",
    };
    if (quoteId) headers["X-BeCool-Quote-Id"] = String(quoteId);
    if (customerId) headers["X-BeCool-Customer-Id"] = String(customerId);

    const resendPayload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      reply_to: QUOTES_MAILBOX,
      to: [to],
      subject: emailSubject,
      html: htmlBody,
      text: textFallback,
      headers,
      tags: [
        { name: "type", value: "quote" },
        { name: "region", value: (region || "western-cape").replace(/[^a-zA-Z0-9_-]/g, "-") },
      ],
    };
    if (attachments.length > 0) resendPayload.attachments = attachments;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(JSON.stringify({ error: "Failed to send email", details: resendData }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-quote-email error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
