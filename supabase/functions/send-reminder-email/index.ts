import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { context, subject, body, attach_invoice } = await req.json();

    // TODO: Integrate with Resend / SendGrid to send email
    // TODO: If attach_invoice is true, fetch invoice PDF and attach
    console.log("Reminder email requested for:", context?.client?.name);
    console.log("Subject:", subject);
    console.log("Attach invoice:", attach_invoice);

    // TODO: After sending, update lead/invoice reminder_sent_at timestamp

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email request received (stub – Resend/SendGrid integration pending)",
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in send-reminder-email:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
