import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return base64Encode(new Uint8Array(buffer));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("DEEP_IMAGE_API_KEY");
    if (!apiKey) {
      console.error("DEEP_IMAGE_API_KEY secret is missing");
      return new Response(
        JSON.stringify({ error: "Server configuration error: API key missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { imageBase64, width = 2000 } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: "imageBase64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[enhance-pdf-page] Sending image to Deep-Image.ai (width=${width})`);

    const response = await fetch("https://deep-image.ai/rest_api/process_result", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({
        url: `data:image/png;base64,${imageBase64}`,
        width,
        enhancements: ["denoise", "light"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[enhance-pdf-page] Deep-Image API error: ${response.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: `Enhancement failed (${response.status})`, details: errorText }),
        { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    console.log("[enhance-pdf-page] Deep-Image response received");

    // Handle async job polling when API queues the request
    let finalResult = result;
    if (!result?.result_url && result?.job) {
      const jobId = result.job;
      console.log(`[enhance-pdf-page] Job queued: ${jobId}, polling...`);
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const pollResp = await fetch(`https://deep-image.ai/rest_api/result/${jobId}`, {
          headers: { "X-API-KEY": apiKey }
        });
        const pollResult = await pollResp.json();
        console.log(`[enhance-pdf-page] Poll ${i + 1}: status=${pollResult.status}`);
        if (pollResult.status === 'complete' && pollResult.result_url) {
          finalResult = pollResult;
          break;
        }
        if (pollResult.status === 'error') {
          throw new Error(`Deep-Image job failed: ${JSON.stringify(pollResult)}`);
        }
      }
    }

    if (finalResult?.result_url) {
      const imgResp = await fetch(result.result_url);
      if (!imgResp.ok) {
        return new Response(
          JSON.stringify({ error: "Failed to fetch enhanced image from result URL" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const imgBuffer = await imgResp.arrayBuffer();
      const base64 = arrayBufferToBase64(imgBuffer);
      const enhancedBase64 = `data:image/jpeg;base64,${base64}`;
      
      return new Response(
        JSON.stringify({ enhancedBase64 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (result?.output) {
      return new Response(
        JSON.stringify({ enhancedBase64: result.output }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof result === "string" && result.startsWith("http")) {
      const imgResp = await fetch(result);
      const imgBuffer = await imgResp.arrayBuffer();
      const base64 = arrayBufferToBase64(imgBuffer);
      const enhancedBase64 = `data:image/jpeg;base64,${base64}`;
      
      return new Response(
        JSON.stringify({ enhancedBase64 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.error("[enhance-pdf-page] Unexpected response format:", JSON.stringify(result).substring(0, 500));
    return new Response(
      JSON.stringify({ error: "Unexpected response format from Deep-Image API", rawKeys: Object.keys(result || {}) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("[enhance-pdf-page] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
