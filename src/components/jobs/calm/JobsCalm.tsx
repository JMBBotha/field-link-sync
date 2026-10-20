import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfWeek } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { laneOf } from "@/lib/leadLane";
import { type Person } from "@/lib/jobsBoard";
import { jobToCard, visitToCard, visibleVisitEntries } from "@/lib/cardModel";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { activeAssignee, type DJob } from "@/lib/dispatchCards";
import { blockKind, jhbMinutes, jhbIso, monthGrid, type ChipKey } from "@/lib/jobsCalm";
import AssignTechDialog from "@/components/jobs/AssignTechDialog";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import V8PipelineBoard from "@/components/v8/V8PipelineBoard";
import JobsCalmView, { type CalmBlock, type CalmLead, type CalmPerson, type CalmTab, type CalmUnassigned } from "./JobsCalmView";

type Job = DJob & { address?: string | null; customer_id?: string | null; created_at?: string | null; customers?: { name?: string | null; phone?: string | null } | null; customer_locations?: { address?: string | null } | null };
const JOB_COLS = "id, title, status, priority, scheduled_for, started_at, job_type, address, customer_id, created_at, customers(name, phone), customer_locations!jobs_location_id_fkey(address), assignments(id, profile_id, status, profiles!assignments_profile_id_fkey(full_name, phone, participant_type))";
const CLOSED = ["completed", "cancelled", "canceled"];
const PILL: Record<string, string> = { completed: "Done", in_progress: "On site", dispatched: "En route", scheduled: "Scheduled" };
const plusDay = (d: string, n: number) => todayInJohannesburg(new Date(new Date(`${d}T12:00:00+02:00`).getTime() + n * 86_400_000));
const ageLabel = (iso?: string | null) => { if (!iso) return null; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${Math.max(0, m)}m`; };

/** Calm Jobs page (flag ?jobs=calm). Reuses the Dispatch · Cards queries and the existing assign / create / open flows. */
export default function JobsCalm({ initialTab = "today", salesOnly = false }: { initialTab?: CalmTab; salesOnly?: boolean }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<CalmTab>(initialTab);
  const [chip, setChip] = useState<ChipKey | null>(null);
  const [who, setWho] = useState("all");
  const [showAll, setShowAll] = useState(false);
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const today = todayInJohannesburg();
  const [sel, setSel] = useState(today);
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

  const model = useMemo(() => {
    const people: Record<string, CalmPerson & { lane: "sales" | "service" }> = {};
    const blocks: CalmBlock[] = [];
    jobs.filter((j) => !["cancelled", "canceled"].includes(String(j.status || "").toLowerCase())).forEach((j) => {
      const c = jobToCard(j); const a = activeAssignee(j) as any; const s = String(j.status || "").toLowerCase();
      const pid = a?.profile_id || null;
      if (pid && !people[pid]) people[pid] = { id: pid, name: a?.profiles?.full_name || "Assigned", role: c.lane === "sales" ? "Sales" : "Tech", dot: "grey", lane: c.lane === "sales" ? "sales" : "service" };
      if (pid && s === "in_progress") people[pid].dot = "green";
      else if (pid && s === "dispatched" && people[pid].dot !== "green") people[pid].dot = "orange";
      const late = c.urgency.key === "late";
      blocks.push({ id: j.id, kind: "job", personId: pid, day: j.scheduled_for ? todayInJohannesburg(new Date(j.scheduled_for)) : today, start: jhbMinutes(j.scheduled_for), dur: 120,
        title: `${j.job_type ? `${j.job_type[0].toUpperCase()}${j.job_type.slice(1)}` : ""}${j.job_type && j.title ? " · " : ""}${j.title || ""}` || "Job",
        place: c.place, block: blockKind(c, j.job_type), pill: late ? null : PILL[s] || null, late, draggable: s !== "completed" && !!j.scheduled_for });
    });
    visibleVisitEntries(booked.entries).filter((e) => !e.job_id && e.lead_id && !["cancelled", "canceled", "resolved_before_visit"].includes(e.status || "")).forEach((e) => {
      const c = visitToCard(e, booked.names); const pid = e.agent_id;
      if (pid && !people[pid]) people[pid] = { id: pid, name: booked.names[pid]?.full_name || "Assigned", role: c.lane === "sales" ? "Sales" : "Tech", dot: "grey", lane: c.lane === "sales" ? "sales" : "service" };
      const start = e.start_time ? Number(e.start_time.slice(0, 2)) * 60 + Number(e.start_time.slice(3, 5)) : null;
      blocks.push({ id: `v-${e.key}`, kind: "visit", personId: pid, day: e.date, start, dur: 60, title: c.lane === "sales" ? `Sales visit · ${c.title}` : c.title,
        place: c.place, block: blockKind(c), late: c.urgency.key === "late", pill: c.urgency.key === "done" ? "Done" : null });
    });
    Object.values(people).forEach((p) => { if (p.dot === "grey" && blocks.some((b) => b.personId === p.id && b.day === today && b.block !== "done")) p.dot = "blue"; });
    return { people: Object.values(people).sort((a, b) => a.role.localeCompare(b.role) * -1 || a.name.localeCompare(b.name)), blocks };
  }, [jobs, booked, today]);

  const rail = leads.slice().sort((a, b) => Number(!!a.first_contact_at) - Number(!!b.first_contact_at) || String(a.created_at).localeCompare(String(b.created_at)));
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
      <JobsCalmView tab={tab} onTab={setTab} dateLabel={format(new Date(`${sel}T12:00:00+02:00`), tab === "month" ? "MMMM yyyy" : "EEE d MMM")} onNew={() => setShowCreate(true)}
        leads={showAll || chip === "leads" ? leadList : leadList.slice(0, 3)} leadsTotal={leadList.length} showAllLeads={showAll} onShowAll={() => setShowAll(true)}
        people={people} blocks={blocks} unassigned={salesOnly ? [] : unassigned}
        monthCells={cells} todayDay={today} onPickDay={(d) => { setSel(d); setTab("today"); }} weekDays={weekDays}
        everyone={who} onEveryone={setWho}
        everyoneOptions={[{ value: "all", label: "Everyone ▾" }, { value: "sales", label: "Sales" }, { value: "tech", label: "Technicians" }, ...model.people.filter((p) => !salesOnly || p.lane === "sales").map((p) => ({ value: p.id, label: p.name }))]}
        chip={chip} onChip={setChip} counts={counts}
        onCallLead={() => {}} onAssignLead={(l) => navigate(`/admin/dispatch?lead=${l.id}`)} onOpenLead={(l) => navigate(`/admin/dispatch?lead=${l.id}`)}
        onAssignJob={setAssignJobId} onOpenJob={(id) => navigate(`/admin/jobs/${id}`)}
        onOpenBlock={(b) => b.kind === "job" ? navigate(`/admin/jobs/${b.id}`) : navigate(`/admin/dispatch?lead=${(booked.entries.find((e) => `v-${e.key}` === b.id)?.lead_id) || ""}`)}
        onMoveBlock={salesOnly ? undefined : (b, start) => { if (b.kind !== "job" || !b.draggable) return; const j = jobs.find((x) => x.id === b.id); move.mutate({ id: b.id, iso: jhbIso(b.day, start), prev: j?.scheduled_for || null }); }}
        pipeline={<V8PipelineBoard />} nowMin={sel === today ? jhbMinutes(new Date().toISOString()) : null} />
      <AssignTechDialog jobId={assignJobId} onClose={() => { setAssignJobId(null); refresh(); }} />
      <CreateJobDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}

