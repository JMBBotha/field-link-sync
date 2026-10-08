import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useUndoAction } from "@/components/shared/StatusUndo";
import { cn } from "@/lib/utils";
import { laneOf, LANE_META, type LeadLane } from "@/lib/leadLane";
import { boardLane, rowTarget, type Person } from "@/lib/jobsBoard";
import JobCard from "@/components/cards/JobCard";
import { jobToCard, visitToCard } from "@/lib/cardModel";
import { loadEntries, todayInJohannesburg } from "@/lib/todaysJobs";
import { sortDispatchJobs, techStrip, activeAssignee, NEXT_STATUS, type DJob } from "@/lib/dispatchCards";
import LeadCardV2 from "@/components/leads/LeadCardV2";
import AssignTechDialog from "@/components/jobs/AssignTechDialog";
import { Button } from "@/components/ui/button";
import { Phone, Users, Zap, ArrowRight, Check, Receipt } from "lucide-react";

type Job = DJob & {
  company_id?: string | null; customer_id?: string | null; invoice_id?: string | null; address?: string | null;
  customers?: { name?: string | null; phone?: string | null } | null; customer_locations?: { address?: string | null } | null;
};
const initials = (n?: string | null) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const STATE: Record<string, { label: string; dot: string }> = {
  on_site: { label: "On site", dot: "bg-emerald-500" }, en_route: { label: "En route", dot: "bg-orange-500" },
  next: { label: "Next", dot: "bg-blue-500" }, done: { label: "Done for today", dot: "bg-slate-400" },
};

