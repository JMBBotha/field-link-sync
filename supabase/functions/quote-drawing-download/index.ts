import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// Public: client's quote link token + drawing id -> 5-minute signed link.
// Only included PDF/PNG drawings; BOQ CSVs are never served to clients.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const { token, id } = await req.json().catch(() => ({}));
    if (typeof token !== "string" || token.length < 16 || token.length > 200 || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return J({ error: "Invalid request" }, 400);
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: d } = await sb.from("quote_drawings")
      .select("storage_path, filename, kind, include_in_client_pdf, quotes!inner(public_token)")
      .eq("id", id).maybeSingle();
    if (!d || String((d as any).quotes?.public_token) !== token || !d.include_in_client_pdf || d.kind === "boq_csv") return J({ error: "Not found" }, 404);
    const { data, error } = await sb.storage.from("quote-drawings").createSignedUrl(d.storage_path, 300, { download: d.filename });
    if (error) return J({ error: "Could not create link" }, 500);
    return J({ url: data.signedUrl });
  } catch {
    return J({ error: "Server error" }, 500);
  }
});
