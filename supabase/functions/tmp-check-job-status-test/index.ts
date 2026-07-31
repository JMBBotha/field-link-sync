import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// TEMPORARY: server-side harness that calls check-job-status with the real
// VAPI_WEBHOOK_SECRET so we can see the exact payload Mandy receives.
serve(async (req) => {
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("VAPI_WEBHOOK_SECRET") ?? "";

  const res = await fetch(`${url}/functions/v1/check-job-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text }), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
});
