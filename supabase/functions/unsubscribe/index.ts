import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const email = url.searchParams.get("email");

  console.log(`Unsubscribe request: email=${email}, token=${token}`);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Unsubscribed – 0800-BE-COOL!</title>
<style>
  body { margin:0; padding:0; background:#f3f4f6; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:#fff; border-radius:12px; padding:48px 40px; max-width:440px; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .brand { color:#2563eb; font-size:20px; font-weight:800; margin-bottom:8px; }
  .stripe { height:4px; background:#F59E0B; border-radius:2px; margin:0 auto 24px; width:80px; }
  .check { font-size:48px; margin-bottom:16px; }
  h1 { font-size:22px; color:#111827; margin:0 0 12px; }
  p { font-size:14px; color:#6b7280; line-height:1.6; margin:0 0 24px; }
  a.btn { display:inline-block; background:#2563eb; color:#fff; text-decoration:none; padding:12px 32px; border-radius:8px; font-weight:600; font-size:14px; }
  a.btn:hover { background:#1d4ed8; }
</style>
</head>
<body>
<div class="card">
  <div class="brand">0800-BE-COOL!</div>
  <div class="stripe"></div>
  <div class="check">✅</div>
  <h1>Unsubscribed Successfully</h1>
  <p>You have been unsubscribed from future marketing emails. You will still receive transactional emails related to active quotes and services.</p>
  <a class="btn" href="https://www.0800becool.co.za">Return to Website</a>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
});
