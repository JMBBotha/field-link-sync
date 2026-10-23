import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Public: client's quote token → only the site photos staff switched to "Client sees this", as short-lived links.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const { token } = await req.json().catch(() => ({}));
    if (typeof token !== "string" || token.length < 16 || token.length > 200) return J({ error: "Invalid request" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: q } = await sb.from("quotes").select("lead_id").eq("public_token", token).maybeSingle();
    if (!q?.lead_id) return J({ photos: [] });
    const { data } = await sb.from("job_photos").select("id, storage_path, annotated_path, caption")
      .eq("lead_id", q.lead_id).eq("client_visible", true).order("created_at", { ascending: true }).limit(40);
    const photos = [];
    for (const p of data ?? []) {
      const { data: s } = await sb.storage.from("job-photos").createSignedUrl(p.annotated_path || p.storage_path, 3600);
      if (s?.signedUrl) photos.push({ id: p.id, url: s.signedUrl, caption: p.caption ?? null });
    }
    return J({ photos });
  } catch {
    return J({ error: "Server error" }, 500);
  }
});
