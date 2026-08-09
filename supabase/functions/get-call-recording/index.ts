// Authenticated proxy for Vapi HIPAA recordings. The provider's signed artifact
// URL is followed only inside this function and is never exposed to the browser.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges, content-disposition",
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
    const callId = url.searchParams.get("callId") ?? url.searchParams.get("id");
    const recordingType = url.searchParams.get("type") ?? "stereo";
    if (!callId) return json({ available: false, reason: "Missing call id" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(callId)) {
      return json({ available: false, reason: "Invalid call id" }, 400);
    }
    if (!new Set(["stereo", "mono", "customer", "assistant"]).has(recordingType)) {
      return json({ available: false, reason: "Invalid recording type" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ available: false, reason: "Not authenticated" }, 401);
    }

    // User-scoped client: RLS decides whether this user may see the call.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.slice("Bearer ".length);
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      return json({ available: false, reason: "Invalid or expired session" }, 401);
    }

    // This user-scoped query is the ownership check: vapi_calls RLS only returns
    // rows belonging to a company of which the authenticated user is a member.
    const { data: call, error } = await supabase
      .from("vapi_calls")
      .select("id, provider, provider_call_id, company_id")
      .eq("id", callId)
      .maybeSingle();

    if (error) {
      console.error("Authorized call lookup failed:", error.message);
      return json({ available: false, reason: "Not authorized to access this call" }, 403);
    }
    if (!call) return json({ available: false, reason: "Call not found or access denied" }, 404);
    if (call.provider !== "vapi" || !call.provider_call_id) {
      return json({ available: false, reason: "This call has no Vapi call identifier" }, 404);
    }

    const apiKey = Deno.env.get("VAPI_PRIVATE_API_KEY");
    if (!apiKey) return json({ available: false, reason: "Recording service is not configured" }, 503);

    // Vapi documents the authenticated artifact endpoint for HIPAA recordings.
    // Stereo is the default; the optional types use the corresponding endpoint.
    const artifactName: Record<string, string> = {
      stereo: "stereo-recording",
      mono: "recording",
      customer: "customer-recording",
      assistant: "assistant-recording",
    };
    const artifactUrl = `https://api.vapi.ai/call/${encodeURIComponent(call.provider_call_id)}/${artifactName[recordingType]}`;
    const range = req.headers.get("range");
    const artifactResponse = await fetch(artifactUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(range ? { Range: range } : {}),
      },
    });

    let upstream = artifactResponse;
    if (artifactResponse.status >= 300 && artifactResponse.status < 400) {
      const signedUrl = artifactResponse.headers.get("location");
      if (!signedUrl) {
        return json({ available: false, reason: "Provider did not return a recording location" }, 502);
      }
      upstream = await fetch(signedUrl, {
        method: "GET",
        redirect: "follow",
        headers: range ? { Range: range } : undefined,
      });
    }

    if (!upstream.ok || !upstream.body) {
      const detail = await upstream.text().catch(() => "");
      console.error(`Vapi artifact fetch failed [${upstream.status}]: ${detail.slice(0, 300)}`);
      const status = upstream.status === 404 ? 404 : 502;
      return json({ available: false, reason: `Provider recording request failed (${upstream.status})` }, status);
    }

    const headers = new Headers(corsHeaders);
    headers.set("Content-Type", upstream.headers.get("content-type") || "audio/wav");
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const cr = upstream.headers.get("content-range");
    if (cr) headers.set("Content-Range", cr);
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("Content-Disposition", disposition);
    headers.set("Cache-Control", "private, no-store");
    headers.set("Accept-Ranges", "bytes");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    console.error("get-call-recording error:", e);
    return json({ available: false, reason: (e as Error).message }, 500);
  }
});
