import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { laneOf } from "@/lib/leadLane";
import { type Person } from "@/lib/jobsBoard";
import { jobToCard } from "@/lib/cardModel";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { activeAssignee, type DJob } from "@/lib/dispatchCards";
import { jhbMinutes, jhbIso, monthGrid, type ChipKey } from "@/lib/jobsCalm";
import { assembleScheduleBlocks } from "@/lib/bookingGlance";
import AssignTechDialog from "@/components/jobs/AssignTechDialog";
import LeadAssignDialog from "@/components/jobs/LeadAssignDialog";
import ReassignRequestsBanner from "@/components/jobs/ReassignRequestsBanner";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import V8PipelineBoard from "@/components/v8/V8PipelineBoard";
import { isAssigned } from "@/lib/assignedLabel";
import JobsCalmView, { type CalmLead, type CalmTab, type CalmUnassigned } from "./JobsCalmView";

type Job = DJob & { address?: string | null; customer_id?: string | null; created_at?: string | null; customers?: { name?: string | null; phone?: string | null } | null; customer_locations?: { address?: string | null } | null };
const JOB_COLS = "id, title, status, priority, scheduled_for, scheduled_until, estimated_duration, started_at, job_type, address, customer_id, created_at, customers(name, phone), customer_locations!jobs_location_id_fkey(address), assignments(id, profile_id, status, profiles!assignments_profile_id_fkey(full_name, phone, participant_type))";
const CLOSED = ["completed", "cancelled", "canceled"];
const plusDay = (d: string, n: number) => todayInJohannesburg(new Date(new Date(`${d}T12:00:00+02:00`).getTime() + n * 86_400_000));
const ageLabel = (iso?: string | null) => { if (!iso) return null; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${Math.max(0, m)}m`; };

/** Calm Jobs page (the only Jobs page since 20 Oct). Reuses the Dispatch · Cards queries and the existing assign / create / open flows. */
export default function JobsCalm({ initialTab = "today", salesOnly = false, initialDay, initialAssign }: { initialTab?: CalmTab; salesOnly?: boolean; initialDay?: string; initialAssign?: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<CalmTab>(initialTab);
  const [chip, setChip] = useState<ChipKey | null>(null);
  const [who, setWho] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  // Lead Assign opens right here (29 Oct): the old /admin/dispatch?assign hop never mounted the dispatch page.
  const [assignLeadId, setAssignLeadId] = useState<string | null>(initialAssign || null);
  useEffect(() => { if (initialAssign) setAssignLeadId(initialAssign); }, [initialAssign]);
  const [showCreate, setShowCreate] = useState(false);
  const today = todayInJohannesburg();
  const [sel, setSel] = useState(initialDay || today);
  const cells = monthGrid(sel);
  const from = tab === "week" ? format(startOfWeek(new Date(`${sel}T12:00:00+02:00`), { weekStartsOn: 1 }), "yyyy-MM-dd") : tab === "month" ? cells[0].day : sel;
  const to = tab === "month" ? plusDay(cells[cells.length - 1].day, 1) : plusDay(from, tab === "week" ? 7 : 1);

  const { data: jobs = [] } = useQuery({
    queryKey: ["jobs-calm", from, to], refetchInterval: 30_000, enabled: tab !== "pipeline",
    queryFn: async () => {
      const { data, error } = await (supabase.from("jobs") as any).select(JOB_COLS)
        .gte("scheduled_for", `${from}T00:00:00+02:00`).lt("scheduled_for", `${to}T00:00:00+02:00`).order("scheduled_for").limit(500);
      if (error) throw error;
      return (data || []) as Job[];
    },
  });
  const { data: openJobs = [] } = useQuery({
    queryKey: ["jobs-calm-unassigned"], refetchInterval: 60_000, enabled: tab !== "pipeline",
    queryFn: async () => {
      const { data, error } = await (supabase.from("jobs") as any).select(JOB_COLS)
        .not("status", "in", `(${CLOSED.join(",")})`).order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return ((data || []) as Job[]).filter((j) => !activeAssignee(j));
    },
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["dispatch-cards-leads"], refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("leads") as any).select("*")
        .eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const { data: booked = { entries: [], names: {} as Record<string, Person> } } = useQuery({
    queryKey: ["jobs-calm-booked", from, to], refetchInterval: 30_000, enabled: tab !== "pipeline",
    queryFn: async () => {
      const entries = await loadEntries({ from, before: to });
      const ids = [...new Set(entries.map((e) => e.agent_id).filter(Boolean))] as string[];
      const names: Record<string, Person> = {};
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, full_name, participant_type").in("id", ids);
        (data || []).forEach((p: any) => { names[p.id] = p; });
      }
      return { entries, names };
    },
  });

  useEffect(() => {
    const ch = supabase.channel("jobs-calm-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => { qc.invalidateQueries({ queryKey: ["jobs-calm"] }); qc.invalidateQueries({ queryKey: ["jobs-calm-unassigned"] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () => { qc.invalidateQueries({ queryKey: ["jobs-calm"] }); qc.invalidateQueries({ queryKey: ["jobs-calm-unassigned"] }); })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => { qc.invalidateQueries({ queryKey: ["dispatch-cards-leads"] }); qc.invalidateQueries({ queryKey: ["jobs-calm-booked"] }); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  const refresh = () => ["jobs-calm", "jobs-calm-unassigned", "jobs-calm-booked", "dispatch-cards", "jobs-dispatch", "attention-strip"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const move = useMutation({
    mutationFn: async ({ id, iso }: { id: string; iso: string; prev: string | null }) => {
      const { error } = await supabase.from("jobs").update({ scheduled_for: iso, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      refresh();
      toast({ title: `Moved to ${v.iso.slice(11, 16)}`, description: "Undo from the job if needed." + (v.prev ? ` Was ${v.prev.slice(11, 16)}.` : "") });
    },
    onError: (e: any) => toast({ title: "Couldn't move the job", description: e.message, variant: "destructive" }),
  });

  const model = useMemo(() => assembleScheduleBlocks({ jobs, entries: booked.entries, names: booked.names, today }), [jobs, booked, today]);

  // Booked leads keep status "pending"; the rail is for leads nobody has yet (shared isAssigned rule).
  const rail = leads.filter((l) => !isAssigned(l)).sort((a, b) => Number(!!a.first_contact_at) - Number(!!b.first_contact_at) || String(a.created_at).localeCompare(String(b.created_at)));
  const toLead = (l: any): CalmLead => ({ id: l.id, name: l.customer_name || "New lead", place: (l.call_area || (l.customer_address || "").split(",")[0] || "").trim() || null,
    phone: l.customer_phone || null, lane: (laneOf(l) || "sales") as "sales" | "service", createdAt: l.created_at, contacted: !!l.first_contact_at });
  const lateBlocks = model.blocks.filter((b) => b.late && b.day === today);
  const unassigned: CalmUnassigned[] = openJobs.slice(0, 6).map((j) => {
    const c = jobToCard(j);
    return { id: j.id, title: j.customers?.name || j.title || "Job", sub: [c.place, j.title].filter(Boolean).join(" · "), age: ageLabel(j.created_at), lane: c.lane === "sales" ? "sales" : "service" };
  });
  const counts = { leadsNotContacted: rail.filter((l) => !l.first_contact_at).length, late: salesOnly ? lateBlocks.filter((b) => b.block === "sales" || model.people.find((x) => x.id === b.personId)?.lane === "sales").length : lateBlocks.length, unassigned: salesOnly ? 0 : openJobs.length };

  let people = model.people; let blocks = model.blocks;
  // Sales reps (dispatch lockdown 9 Oct): only the sales lane, no tech schedules, no unassigned jobs, no drag.
  if (salesOnly) { people = people.filter((p) => p.lane === "sales"); blocks = blocks.filter((b) => people.some((p) => p.id === b.personId)); }
  if (who === "sales") people = people.filter((p) => p.lane === "sales");
  else if (who === "tech") people = people.filter((p) => p.lane !== "sales");
  else if (who !== "all") people = people.filter((p) => p.id === who);
  if (chip === "late") { blocks = lateBlocks; people = people.filter((p) => blocks.some((b) => b.personId === p.id)); }
  if (tab === "today") blocks = blocks.filter((b) => b.day === sel);
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = plusDay(from, i); return { day: d, label: format(new Date(`${d}T12:00:00+02:00`), "EEE d") }; });
  const leadList = (chip === "leads" ? rail.filter((l) => !l.first_contact_at) : rail).map(toLead);

  return (
    <>
      {!salesOnly && <ReassignRequestsBanner onOpen={setAssignLeadId} />}
      <JobsCalmView tab={tab} onTab={setTab} dateLabel={format(new Date(`${sel}T12:00:00+02:00`), tab === "month" ? "MMMM yyyy" : "EEE d MMM")} onNew={() => setShowCreate(true)}
        leads={showAll || chip === "leads" ? leadList : leadList.slice(0, 3)} leadsTotal={leadList.length} showAllLeads={showAll} onShowAll={() => setShowAll(true)}
        people={people} blocks={blocks} unassigned={salesOnly ? [] : unassigned}
        monthCells={cells} todayDay={today} onPickDay={(d) => { setSel(d); setTab("today"); }} weekDays={weekDays}
        everyone={who} onEveryone={setWho}
        everyoneOptions={[{ value: "all", label: "Everyone ▾" }, { value: "sales", label: "Sales" }, { value: "tech", label: "Technicians" }, ...model.people.filter((p) => !salesOnly || p.lane === "sales").map((p) => ({ value: p.id, label: p.name }))]}
        chip={chip} onChip={setChip} counts={counts}
        onCallLead={() => {}} onAssignLead={(l) => setAssignLeadId(l.id)} onOpenLead={(l) => navigate(isAssigned(l as any) ? `/admin/bookings/${l.id}` : `/admin/dispatch?lead=${l.id}`)}
        onAssignJob={setAssignJobId} onOpenJob={(id) => navigate(`/admin/jobs/${id}`)}
        onOpenBlock={(b) => { if (b.href) navigate(b.href); }}
        onMoveBlock={salesOnly ? undefined : (b, start) => { if (b.kind !== "job" || !b.draggable) return; const j = jobs.find((x) => x.id === b.id); move.mutate({ id: b.id, iso: jhbIso(b.day, start), prev: j?.scheduled_for || null }); }}
        pipeline={<V8PipelineBoard />} nowMin={sel === today ? jhbMinutes(new Date().toISOString()) : null} />
      <LeadAssignDialog leadId={assignLeadId} onClose={() => setAssignLeadId(null)} />
      <AssignTechDialog jobId={assignJobId} onClose={() => { setAssignJobId(null); refresh(); }} />
      <CreateJobDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}

