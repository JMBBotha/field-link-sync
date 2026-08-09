import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const admin = () =>
  createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

export const OFFER_TTL_MINUTES = Number(Deno.env.get("OFFER_TTL_MINUTES") ?? 30);
export const DEFAULT_RADIUS_KM = Number(Deno.env.get("DISPATCH_RADIUS_KM") ?? 40);

export interface Candidate {
  staff_id: string;
  full_name: string | null;
  distance_km: number | null;
}

/** Ordered candidate list for a lead. Accepts one skill or a list of required skills. */
export async function loadCandidates(
  db: ReturnType<typeof admin>,
  leadId: string,
  role: "sales_engineer" | "technician",
  radiusKm: number,
  skill: string | string[] | null,
): Promise<Candidate[]> {
  const skills = Array.isArray(skill) ? skill.filter(Boolean) : skill ? [skill] : [];

  const { data, error } = skills.length > 1
    ? await db.rpc("find_dispatch_candidates_multi", {
      p_lead_id: leadId,
      p_role: role,
      p_radius_km: radiusKm,
      p_skills: skills,
    })
    : await db.rpc("find_dispatch_candidates", {
      p_lead_id: leadId,
      p_role: role,
      p_radius_km: radiusKm,
      p_skill: skills[0] ?? null,
    });
  if (error) {
    console.error("[dispatch] candidate lookup failed:", error);
    return [];
  }
  return (data ?? []) as Candidate[];
}

/** Escalation delay (minutes) driven by lead priority. */
export function escalationMinutes(priority?: string | null): number {
  switch (priority) {
    case "emergency":
      return 5;
    case "same_day":
      return 30;
    default:
      return 120;
  }
}

/** True when the lead has no usable geo point — dispatch must not proceed. */
export async function leadHasLocation(
  db: ReturnType<typeof admin>,
  leadId: string,
): Promise<boolean> {
  const { data } = await db
    .from("leads")
    .select("latitude, longitude")
    .eq("id", leadId)
    .maybeSingle();
  return Boolean(data?.latitude != null && data?.longitude != null);
}

/** Upserts an open unassigned-queue row for a lead. */
export async function enqueueUnassigned(
  db: ReturnType<typeof admin>,
  lead: { id: string; company_id?: string | null; priority?: string | null },
  reason: string,
) {
  const { data: open } = await db
    .from("unassigned_queue")
    .select("id")
    .eq("lead_id", lead.id)
    .eq("resolved", false)
    .maybeSingle();

  const payload = {
    lead_id: lead.id,
    company_id: lead.company_id ?? null,
    reason,
    priority: lead.priority ?? "standard",
    escalate_at: new Date(Date.now() + escalationMinutes(lead.priority) * 60_000).toISOString(),
  };

  if (open?.id) {
    await db.from("unassigned_queue").update(payload).eq("id", open.id);
  } else {
    await db.from("unassigned_queue").insert(payload);
  }
}

/** Creates an offer for the next candidate not yet offered this lead. */
export async function createNextOffer(
  db: ReturnType<typeof admin>,
  opts: {
    leadId: string;
    offerType: "sales_estimate" | "service_call";
    role: "sales_engineer" | "technician";
    radiusKm?: number;
    skill?: string | string[] | null;
    priority?: string | null;
  },
) {
  const radiusKm = opts.radiusKm ?? DEFAULT_RADIUS_KM;

  const { data: lead } = await db
    .from("leads")
    .select("id, company_id, customer_name, customer_address, service_type, priority")
    .eq("id", opts.leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead not found", status: 404 };

  const { data: existing } = await db
    .from("offers")
    .select("id, staff_id, sequence, status")
    .eq("lead_id", opts.leadId);

  if ((existing ?? []).some((o: any) => o.status === "accepted")) {
    return { error: "Lead already claimed", status: 409 };
  }
  if ((existing ?? []).some((o: any) => o.status === "pending")) {
    return { error: "An offer is already pending for this lead", status: 409 };
  }

  const tried = new Set((existing ?? []).map((o: any) => o.staff_id));
  const nextSequence = (existing ?? []).length + 1;

  const candidates = await loadCandidates(db, opts.leadId, opts.role, radiusKm, opts.skill ?? null);
  const next = candidates.find((c) => !tried.has(c.staff_id));

  if (!next) return { escalate: true as const, lead };

  const expiresAt = new Date(Date.now() + OFFER_TTL_MINUTES * 60_000).toISOString();
  const { data: offer, error } = await db
    .from("offers")
    .insert({
      lead_id: opts.leadId,
      staff_id: next.staff_id,
      company_id: lead.company_id,
      offer_type: opts.offerType,
      sequence: nextSequence,
      distance_km: next.distance_km,
      expires_at: expiresAt,
      status: "pending",
    })
    .select("id, staff_id, sequence, expires_at")
    .single();
  if (error) return { error: error.message, status: 500 };

  await db.from("notifications").insert({
    user_id: next.staff_id,
    type: opts.offerType === "sales_estimate" ? "offer_sales" : "offer_service",
    title: opts.offerType === "sales_estimate" ? "New quote opportunity" : "New service job offer",
    body: `${lead.customer_name ?? "New lead"} — ${lead.service_type ?? "job"}${
      next.distance_km != null ? ` (${next.distance_km} km away)` : ""
    }. Respond before it expires.`,
    related_id: offer.id,
    metadata: {
      offer_id: offer.id,
      lead_id: opts.leadId,
      expires_at: expiresAt,
      distance_km: next.distance_km,
      offer_type: opts.offerType,
    },
  });

  return { offer, candidate: next, lead };
}

/** Flags a lead for manual assignment, queues it for ops and notifies admins/dispatchers. */
export async function escalate(
  db: ReturnType<typeof admin>,
  lead: { id: string; company_id: string | null; customer_name?: string | null; priority?: string | null },
  reason: string,
) {
  await db
    .from("leads")
    .update({ needs_manual_assignment: true, last_activity_at: new Date().toISOString() })
    .eq("id", lead.id);

  await enqueueUnassigned(db, lead, reason);


  const { data: admins } = await db
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "dispatcher"]);

  for (const a of admins ?? []) {
    await db.from("notifications").insert({
      user_id: a.user_id,
      type: "dispatch_escalation",
      title: "Lead needs manual assignment",
      body: `${lead.customer_name ?? "A lead"} could not be auto-dispatched: ${reason}`,
      related_id: lead.id,
      metadata: { lead_id: lead.id, reason },
    });
  }
}

/**
 * Dispatch endpoints mutate leads/jobs with the service role, so they must not
 * be callable anonymously. Accepts either a caller JWT belonging to an
 * admin/dispatcher, or a server-to-server call carrying the service role key.
 */
export async function requireDispatcher(
  req: Request,
): Promise<{ ok: true; userId: string | null } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
    return { ok: true, userId: null };
  }
  if (!token) {
    return { ok: false, response: json({ error: "Not authenticated" }, 401) };
  }

  const db = admin();
  const { data: userData, error } = await db.auth.getUser(token);
  const userId = userData?.user?.id;
  if (error || !userId) {
    return { ok: false, response: json({ error: "Not authenticated" }, 401) };
  }

  const { data: roles } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  const allowed = (roles ?? []).some((r: { role: string }) =>
    ["admin", "dispatcher", "platform_super_admin", "platform_ops"].includes(r.role)
  );
  if (!allowed) {
    return { ok: false, response: json({ error: "Dispatcher or admin role required" }, 403) };
  }
  return { ok: true, userId };
}
