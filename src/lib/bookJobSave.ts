// Writes for Book a job. Past visits reuse admin backfill (quiet, admin-only).
// No booking email, no rep alert, no second job when the house already has one.
import { supabase } from "@/integrations/supabase/client";
import { db } from "@/hooks/useProjectTracker";
import { FIRST_FIT_STEP, DEFAULT_STEPS, namesHouse } from "@/lib/projectTracker";
import {
  installationJobInsert, includesFirstFix, johannesburgToday, planPastSave, runPastSave, titleDefault,
  type VisitKind,
} from "@/lib/bookJobPath";

const firstFitLabel = DEFAULT_STEPS.find((s) => s.step_key === FIRST_FIT_STEP)?.label || "First fit (sleeves & drains)";

async function houseForTitle(customerId: string, title: string, description?: string | null) {
  if (!customerId || !title) return null;
  const { data: projects, error } = await db.from("projects").select("id").eq("customer_id", customerId);
  if (error || !projects?.length) return null;
  const ids = projects.map((p: { id: string }) => p.id);
  const { data: houses, error: hErr } = await db.from("project_houses").select("id, house_no").in("project_id", ids);
  if (hErr || !houses?.length) return null;
  return (houses as { id: string; house_no: string }[]).find((h) => namesHouse(title, h.house_no) || namesHouse(description, h.house_no)) || null;
}

export async function syncHouseFirstFit(houseId: string, done: boolean): Promise<void> {
  const { data, error } = await db.from("project_house_steps").select("id, done").eq("house_id", houseId).eq("step_key", FIRST_FIT_STEP).maybeSingle();
  if (error) throw error;
  if (!data) {
    if (!done) return;
    const ins = await db.from("project_house_steps").insert({
      house_id: houseId, step_key: FIRST_FIT_STEP, label: firstFitLabel, rate: 0, sort_order: 0, done: true,
    });
    if (ins.error) throw ins.error;
    return;
  }
  if (!!data.done === done) return;
  const upd = await db.from("project_house_steps").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", data.id);
  if (upd.error) throw upd.error;
}

async function backfill(jobId: string, input: {
  techId: string; date: string; arrive: string; leave: string; note: string; completed: boolean; visitKinds: VisitKind[]; customLabel?: string | null;
}): Promise<string> {
  const { data, error } = await (supabase.rpc as any)("admin_backfill_visit", {
    p_job: jobId,
    p_tech: input.techId,
    p_date: input.date,
    p_arrive: input.arrive,
    p_leave: input.leave || null,
    p_completed: input.completed,
    p_note: input.note || null,
    p_visit_kinds: input.visitKinds,
    p_visit_custom: input.customLabel?.trim() || null,
  });
  if (error) throw error;
  return (data as { time_entry_id?: string } | null)?.time_entry_id || "";
}

export async function logPastVisit(input: {
  isAdmin: boolean;
  companyId: string;
  userId: string | null;
  customerId: string;
  projectName: string;
  house: { id: string; house_no: string } | null;
  existingJob: { id: string } | null;
  visitKinds: VisitKind[];
  customLabel?: string | null;
  techId: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  completed: boolean;
  title: string;
  address: string;
  otherKinds?: VisitKind[];
}): Promise<{ jobId: string; entryId: string; createdJob: boolean }> {
  const plan = planPastSave({
    doing: "past",
    visitKinds: input.visitKinds,
    customLabel: input.customLabel,
    existingJobId: input.existingJob?.id ?? null,
    completed: input.completed,
    date: input.date,
    today: johannesburgToday(),
    role: { isAdmin: input.isAdmin },
  });
  const created = { job: false };
  const house = input.house || await houseForTitle(input.customerId, input.title, input.address);
  const knowsOther = input.otherKinds !== undefined;
  const firstFitDone = includesFirstFix(input.visitKinds) || includesFirstFix(input.otherKinds);
  const result = await runPastSave(plan, input.existingJob?.id ?? null, {
    createJob: async () => {
      const title = input.title.trim() || titleDefault(input.projectName || "Job", input.house?.house_no || "", input.visitKinds, input.customLabel);
      const row = installationJobInsert({
        companyId: input.companyId,
        customerId: input.customerId,
        title,
        description: input.house ? `${input.projectName} House ${input.house.house_no}` : (input.note || null),
        address: input.address || (input.house ? `${input.projectName} House ${input.house.house_no}` : null),
        userId: input.userId,
      });
      const { data, error } = await supabase.from("jobs").insert(row).select("id").single();
      if (error) throw error;
      created.job = true;
      return data.id;
    },
    backfill: (jobId) => backfill(jobId, input),
    correct: async () => { throw new Error("not a correction"); },
    syncFirstFit: house && (includesFirstFix(input.visitKinds) || knowsOther) ? (done) => syncHouseFirstFit(house.id, done) : undefined,
    firstFitDone,
  });
  return { ...result, createdJob: created.job };
}

