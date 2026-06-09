// Returns the Google Maps browser API key from edge-function secrets
// CORS-enabled, no auth required (key is referrer/domain-restricted on the Google side).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const key = Deno.env.get("VITE_GOOGLE_MAPS_API_KEY") ?? Deno.env.get("GOOGLE_MAPS_API_KEY") ?? "";
  return new Response(JSON.stringify({ key }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
