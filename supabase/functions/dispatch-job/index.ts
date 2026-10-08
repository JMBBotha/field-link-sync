import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireDispatcher } from "../_shared/dispatch.ts";

/**
 * dispatch-job — Tiered assignment cascade
 *
 * Cascade order:
 *   1. override_assignee_id (if provided)
 *   2. Available company staff (company_members)
 *   3. Affiliated independent agents (agent_affiliations, status='active')
 *   (pool = dispatchable_technicians RPC only)
 *   5. If none found → create notification for dispatcher
 *
 * POST body:
 * {
 *   "job_id": "uuid",
 *   "dispatched_by": "uuid",
 *   "override_assignee_id": "uuid | null"
 * }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only authenticated dispatchers/admins (or trusted server-to-server callers)
  // may trigger job assignment.
  const auth = await requireDispatcher(req);
  if (!auth.ok) return auth.response;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const { job_id, dispatched_by, override_assignee_id } = body;

    if (!job_id) {
      return new Response(
        JSON.stringify({ error: "job_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get job details
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, company_id, status, title, customer_id")
      .eq("id", job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ error: "Job not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for existing active assignment
    const { data: existingAssignment } = await supabase
      .from("assignments")
      .select("id")
      .eq("job_id", job_id)
      .in("status", ["proposed", "accepted", "in_progress"])
      .limit(1);

    if (existingAssignment && existingAssignment.length > 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Job already has an active assignment", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Candidate pool: ONLY dispatchable_technicians (company techs + connected freelance techs)
    const { data: poolRows, error: poolError } = await supabase.rpc("dispatchable_technicians", { _company_id: job.company_id });
    if (poolError) {
      return new Response(
        JSON.stringify({ error: "Failed to load technicians", detail: poolError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const pool = ((poolRows || []) as any[]).map((r) => ({ id: r.profile_id as string, assignment_type: r.assignment_type as string }));

    let assigneeId: string | null = null;
    let assignmentType = "internal";

    const leastLoaded = async (ids: string[]) => {
      if (ids.length === 0) return null;
      const { data: busy } = await supabase
        .from("assignments")
        .select("profile_id")
        .in("profile_id", ids)
        .in("status", ["proposed", "accepted", "in_progress"]);
      const load: Record<string, number> = {};
      ids.forEach((id) => (load[id] = 0));
      (busy || []).forEach((a: any) => { load[a.profile_id] = (load[a.profile_id] || 0) + 1; });
      return Object.entries(load).sort((a, b) => a[1] - b[1])[0][0];
    };

    // ─── Tier 1: Override assignee (must be in the pool) ───
    if (override_assignee_id) {
      const hit = pool.find((p) => p.id === override_assignee_id);
      if (!hit) {
        return new Response(
          JSON.stringify({ error: "That person can't be assigned jobs" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      assigneeId = hit.id;
      assignmentType = hit.assignment_type;
      console.log(`[dispatch] Tier 1: Override assignee ${assigneeId} (${assignmentType})`);
    }

    // ─── Tier 2: Company technicians ───
    if (!assigneeId) {
      assigneeId = await leastLoaded(pool.filter((p) => p.assignment_type === "internal").map((p) => p.id));
      if (assigneeId) { assignmentType = "internal"; console.log(`[dispatch] Tier 2: ${assigneeId}`); }
    }

    // ─── Tier 3: Connected freelance technicians ───
    if (!assigneeId) {
      assigneeId = await leastLoaded(pool.filter((p) => p.assignment_type === "affiliated").map((p) => p.id));
      if (assigneeId) { assignmentType = "affiliated"; console.log(`[dispatch] Tier 3: ${assigneeId}`); }
    }

    // ─── Tier 5: No one available — notify dispatcher ───
    if (!assigneeId) {
      console.log(`[dispatch] No assignees found for job ${job_id}. Notifying dispatcher.`);

      // Notify all admins in the company
      const { data: admins } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", job.company_id)
        .eq("role", "admin");

      for (const admin of admins || []) {
        await supabase.from("notifications").insert({
          user_id: admin.user_id,
          type: "dispatch_failed",
          title: "No Technician Available",
          body: `Job "${job.title}" could not be auto-dispatched. No available technicians found. Please assign manually.`,
          related_id: job_id,
        });
      }

      return new Response(
        JSON.stringify({
          success: false,
          message: "No available technicians found. Dispatcher notified.",
          tier_reached: 5,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Create assignment ───
    const { data: assignment, error: assignError } = await supabase
      .from("assignments")
      .insert({
        job_id,
        profile_id: assigneeId,
        assigned_by: dispatched_by || null,
        assignment_type: assignmentType,
        status: "proposed",
        notes: `Auto-dispatched via cascade (${assignmentType})`,
      })
      .select()
      .single();

    if (assignError) {
      console.error("[dispatch] Assignment insert failed:", assignError);
      return new Response(
        JSON.stringify({ error: "Failed to create assignment", detail: assignError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update job status to dispatched
    await supabase
      .from("jobs")
      .update({ status: "dispatched", updated_at: new Date().toISOString() })
      .eq("id", job_id);

    // Notify the assignee
    await supabase.from("notifications").insert({
      user_id: assigneeId,
      type: "job_assigned",
      title: "New Job Assignment",
      body: `You've been assigned to "${job.title}". Please review and accept.`,
      related_id: job_id,
    });

    console.log(`[dispatch] Success: ${assigneeId} assigned to ${job_id} as ${assignmentType}`);

    return new Response(
      JSON.stringify({
        success: true,
        assignment_id: assignment.id,
        assignee_id: assigneeId,
        assignment_type: assignmentType,
        tier_used: override_assignee_id ? 1 : assignmentType === "internal" ? 2 : 3,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[dispatch] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error", detail: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