export async function correctPastVisit(input: {
  isAdmin: boolean;
  house: { id: string } | null;
  customerId?: string | null;
  jobTitle?: string | null;
  visitId: string;
  jobId: string;
  visitKinds: VisitKind[];
  customLabel?: string | null;
  techId: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  completed: boolean;
  otherKinds?: VisitKind[];
}): Promise<{ jobId: string; entryId: string }> {
  const house = input.house || (input.customerId ? await houseForTitle(input.customerId, input.jobTitle || "", null) : null);
  const plan = planPastSave({
    doing: "correct",
    visitKinds: input.visitKinds,
    customLabel: input.customLabel,
    existingJobId: input.jobId,
    completed: input.completed,
    date: input.date,
    today: johannesburgToday(),
    role: { isAdmin: input.isAdmin },
    visitId: input.visitId,
  });
  const firstFitDone = includesFirstFix(input.visitKinds) || includesFirstFix(input.otherKinds);
  return runPastSave(plan, input.jobId, {
    createJob: async () => { throw new Error("correct does not create a job"); },
    backfill: async () => { throw new Error("correct does not copy the visit"); },
    correct: async (visitId) => {
      const { data, error } = await (supabase.rpc as any)("admin_correct_visit", {
        p_entry: visitId,
        p_tech: input.techId,
        p_date: input.date,
        p_arrive: input.arrive,
        p_leave: input.leave || null,
        p_completed: input.completed,
        p_note: input.note || null,
        p_visit_kinds: input.visitKinds,
        p_visit_custom: input.customLabel?.trim() || null,
      });
      if (error) throw error;
      const id = (data as { time_entry_id?: string } | null)?.time_entry_id || visitId;
      if (id !== visitId) throw new Error("correct must keep the same visit");
      return id;
    },
    syncFirstFit: house ? (done) => syncHouseFirstFit(house.id, done) : undefined,
    firstFitDone,
  });
}

/** Upcoming visit on the house's existing job. No new job, no booking email. */
export async function bookUpcomingOnJob(input: {
  jobId: string;
  leadId: string | null;
  userId: string | null;
  agentId: string;
  date: string;
  start: string;
  end: string;
}): Promise<void> {
  const { error: asgErr } = await (supabase.from("assignments") as any).insert({
    job_id: input.jobId,
    profile_id: input.agentId,
    assigned_by: input.userId,
    assignment_type: "internal",
    status: "accepted",
  });
  if (asgErr && !/duplicate|unique/i.test(asgErr.message || "")) throw asgErr;
  const { error: schedErr } = await supabase.from("job_schedules").insert({
    lead_id: input.leadId,
    job_id: input.jobId,
    agent_id: input.agentId,
    scheduled_date: input.date,
    start_time: input.start,
    end_time: input.end,
    notes: "Booked from Book a job",
  } as any);
  if (schedErr) throw schedErr;
  const { error: jobErr } = await supabase.from("jobs").update({
    scheduled_for: `${input.date}T${input.start}:00+02:00`,
  }).eq("id", input.jobId);
  if (jobErr) throw jobErr;
}
