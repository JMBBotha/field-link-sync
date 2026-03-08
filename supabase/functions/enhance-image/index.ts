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
    const apiKey = Deno.env.get("DEEP_IMAGE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "DEEP_IMAGE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { image_url } = await req.json();
    if (!image_url) {
      return new Response(
        JSON.stringify({ error: "image_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[enhance-image] Processing:", image_url);

    const deepImageResponse = await fetch(
      "https://deep-image.ai/rest_api/process_result",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          url: image_url,
          width: 1024,
          enhancements: ["denoise", "deblur", "light"],
        }),
      }
    );

    if (!deepImageResponse.ok) {
      const errorText = await deepImageResponse.text();
      console.error("[enhance-image] Deep Image API error:", deepImageResponse.status, errorText);
      return new Response(
        JSON.stringify({ error: `Deep Image API error: ${deepImageResponse.status}`, details: errorText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await deepImageResponse.json();
    console.log("[enhance-image] Result:", JSON.stringify(result));

    // Deep Image API returns the enhanced image URL in result_url
    const enhancedUrl = result.result_url || result.url || result.enhanced_url;

    if (!enhancedUrl) {
      return new Response(
        JSON.stringify({ error: "No enhanced URL in response", raw: result }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ enhanced_url: enhancedUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[enhance-image] Error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
