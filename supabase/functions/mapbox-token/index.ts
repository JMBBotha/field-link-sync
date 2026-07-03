// Returns the shared Mapbox public token so clients never need to prompt users.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const token = Deno.env.get("MAPBOX_ACCESS_TOKEN") || Deno.env.get("MAPBOX_TOKEN") || "";
  if (!token) {
    return new Response(
      JSON.stringify({ token: "", error: "MAPBOX_ACCESS_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  return new Response(JSON.stringify({ token }), {
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
});
