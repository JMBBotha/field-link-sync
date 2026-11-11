// Admin-only. Creates a technician with no email and no password.
// Not deployed by the preview PR. Apply 20261111153000_no_login_technicians.sql first.
//
// auth.admin.createUser (service role) with email_confirm, no password, then a ban so
// the placeholder address cannot open a session. The address is on the reserved
// .invalid domain and is never mailed. Profile, field_agent role, and company_members
// are set for the caller's company only. Duplicate names in that company return 409
// unless confirm_duplicate is true.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  decideAdminCompanyAccess,
  duplicateNameBlock,
  noLoginEmail,
  validatePhone,
  validateTechnicianName,
} from "../_shared/noLoginTechnician.ts";

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
  if (!supabaseUrl || !serviceKey) return json({ error: "Server is not configured" }, 500);

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // The service-role key is not a company admin. Refuse it before getUser.
  const accessSeed = decideAdminCompanyAccess({
    userId: token === serviceKey ? null : "pending",
    roles: token === serviceKey ? [] : ["admin"],
    companyId: token === serviceKey ? null : "pending",
    serviceRole: token === serviceKey,
  });
  if (!accessSeed.ok && accessSeed.status === 403 && token === serviceKey) return json({ error: accessSeed.error }, 403);

  const { data: userData, error: userErr } = await db.auth.getUser(token);
  const userId = userData?.user?.id ?? null;
  if (userErr || !userId) return json({ error: "Not authenticated" }, 401);

  const { data: roleRows } = await db.from("user_roles").select("role").eq("user_id", userId);
  const roles = (roleRows ?? []).map((row: { role: string }) => row.role);
  const { data: caller } = await db.from("profiles").select("company_id").eq("id", userId).maybeSingle();

  let body: { full_name?: string; phone?: string; company_id?: string; confirm_duplicate?: boolean } = {};
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
    serviceRole: false,
  });
  if (!access.ok) return json({ error: access.error }, access.status);

  const nameCheck = validateTechnicianName(body.full_name ?? "");
  if (!nameCheck.ok) return json({ error: nameCheck.error }, 400);
  const phoneCheck = validatePhone(body.phone);
  if (!phoneCheck.ok) return json({ error: phoneCheck.error }, 400);

  const { data: peers, error: peerErr } = await db
    .from("profiles")
    .select("id, full_name, archived_at")
    .eq("company_id", access.companyId)
    .is("archived_at", null)
    .limit(1000);
  if (peerErr) return json({ error: "Could not check existing names" }, 500);

  const dup = duplicateNameBlock(nameCheck.name, peers ?? [], body.confirm_duplicate === true);
  if (dup.blocked) {
    return json({ error: "That name is already on your team", code: "duplicate_name", matches: dup.matches }, 409);
  }

  const stamp = crypto.randomUUID();
  const email = noLoginEmail(stamp);
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { provision: "no_login_technician", company_id: access.companyId },
    user_metadata: { full_name: nameCheck.name, phone: phoneCheck.phone ?? "" },
  });
  const id = created?.user?.id;
  if (createErr || !id) {
    return json({ error: createErr?.message || "Could not create the technician" }, 400);
  }

  const rollback = async () => {
    await db.from("notifications").delete().eq("related_id", id).eq("type", "network_applicant");
    await db.from("company_members").delete().eq("user_id", id);
    await db.from("user_roles").delete().eq("user_id", id);
    await db.auth.admin.deleteUser(id);
  };

  const { error: profileErr } = await db.from("profiles").update({
    full_name: nameCheck.name,
    phone: phoneCheck.phone,
    company_id: access.companyId,
    dispatch_role: "technician",
    dispatch_active: true,
    participant_type: "company_staff",
    no_login: true,
    location_tracking_enabled: false,
    availability_status: "offline",
  }).eq("id", id);
  if (profileErr) {
    await rollback();
    const missing = /no_login|column/i.test(profileErr.message);
    return json({
      error: missing
        ? "Apply migration 20261111153000_no_login_technicians.sql before using this"
        : profileErr.message,
      code: missing ? "migration_required" : "profile_failed",
    }, missing ? 503 : 500);
  }

  const { error: roleErr } = await db.from("user_roles").upsert(
    { user_id: id, role: "field_agent" },
    { onConflict: "user_id,role" },
  );
  if (roleErr) {
    await rollback();
    return json({ error: roleErr.message }, 500);
  }

  const { error: memberErr } = await db.from("company_members").upsert(
    { user_id: id, company_id: access.companyId, role: "member" },
    { onConflict: "user_id,company_id" },
  );
  if (memberErr) {
    await rollback();
    return json({ error: memberErr.message }, 500);
  }

  // No password was set. Ban sign-in so the placeholder cannot open a session.
  const { error: banErr } = await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  if (banErr) {
    await rollback();
    return json({ error: banErr.message }, 500);
  }

  await db.from("notifications").delete().eq("related_id", id).eq("type", "network_applicant");

  return json({
    ok: true,
    id,
    full_name: nameCheck.name,
    phone: phoneCheck.phone,
    company_id: access.companyId,
    no_login: true,
    email_sent: false,
  });
});
