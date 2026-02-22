import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, subject, quoteNumber, clientName, pdfBase64 } = await req.json();

    if (!to) {
      return new Response(JSON.stringify({ error: "Missing 'to' email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY) {
      console.warn("RESEND_API_KEY not configured – returning mock success");
      return new Response(
        JSON.stringify({ success: true, mock: true, message: "Email skipped – RESEND_API_KEY not set. Add it later to enable sending." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emailSubject = subject || `Your 0800BeCool Quote ${quoteNumber || ""}`.trim();
    const body = `Dear ${clientName || "Valued Customer"},\n\nThank you for choosing 0800-BE-COOL! AC Super Service.\n\nPlease find your quotation ${quoteNumber ? `(${quoteNumber}) ` : ""}attached to this email.\n\nThis quote is valid for 30 days. To accept, please contact us or reply to this email.\n\nKind regards,\n0800-BE-COOL! Team\ninfo@0800becool.co.za\n0800 23 2665`;

    const attachments: Array<{ filename: string; content: string }> = [];
    if (pdfBase64) {
      attachments.push({
        filename: `Quote-${quoteNumber || "draft"}.pdf`,
        content: pdfBase64,
      });
    }

    const resendPayload: Record<string, unknown> = {
      from: "quotes@0800becool.co.za",
      to: [to],
      subject: emailSubject,
      text: body,
    };

    if (attachments.length > 0) {
      resendPayload.attachments = attachments;
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      return new Response(JSON.stringify({ error: "Failed to send email", details: resendData }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: resendData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("send-quote-email error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