/** Dispatch · Cards: new leads (Lead card v2) · the day's jobs, most urgent first · techs today. No money shown. */
export default function DispatchCards() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const statusUndo = useUndoAction();
  const [dayKey, setDayKey] = useState<"today" | "tomorrow">("today");
  const [lane, setLane] = useState<"all" | LeadLane>("all");
  const [assignJobId, setAssignJobId] = useState<string | null>(null);
  const now = new Date();
  const day = todayInJohannesburg(new Date(now.getTime() + (dayKey === "tomorrow" ? 86_400_000 : 0)));

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ["dispatch-cards", day],
    refetchInterval: 30_000,
    queryFn: async () => {
      const next = todayInJohannesburg(new Date(new Date(`${day}T12:00:00+02:00`).getTime() + 86_400_000));
      const { data, error } = await (supabase.from("jobs") as any)
        .select("id, title, status, priority, scheduled_for, started_at, job_type, address, company_id, customer_id, invoice_id, customers(name, phone), customer_locations!jobs_location_id_fkey(address), assignments(id, profile_id, status, profiles!assignments_profile_id_fkey(full_name, phone))")
        .gte("scheduled_for", `${day}T00:00:00+02:00`).lt("scheduled_for", `${next}T00:00:00+02:00`)
        .order("scheduled_for", { ascending: true }).limit(300);
      if (error) throw error;
      return (data || []) as Job[];
    },
  });
  const { data: leads = [] } = useQuery({
    queryKey: ["dispatch-cards-leads"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("leads") as any).select("*")
        .eq("status", "pending").is("deleted_at", null).is("merged_into_id", null).order("created_at", { ascending: true }).limit(100);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const { data: booked = { entries: [], names: {} as Record<string, Person> }, isLoading: visitsLoading } = useQuery({
    queryKey: ["jobs-dispatch-booked", day],
    refetchInterval: 30_000,
    queryFn: async () => {
      const entries = await loadEntries({ date: day });
      const ids = [...new Set(entries.map((e) => e.agent_id).filter(Boolean))] as string[];
      const names: Record<string, Person> = {};
      if (ids.length) {
        const { data } = await supabase.from("profiles").select("id, full_name, participant_type").in("id", ids);
        (data || []).forEach((p: any) => { names[p.id] = p; });
      }
      return { entries, names };
    },
  });

  const shown = useMemo(
    () => sortDispatchJobs(jobs.filter((j) => lane === "all" || boardLane({ kind: "job", id: j.id, status: j.status ?? "", job: j }) === lane), day, new Date()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, lane, day],
  );
  const cards = [
    ...shown.map((job) => ({ item: jobToCard(job), job, entry: null })),
    ...booked.entries.filter((e) => !e.job_id && e.lead_id && e.date === day && !["cancelled", "canceled"].includes(e.status || ""))
      .map((entry) => ({ item: visitToCard(entry, booked.names), job: null, entry })),
  ].filter(({ item }) => lane === "all" || item.lane === lane)
    .sort((a, b) => a.item.urgency.rank - b.item.urgency.rank
      || (a.item.scheduledFor || "~").localeCompare(b.item.scheduledFor || "~")
      || a.item.title.localeCompare(b.item.title));
  const rail = leads
    .filter((l) => lane === "all" || (laneOf(l) || "sales") === lane)
    .sort((a, b) => Number(!!a.first_contact_at) - Number(!!b.first_contact_at) || String(a.created_at).localeCompare(String(b.created_at)));
  const techs = techStrip(shown, now);
  const dayCounts = Object.fromEntries(techs.map((t) => [t.id, t.jobs]));

  // Live: jobs, techs and lead bookings (keeps the 30 s poll as a fallback)
  useEffect(() => {
    const ch = supabase
      .channel("dispatch-cards-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => qc.invalidateQueries({ queryKey: ["dispatch-cards"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "assignments" }, () => qc.invalidateQueries({ queryKey: ["dispatch-cards"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => qc.invalidateQueries({ queryKey: ["dispatch-cards-leads"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["dispatch-cards"] }); qc.invalidateQueries({ queryKey: ["jobs-dispatch"] }); qc.invalidateQueries({ queryKey: ["attention-strip"] }); };
  const move = useMutation({
    mutationFn: async ({ job, status }: { job: Job; status: string }) => {
      const { error } = await supabase.from("jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", job.id);
      if (error) throw error;
      return { job, status };
    },
    onSuccess: ({ job, status }) => {
      refresh();
      const entry = statusUndo.record({ entity_type: "job", entity_id: job.id, field: "status", old_value: job.status ?? null, new_value: status, label: job.title || "Job", company_id: job.company_id ?? null });
      toast({ title: `Moved to ${status.replace(/_/g, " ")}`, action: statusUndo.action(entry) });
    },
    onError: (e: any) => toast({ title: "Status update failed", description: e.message, variant: "destructive" }),
  });
  const auto = useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke("dispatch-job", { body: { job_id: jobId, dispatched_by: user?.id || null, override_assignee_id: null } });
      if (error) throw error;
      return data;
    },
    onSuccess: (data: any) => {
      toast(data?.success ? { title: "Auto-dispatched", description: `Assigned via ${data.assignment_type} (Tier ${data.tier_used})` }
        : { title: "No available assignees", description: data?.message || "Dispatcher notified", variant: "destructive" });
      refresh();
    },
    onError: (e: any) => toast({ title: "Auto-dispatch failed", description: e.message, variant: "destructive" }),
  });

  const jobCard = (j: (typeof shown)[number]) => {
    const a = activeAssignee(j);
    const s = String(j.status || "").toLowerCase();
    const nxt = a ? NEXT_STATUS[s] : undefined;
    return <JobCard key={j.id} item={jobToCard(j)} density="full" audience="office"
      onOpen={() => navigate(`/admin/jobs/${j.id}`)}
      actions={<>
          {!a && s !== "completed" && <>
            <Button size="sm" variant="destructive" className="h-7 gap-1 px-2 text-xs" onClick={() => setAssignJobId(j.id)}><Users className="h-3.5 w-3.5" /> Assign tech</Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={auto.isPending} onClick={() => auto.mutate(j.id)}><Zap className="h-3.5 w-3.5" /> Auto</Button>
          </>}
          {a?.profiles?.phone && s !== "completed" && <Button asChild size="sm" className="h-7 gap-1 px-2 text-xs"><a href={`tel:${a.profiles.phone}`}><Phone className="h-3.5 w-3.5" /> Call tech</a></Button>}
          {j.customers?.phone && s !== "completed" && <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"><a href={`tel:${j.customers.phone}`}><Phone className="h-3.5 w-3.5" /> Client</a></Button>}
          {nxt && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" disabled={move.isPending} onClick={() => move.mutate({ job: j, status: nxt.to })}>
            {nxt.to === "completed" ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />} {nxt.label}</Button>}
          {s === "completed" && j.invoice_id && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate(`/admin/invoices/${j.invoice_id}`)}><Receipt className="h-3.5 w-3.5" /> Invoice</Button>}
      </>}
      menuItems={[
        { label: "Open job", onSelect: () => navigate(`/admin/jobs/${j.id}`) },
        { label: a ? "Reassign tech" : "Assign tech", onSelect: () => setAssignJobId(j.id) },
        { label: "Reschedule in calendar", onSelect: () => navigate("/admin/dispatch") },
        { label: "Open client", hidden: !j.customer_id, onSelect: () => navigate(`/admin/customers/${j.customer_id}`) },
      ]} />;
  };

  return (
    <div className="space-y-3" data-dispatch-cards>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          {(["today", "tomorrow"] as const).map((k) => (
            <button key={k} onClick={() => setDayKey(k)} className={cn("rounded px-2.5 py-1 text-xs font-medium", dayKey === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {k === "today" ? "Today" : "Tomorrow"}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border p-0.5">
          {(["all", "sales", "service"] as const).map((k) => (
            <button key={k} onClick={() => setLane(k)} className={cn("rounded px-2.5 py-1 text-xs font-medium", lane === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {k === "all" ? "All" : LANE_META[k].label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{format(new Date(`${day}T12:00:00+02:00`), "EEE d MMM")}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)_220px]">
        <section className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground">NEW LEADS · FIRST CONTACT <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-white">{rail.length}</span></h3>
          {rail.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">No new leads</div>
            : rail.map((l) => <LeadCardV2 key={l.id} lead={l} onOpen={() => navigate(`/admin/dispatch?lead=${l.id}`)} />)}
        </section>

        <section className="min-w-0 space-y-2">
          <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground">
            {dayKey === "today" ? "TODAY'S" : "TOMORROW'S"} JOBS · MOST URGENT FIRST <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-white">{cards.length}</span>
          </h3>
          {isLoading || visitsLoading ? <div className="p-6 text-sm text-muted-foreground">Loading jobs…</div>
            : cards.length === 0 ? <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No jobs {dayKey === "today" ? "today" : "tomorrow"}</div>
            : <div className="grid gap-2 xl:grid-cols-2">{cards.map(({ item, job, entry }) => job ? jobCard(job) : <JobCard key={`visit-${item.id}`}
              item={item} density="full" audience="office" onOpen={() => navigate(rowTarget({ kind: "lead", id: item.id }))}
              menuItems={[
                { label: "Open lead", onSelect: () => navigate(rowTarget({ kind: "lead", id: item.id })) },
                { label: "Open client", hidden: !entry?.customer_id, onSelect: () => navigate(`/admin/customers/${entry?.customer_id}`) },
              ]} />)}</div>}
        </section>

        <section className="min-w-0 space-y-2">
          <h3 className="text-xs font-bold tracking-wide text-muted-foreground">TECHS {dayKey === "today" ? "TODAY" : "TOMORROW"}</h3>
          {techs.length === 0 ? <div className="rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">No techs booked</div> : techs.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-xl border bg-card p-2.5" data-tech-row>
              <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-bold text-white">
                {initials(t.name)}<span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card", STATE[t.state].dot)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{t.name}</div>
                <div className={cn("truncate text-[11px]", t.late ? "text-red-600" : "text-muted-foreground")}>
                  {STATE[t.state].label}{t.state === "next" && t.next ? ` ${format(new Date(t.next), "HH:mm")}` : ""} · {t.jobs} job{t.jobs === 1 ? "" : "s"}{t.late ? ` · ${t.late} late` : ""}
                </div>
                <div className="mt-1 h-1 rounded bg-muted"><div className="h-1 rounded bg-blue-600" style={{ width: `${Math.min(100, t.jobs * 25)}%` }} /></div>
              </div>
            </div>
          ))}
        </section>
      </div>

      <AssignTechDialog jobId={assignJobId} onClose={() => { setAssignJobId(null); refresh(); }} dayCounts={dayCounts} />
    </div>
  );
}
