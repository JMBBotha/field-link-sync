import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function formatZAR(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

function buildReminderHtml(clientName: string, quoteNumber: string, dueDate: string, totalAmount: number, daysLeft: number, unsubscribeUrl: string): string {
  const formattedTotal = formatZAR(totalAmount);
  const currentYear = new Date().getFullYear();
  const urgencyColor = daysLeft <= 3 ? "#dc2626" : "#f59e0b";
  const urgencyText = daysLeft <= 1 ? "expires tomorrow" : `expires in ${daysLeft} days`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Quote Reminder from 0800-BE-COOL!</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
<tr><td align="center" style="padding:24px 16px;">

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <tr>
    <td style="background-color:#2563eb;padding:28px 32px;text-align:center;">
      <h1 style="margin:0;font-size:24px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">0800-BE-COOL!</h1>
      <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);letter-spacing:1px;text-transform:uppercase;">AC Super Service — Professional HVAC Solutions</p>
    </td>
  </tr>

  <tr>
    <td style="background-color:${urgencyColor};height:6px;font-size:0;line-height:0;">&nbsp;</td>
  </tr>

  <tr>
    <td style="padding:32px 32px 24px;">
      <p style="margin:0 0 20px;font-size:16px;color:#111827;line-height:1.6;">
        Dear <strong>${clientName || "Valued Customer"}</strong>,
      </p>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
        This is a friendly reminder that your air conditioning quotation <strong>${urgencyText}</strong>. We'd love to help you get started — please review the details below and let us know if you'd like to proceed.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef3c7;border:1px solid #fbbf24;border-radius:8px;margin-bottom:28px;">
        <tr>
          <td style="padding:20px 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding-bottom:12px;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Quote Number</p>
                  <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#92400e;">${quoteNumber || "—"}</p>
                </td>
                <td style="padding-bottom:12px;text-align:right;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Expires</p>
                  <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:${urgencyColor};">${dueDate}</p>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="border-top:1px solid #fbbf24;padding-top:14px;">
                  <p style="margin:0;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Total Amount (Incl. VAT)</p>
                  <p style="margin:6px 0 0;font-size:28px;font-weight:800;color:#92400e;">${formattedTotal}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
        <tr>
          <td align="center">
            <a href="mailto:info@0800becool.co.za?subject=Accept%20Quote%20${encodeURIComponent(quoteNumber || "")}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 40px;border-radius:8px;letter-spacing:0.3px;">
              Accept Quote Now
            </a>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:10px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">Or reply to this email to accept your quote</p>
          </td>
        </tr>
      </table>

      <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.5;">
        ⚡ Don't miss out — once this quote expires, prices may change. A 50% deposit is required upon acceptance.
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
      <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#111827;">0800-BE-COOL! AC Super Service</p>
      <p style="margin:0 0 2px;font-size:12px;color:#6b7280;">📞 0800 232 665</p>
      <p style="margin:0 0 2px;font-size:12px;color:#6b7280;">✉️ info@0800becool.co.za</p>
      <p style="margin:0;font-size:12px;color:#6b7280;">🌐 www.0800becool.co.za</p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 12px;">
      <p style="margin:0;font-size:10px;color:#9ca3af;line-height:1.5;">
        This email and any attachments are confidential and intended solely for the addressee. Prices quoted are in South African Rand (ZAR) and include VAT at 15% where indicated. © ${currentYear} 0800-BE-COOL! AC Super Service. All rights reserved.
      </p>
    </td>
  </tr>

  <tr>
    <td style="padding:0 32px 24px;">
      <p style="margin:16px 0 0;font-size:11px;color:#94a3b8;line-height:1.5;">
        You received this email because you requested a quote from 0800BeCool.
        <a href="${unsubscribeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from future emails</a>
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Can be called with a specific estimate_id, or without to process all expiring quotes
    const body = await req.json().catch(() => ({}));
    const { estimate_id } = body;

    let estimates: any[] = [];

    if (estimate_id) {
      // Single estimate reminder
      const { data } = await supabase
        .from("fb_estimates")
        .select("*, fb_contacts(name, email)")
        .eq("id", estimate_id)
        .single();
      if (data) estimates = [data];
    } else {
      // Batch: find estimates expiring in 7 days
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 7);
      const dateStr = targetDate.toISOString().split("T")[0];

      const { data } = await supabase
        .from("fb_estimates")
        .select("*, fb_contacts(name, email)")
        .eq("status", "sent")
        .eq("due_date", dateStr);
      estimates = data || [];
    }

    if (estimates.length === 0) {
      return new Response(
        JSON.stringify({ success: true, reminders_sent: 0, message: "No expiring quotes found" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not configured");
      return new Response(
        JSON.stringify({ success: true, mock: true, reminders_sent: 0, message: "RESEND_API_KEY not set" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sent = 0;
    const errors: string[] = [];

    for (const est of estimates) {
      const email = est.fb_contacts?.email;
      if (!email) {
        errors.push(`${est.estimate_number}: no email on contact`);
        continue;
      }

      // Check unsubscribe
      const { data: pref } = await supabase
        .from("email_preferences")
        .select("unsubscribed")
        .eq("email", email.toLowerCase())
        .maybeSingle();

      if (pref?.unsubscribed) {
        errors.push(`${est.estimate_number}: recipient unsubscribed`);
        continue;
      }

      // Generate/upsert unsubscribe token
      const token = crypto.randomUUID();
      await supabase.from("email_preferences").upsert(
        { email: email.toLowerCase(), unsubscribe_token: token, updated_at: new Date().toISOString() },
        { onConflict: "email" },
      );

      const supabaseFunctionsUrl = supabaseUrl.replace(".supabase.co", ".supabase.co/functions/v1");
      const unsubscribeUrl = `${supabaseFunctionsUrl}/unsubscribe?token=${token}&email=${encodeURIComponent(email)}`;

      const dueDate = est.due_date
        ? new Date(est.due_date).toLocaleDateString("en-ZA")
        : "soon";
      const now = new Date();
      const due = est.due_date ? new Date(est.due_date) : new Date();
      const daysLeft = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

      const totalAmount = Number(est.amount) + Number(est.tax);
      const clientName = est.fb_contacts?.name || "Valued Customer";

      const htmlBody = buildReminderHtml(
        clientName,
        est.estimate_number,
        dueDate,
        totalAmount,
        daysLeft,
        unsubscribeUrl,
      );

      const textFallback = `Dear ${clientName},\n\nFriendly reminder: your quote ${est.estimate_number} totalling ${formatZAR(totalAmount)} expires in ${daysLeft} days (${dueDate}).\n\nTo accept, reply to this email or call 0800 232 665.\n\nKind regards,\n0800-BE-COOL! Team`;

      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "quotes@0800becool.co.za",
          to: [email],
          subject: `⏰ Reminder: Your 0800BeCool Quote ${est.estimate_number} expires in ${daysLeft} days`,
          html: htmlBody,
          text: textFallback,
        }),
      });

      const resendData = await resendRes.json();
      if (resendRes.ok) {
        sent++;
        // Log the event
        await supabase.from("email_events").insert({
          email_id: resendData.id || crypto.randomUUID(),
          event_type: "reminder_sent",
          recipient_email: email,
          quote_number: est.estimate_number,
        });
      } else {
        console.error(`Failed to send reminder for ${est.estimate_number}:`, resendData);
        errors.push(`${est.estimate_number}: ${resendData?.message || "send failed"}`);
      }
    }

    return new Response(
      JSON.stringify({ success: true, reminders_sent: sent, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("send-quote-reminder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
