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
    if (!call) return json({ available: false, reason: "Call not found" });

    const apiKey = Deno.env.get("VAPI_PRIVATE_API_KEY");

    // Always able to mint a fresh signed URL from the provider — stored ones expire.
    const fetchFreshUrl = async (): Promise<string | null> => {
      if (!call.provider_call_id || !apiKey) return null;
      const res = await fetch(`https://api.vapi.ai/call/${call.provider_call_id}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) {
        console.error(`VAPI call fetch failed [${res.status}]: ${await res.text()}`);
        return null;
      }
      const c = await res.json();
      const fresh =
        c?.artifact?.recordingUrl ??
        c?.recordingUrl ??
        c?.artifact?.recording?.mono?.combinedUrl ??
        c?.artifact?.stereoRecordingUrl ??
        null;
      if (fresh) {
        await supabase.from("vapi_calls").update({ recording_url: fresh }).eq("id", callId);
      }
      return fresh;
    };

    let recordingUrl: string | null = call.recording_url ?? (await fetchFreshUrl());

    if (!recordingUrl) {
      return json({ available: false, reason: "No recording was returned for this call" });
    }

    // Stream the audio through, forwarding Range so seeking works.
    const range = req.headers.get("range");
    const get = (u: string) => fetch(u, range ? { headers: { Range: range } } : undefined);

    let upstream = await get(recordingUrl);

    // Expired/unauthorized signed URL → mint a new one and retry once.
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 401 || upstream.status === 403)) {
      const fresh = await fetchFreshUrl();
      if (fresh && fresh !== recordingUrl) {
        recordingUrl = fresh;
        upstream = await get(fresh);
      }
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`Recording fetch failed [${upstream.status}]: ${detail.slice(0, 300)}`);
      const privateBucket =
        upstream.status === 400 || upstream.status === 401 || upstream.status === 403;
      return json({
        available: false,
        reason: privateBucket
          ? "Recording is stored in your provider's private (HIPAA) bucket — enable public recording URLs in the voice provider to play it here"
          : `Recording could not be loaded (${upstream.status})`,
      });
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
