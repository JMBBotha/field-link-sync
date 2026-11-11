/**
 * mandy-handoff — store a dashboard Mandy hand-off for the build team.
 * Insert uses the service role. MANDY_HANDOFF_WEBHOOK_URL is optional.
 * Phone Mandy / Vapi does not call this.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireUser, authCorsHeaders } from "../_shared/auth.ts";
import { tierFor } from "../_shared/mandyPolicy.ts";

const cors = authCorsHeaders;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const summary = String(body.summary ?? "").trim().slice(0, 2000);
  if (!summary) return json({ error: "summary required" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let companyId: string | null = null;
  if (auth.userId) {
    const { data: prof } = await db.from("profiles").select("company_id").eq("id", auth.userId).maybeSingle();
    companyId = (prof as { company_id?: string } | null)?.company_id ?? null;
  }
  const sales = auth.userId ? await db.rpc("is_sales_rep", { _uid: auth.userId }) : { data: false };
  const tech = auth.userId ? await db.rpc("is_field_tech_only", { _uid: auth.userId }) : { data: false };
  const role = tierFor(auth.roles, { salesRep: sales.data === true, techOnly: tech.data === true });
  const row = {
    company_id: companyId,
    user_id: auth.userId,
    role,
    page: typeof body.page === "string" ? body.page.slice(0, 300) : null,
    entity_ids: body.entity_ids && typeof body.entity_ids === "object" ? body.entity_ids : {},
    transcript: typeof body.transcript === "string" ? body.transcript.slice(0, 4000) : null,
    summary,
    status: "open",
  };
  const { data, error } = await db.from("mandy_handoffs").insert(row).select("id").maybeSingle();
  if (error) return json({ error: "Could not store the hand-off." }, 500);

  const hook = Deno.env.get("MANDY_HANDOFF_WEBHOOK_URL");
  if (hook) {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: data?.id, company_id: companyId, role, page: row.page, summary }),
    }).catch(() => undefined);
  }
  return json({ ok: true, id: data?.id ?? null });
});
