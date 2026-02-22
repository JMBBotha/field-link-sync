import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function renderPage(success: boolean, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${success ? "Unsubscribed" : "Error"} – 0800-BE-COOL!</title>
<style>
  body { margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:#fff; border-radius:12px; max-width:440px; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.08); overflow:hidden; }
  .header { background:#2563eb; padding:20px 32px; }
  .header h2 { margin:0; color:#fff; font-size:20px; font-weight:800; }
  .stripe { height:4px; background:#F59E0B; }
  .body { padding:40px 32px; }
  .icon { font-size:48px; margin-bottom:16px; }
  h1 { font-size:22px; color:#111827; margin:0 0 12px; }
  p { font-size:14px; color:#6b7280; line-height:1.6; margin:0 0 24px; }
  a.btn { display:inline-block; background:#2563eb; color:#fff; text-decoration:none; padding:12px 32px; border-radius:8px; font-weight:600; font-size:14px; }
  a.btn:hover { background:#1d4ed8; }
</style>
</head>
<body>
<div class="card">
  <div class="header"><h2>0800-BE-COOL!</h2></div>
  <div class="stripe"></div>
  <div class="body">
    <div class="icon">${success ? "✅" : "⚠️"}</div>
    <h1>${success ? "Unsubscribed Successfully" : "Something Went Wrong"}</h1>
    <p>${message}</p>
    <a class="btn" href="https://www.0800becool.co.za">Back to Website</a>
  </div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");

  if (!token || !email) {
    const html = renderPage(false, "Invalid unsubscribe link. Please contact us at info@0800becool.co.za if you need help.");
    return new Response(html, { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify token + email combo
    const { data: pref, error: fetchErr } = await supabase
      .from("email_preferences")
      .select("id, unsubscribed")
      .eq("email", email.toLowerCase())
      .eq("unsubscribe_token", token)
      .maybeSingle();

    if (fetchErr || !pref) {
      const html = renderPage(false, "We couldn't find a matching subscription record. The link may have expired or is invalid. Please contact info@0800becool.co.za for assistance.");
      return new Response(html, { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    if (pref.unsubscribed) {
      const html = renderPage(true, "You have already been unsubscribed from marketing emails. You will still receive transactional emails related to active quotes and services.");
      return new Response(html, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
    }

    // Mark as unsubscribed
    await supabase
      .from("email_preferences")
      .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", pref.id);

    const html = renderPage(true, "You have been unsubscribed from future marketing emails. You will still receive transactional emails related to active quotes and services.");
    return new Response(html, { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("Unsubscribe error:", err);
    const html = renderPage(false, "An unexpected error occurred. Please try again or contact info@0800becool.co.za.");
    return new Response(html, { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } });
  }
});
