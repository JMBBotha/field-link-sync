// Returns the audio for a logged voice call, or a clear "not available" reason.
// Proxies the provider recording so the browser never hits a private storage URL
// (avoids CORS + unsigned-request failures that render a broken 0:00 / 0:00 player).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const callId = url.searchParams.get("id");
    if (!callId) return json({ available: false, reason: "Missing call id" }, 400);

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ available: false, reason: "Not authenticated" }, 401);

    // User-scoped client: RLS decides whether this user may see the call.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: call, error } = await supabase
      .from("vapi_calls")
      .select("id, recording_url, provider_call_id")
      .eq("id", callId)
      .maybeSingle();

    if (error) return json({ available: false, reason: error.message }, 403);
    if (!call) return json({ available: false, reason: "Call not found" }, 404);

    let recordingUrl: string | null = call.recording_url;

    // Refresh from the provider when we never stored one (older records / late artifacts).
    const apiKey = Deno.env.get("VAPI_PRIVATE_API_KEY");
    if (!recordingUrl && call.provider_call_id && apiKey) {
      const res = await fetch(`https://api.vapi.ai/call/${call.provider_call_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        const c = await res.json();
        recordingUrl =
          c?.artifact?.recordingUrl ??
          c?.recordingUrl ??
          c?.artifact?.recording?.mono?.combinedUrl ??
          c?.artifact?.stereoRecordingUrl ??
          null;
        if (recordingUrl) {
          await supabase.from("vapi_calls").update({ recording_url: recordingUrl }).eq("id", callId);
        }
      } else {
        console.error(`VAPI call fetch failed [${res.status}]: ${await res.text()}`);
      }
    }

    if (!recordingUrl) {
      return json({ available: false, reason: "No recording was returned for this call" }, 404);
    }

    // Stream the audio through, forwarding Range so seeking works.
    const range = req.headers.get("range");
    const upstream = await fetch(recordingUrl, range ? { headers: { Range: range } } : undefined);

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`Recording fetch failed [${upstream.status}]: ${detail.slice(0, 300)}`);
      return json(
        {
          available: false,
          reason:
            upstream.status === 400 || upstream.status === 403
              ? "Recording is stored in a private provider bucket and cannot be played back"
              : `Recording could not be loaded (${upstream.status})`,
        },
        404,
      );
    }

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", upstream.headers.get("content-type") || "audio/wav");
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("Content-Range", cr);
    headers.set("Accept-Ranges", "bytes");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    console.error("get-call-recording error:", e);
    return json({ available: false, reason: (e as Error).message }, 500);
  }
});
