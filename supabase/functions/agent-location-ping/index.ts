import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Native Android location POST from @capgo/background-geolocation.
 * The body is the plugin's Location object ({ latitude, longitude, source: "native" }).
 * The caller's JWT is forwarded into record_my_location_ping, which applies the
 * weekly window and refuses the write when sharing is off or the person is not Available.
 * Coordinates are not logged.
 */
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });

  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return json({ ok: false, reason: "signed_out" }, 401);

  let latitude = NaN;
  let longitude = NaN;
  try {
    const body = await req.json();
    latitude = Number(body?.latitude);
    longitude = Number(body?.longitude);
  } catch {
    return json({ ok: false, reason: "bad_location" }, 400);
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json({ ok: false, reason: "bad_location" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("record_my_location_ping", { p_lat: latitude, p_lng: longitude });
  if (error) {
    const denied = /location share is off|not_sharing|42501/i.test(error.message);
    return json({ ok: false, reason: denied ? "not_sharing" : "rejected" }, denied ? 200 : 400);
  }
  return json(data ?? { ok: false });
}

serve(handleRequest);
