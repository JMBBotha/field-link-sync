// Admin-only. Links a real email onto an existing no-login technician.
// Not deployed by the preview PR. Does not create a user and does not send mail
// itself. The Team page then sends the existing sign-in email with
// shouldCreateUser false, so the link hits this same auth user. Visits and earnings stay put.
// no_login stays true until that person actually signs in (clear_no_login_after_sign_in).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decideAdminCompanyAccess, decideLinkLogin } from "../_shared/noLoginTechnician.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Not authenticated" }, 401);
  if (token === serviceKey) return json({ error: "Sign in as a company admin" }, 403);
  if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const userId = userData?.user?.id ?? null;
  if (userErr || !userId) return json({ error: "Not authenticated" }, 401);

  const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((row: { role: string }) => row.role);
  const { data: caller } = await db.from("profiles").select("company_id").eq("id", userId).maybeSingle();

  let body: { profile_id?: string; email?: string; company_id?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "Expected a JSON body" }, 400);
  }

  const access = decideAdminCompanyAccess({
    userId,
    roles,
    companyId: caller?.company_id ?? null,
    requestedCompanyId: body.company_id ?? null,
  });
  if (!access.ok) return json({ error: access.error }, access.status);
  if (!body.profile_id) return json({ error: "Technician is required" }, 400);

  const { data: target, error: targetErr } = await db
    .from("profiles")
    .select("id, company_id, no_login, full_name")
    .eq("id", body.profile_id)
    .maybeSingle();
  if (targetErr) {
    const missing = /no_login|column/i.test(targetErr.message);
    return json({
      error: missing
        ? "Apply migration 20261111153000_no_login_technicians.sql before using this"
        : targetErr.message,
      code: missing ? "migration_required" : "lookup_failed",
    }, missing ? 503 : 500);
  }

  const { data: ownerId, error: ownerErr } = await db.rpc("auth_user_id_for_email", {
    p_email: (body.email ?? "").trim(),
  });
  if (ownerErr && !/function|does not exist|schema cache/i.test(ownerErr.message)) {
    return json({ error: ownerErr.message }, 500);
  }
  if (ownerErr) {
    return json({
      error: "Apply migration 20261111153000_no_login_technicians.sql before using this",
      code: "migration_required",
    }, 503);
  }

  const decision = decideLinkLogin({
    callerCompanyId: access.companyId,
    target: target
      ? { id: target.id, company_id: target.company_id, no_login: !!target.no_login }
      : null,
    email: body.email ?? "",
    emailOwnerId: (ownerId as string | null) ?? null,
  });
  if (!decision.ok) return json({ error: decision.error }, decision.status);

  // Same auth user. email_confirm avoids a second GoTrue confirmation mail.
  // The Team page sends the one sign-in link with shouldCreateUser false.
  const { error: updateErr } = await db.auth.admin.updateUserById(decision.profileId, {
    email: decision.email,
    email_confirm: true,
    ban_duration: "none",
  });
  if (updateErr) return json({ error: updateErr.message }, 400);

  return json({
    ok: true,
    profile_id: decision.profileId,
    email: decision.email,
    creates_user: decision.createsUser,
    email_sent_by_function: false,
    no_login_until_sign_in: true,
  });
});
