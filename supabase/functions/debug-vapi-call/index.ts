const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const id = new URL(req.url).searchParams.get("id");
  const res = await fetch(`https://api.vapi.ai/call/${id}`, { headers: { Authorization: `Bearer ${Deno.env.get("VAPI_PRIVATE_API_KEY")}` } });
  const txt = await res.text();
  let art: unknown = txt.slice(0, 500);
  try { const j = JSON.parse(txt); art = { keys: Object.keys(j), recordingUrl: j.recordingUrl, artifact: j.artifact, artifactPlan: j.artifactPlan }; } catch (_) { /* noop */ }
  return new Response(JSON.stringify({ status: res.status, art }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
});
