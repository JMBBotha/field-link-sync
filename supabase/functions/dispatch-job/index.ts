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
 *   4. Open network independents (profiles, participant_type='independent_tech', network_status='approved')
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

    let assigneeId: string | null = null;
    let assignmentType = "internal";

    // ─── Tier 1: Override assignee ───
    if (override_assignee_id) {
      assigneeId = override_assignee_id;
      // Determine type
      const { data: member } = await supabase
        .from("company_members")
        .select("id")
        .eq("user_id", override_assignee_id)
        .eq("company_id", job.company_id)
        .limit(1);

      if (member && member.length > 0) {
        assignmentType = "internal";
      } else {
        const { data: affil } = await supabase
          .from("agent_affiliations")
          .select("id")
          .eq("profile_id", override_assignee_id)
          .eq("company_id", job.company_id)
          .eq("status", "active")
          .limit(1);
        assignmentType = affil && affil.length > 0 ? "affiliated" : "network";
      }
      console.log(`[dispatch] Tier 1: Override assignee ${assigneeId} (${assignmentType})`);
    }

    // ─── Tier 2: Company staff ───
    if (!assigneeId) {
      const { data: staff } = await supabase
        .from("company_members")
        .select("user_id")
        .eq("company_id", job.company_id);

      if (staff && staff.length > 0) {
        const staffIds = staff.map((s: any) => s.user_id);

        // Find staff with fewest active assignments today
        const today = new Date().toISOString().split("T")[0];
        const { data: busyStaff } = await supabase
          .from("assignments")
          .select("profile_id, id")
          .in("profile_id", staffIds)
          .in("status", ["proposed", "accepted", "in_progress"]);

        const loadMap: Record<string, number> = {};
        staffIds.forEach((id: string) => (loadMap[id] = 0));
        (busyStaff || []).forEach((a: any) => {
          loadMap[a.profile_id] = (loadMap[a.profile_id] || 0) + 1;
        });

        // Pick least loaded staff
        const sorted = Object.entries(loadMap).sort((a, b) => a[1] - b[1]);
        if (sorted.length > 0) {
          assigneeId = sorted[0][0];
          assignmentType = "internal";
          console.log(`[dispatch] Tier 2: Company staff ${assigneeId} (load: ${sorted[0][1]})`);
        }
      }
    }

    // ─── Tier 3: Affiliated independents ───
    if (!assigneeId) {
      const { data: affiliates } = await supabase
        .from("agent_affiliations")
        .select("profile_id")
        .eq("company_id", job.company_id)
        .eq("status", "active");

      if (affiliates && affiliates.length > 0) {
        const affilIds = affiliates.map((a: any) => a.profile_id);
        const { data: busyAffil } = await supabase
          .from("assignments")
          .select("profile_id, id")
          .in("profile_id", affilIds)
          .in("status", ["proposed", "accepted", "in_progress"]);

        const loadMap: Record<string, number> = {};
        affilIds.forEach((id: string) => (loadMap[id] = 0));
        (busyAffil || []).forEach((a: any) => {
          loadMap[a.profile_id] = (loadMap[a.profile_id] || 0) + 1;
        });

        const sorted = Object.entries(loadMap).sort((a, b) => a[1] - b[1]);
        if (sorted.length > 0) {
          assigneeId = sorted[0][0];
          assignmentType = "affiliated";
          console.log(`[dispatch] Tier 3: Affiliated agent ${assigneeId} (load: ${sorted[0][1]})`);
        }
      }
    }

    // ─── Tier 4: Open network independents ───
    if (!assigneeId) {
      const { data: networkAgents } = await supabase
        .from("profiles")
        .select("id")
        .in("participant_type", ["independent_sales", "independent_tech"])
        .eq("network_status", "approved");

      if (networkAgents && networkAgents.length > 0) {
        // Exclude already affiliated with this company
        const { data: existingAffil } = await supabase
          .from("agent_affiliations")
          .select("profile_id")
          .eq("company_id", job.company_id);

        const excludeIds = new Set((existingAffil || []).map((a: any) => a.profile_id));
        const available = networkAgents.filter((a: any) => !excludeIds.has(a.id));

        if (available.length > 0) {
          // Pick first available (could be enhanced with proximity/load)
          assigneeId = available[0].id;
          assignmentType = "network";
          console.log(`[dispatch] Tier 4: Network agent ${assigneeId}`);
        }
      }
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
          body: `Job "${job.title}" could not be auto-dispatched. No available staff, affiliates, or network agents found. Please assign manually.`,
          related_id: job_id,
        });
      }

      return new Response(
        JSON.stringify({
          success: false,
          message: "No available assignees. Dispatcher notified.",
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
        tier_used: assignmentType === "internal" ? 2 : assignmentType === "affiliated" ? 3 : 4,
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
