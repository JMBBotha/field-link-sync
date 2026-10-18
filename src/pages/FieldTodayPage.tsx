/**
 * /field (pure technicians): Today. One clear card per job today, next job opened up; tap through to the job pack.
 * No money anywhere. The full old field home is under More → Full field view (/field/all).
 */
import { useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Briefcase, ChevronRight, MapPin, Navigation, Phone, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import FieldShell from "@/components/field/FieldShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JobCardListSkeleton } from "@/components/ui/skeletons";
import JobCard from "@/components/cards/JobCard";
import { scheduleRowToCard } from "@/lib/cardModel";
import { fetchTodaysJobs, todayInJohannesburg, type CalendarEntry } from "@/lib/todaysJobs";
import { FrontPhoto, useSurveyPack } from "@/components/survey/SurveyPackSection";
import { cachePackFiles, pipeSummary } from "@/lib/siteSurvey/pack";
import { primeJobPack } from "@/lib/jobPack";

const CACHE = (uid: string) => `fls.today.${uid}`;

type JobRow = { id: string; title: string | null; description: string | null; job_type: string | null; status: string | null; site_check_status: string | null; customers?: { phone?: string | null } | null };

function statusPill(job: JobRow | undefined, survey: boolean) {
  const st = job?.status ?? "";
  if (st === "in_progress") return <Badge className="bg-primary">In progress</Badge>;
  if (job?.site_check_status === "awaiting_pricing" || job?.site_check_status === "awaiting_client") return <Badge variant="outline" className="border-orange-300 text-orange-700">Variation waiting</Badge>;
  if (job?.site_check_status === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700">Site checked</Badge>;
  if (survey) return <Badge variant="outline" className="border-green-300 text-green-700">Survey done</Badge>;
  return null;
}

const timeOf = (e: CalendarEntry) => (e.start_time ? e.start_time.slice(0, 5) : "Any time");
const navLink = (addr: string | null) => (addr ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}` : null);

function TodayCard({ e, job, open, index }: { e: CalendarEntry; job?: JobRow; open: boolean; index: number }) {
  const navigate = useNavigate();
  const pack = useSurveyPack(e.lead_id);
  const survey = pack.data ?? null;
  useEffect(() => { if (survey && navigator.onLine) void cachePackFiles(survey); }, [survey]);
  useEffect(() => { if (e.job_id && navigator.onLine) void primeJobPack(e.job_id); }, [e.job_id]);
  const pipes = pipeSummary(survey);
  const href = e.job_id ? `/field/jobs/${e.job_id}` : e.lead_id ? `/field?lead=${e.lead_id}` : "/field/schedule";
  const nav = navLink(e.customer_address);
  const phone = job?.customers?.phone ?? null;
  if (!open) return (
    <JobCard item={scheduleRowToCard(e)} audience="tech" density="compact" onOpen={() => navigate(href)} data-testid="today-row"
      actions={statusPill(job, !!survey) ?? undefined} />
  );
  return (
    <Card className="overflow-hidden" data-testid="today-next">
      {survey && <FrontPhoto survey={survey} className="aspect-[16/9] rounded-none" />}
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="secondary">{timeOf(e)} · Job {index + 1}</Badge>
          {statusPill(job, !!survey)}
        </div>
        <div>
          <h2 className="text-lg font-semibold">{e.customer_name || "Client"}</h2>
          {e.customer_address && <p className="flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{e.customer_address}</p>}
        </div>
        {(job?.title || job?.description) && <p className="text-sm"><span className="font-semibold">{job?.title}</span>{job?.description ? <span className="block text-muted-foreground line-clamp-2">{job.description}</span> : null}</p>}
        {pipes.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {pipes.slice(0, 4).map((p) => (
              <div key={p.name} className="rounded-lg bg-muted/50 px-3 py-2">
                <div className="truncate text-xs uppercase tracking-wide text-muted-foreground">{p.name}</div>
                <div className="font-semibold">{p.m != null ? `${p.m} m pipe` : "–"}</div>
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {nav ? <Button asChild variant="outline" className="min-h-[44px]"><a href={nav} target="_blank" rel="noreferrer"><Navigation className="mr-1 h-4 w-4" />Navigate</a></Button>
            : <Button variant="outline" className="min-h-[44px]" disabled><Navigation className="mr-1 h-4 w-4" />No address</Button>}
          {phone ? <Button asChild variant="outline" className="min-h-[44px]"><a href={`tel:${phone}`}><Phone className="mr-1 h-4 w-4" />Call client</a></Button>
            : <Button variant="outline" className="min-h-[44px]" disabled><Phone className="mr-1 h-4 w-4" />No phone</Button>}
        </div>
        <Button className="w-full min-h-[48px]" onClick={() => navigate(href)} data-testid="today-open-pack">Open job pack<ChevronRight className="ml-1 h-4 w-4" /></Button>
      </CardContent>
    </Card>
  );
}

export default function FieldTodayPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const date = todayInJohannesburg();
  const day = useQuery({
    queryKey: ["my-jobs", user?.id, "today", date],
    enabled: !!user,
    queryFn: async () => {
      try {
        const d = await fetchTodaysJobs({ date, agentId: user!.id });
        try { localStorage.setItem(CACHE(user!.id), JSON.stringify({ date, open: d.open, total: d.total, completed: d.completed })); } catch { /* ignore */ }
        return d;
      } catch (e) {
        const raw = localStorage.getItem(CACHE(user!.id));
        const c = raw ? JSON.parse(raw) : null;
        if (c && c.date === date) return c;
        throw e;
      }
    },
  });
  const open: CalendarEntry[] = useMemo(() => [...(day.data?.open ?? [])].sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99")), [day.data]);
  const jobIds = open.map((e) => e.job_id).filter(Boolean) as string[];
  const jobs = useQuery({
    queryKey: ["my-jobs", user?.id, "today-jobs", jobIds.join(",")],
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const key = `fls.todayJobs.${user?.id}`;
      try {
        const { data, error } = await (supabase as any).from("jobs").select("id, title, description, job_type, status, site_check_status, customers(phone)").in("id", jobIds);
        if (error) throw error;
        try { localStorage.setItem(key, JSON.stringify(data ?? [])); } catch { /* ignore */ }
        return (data ?? []) as JobRow[];
      } catch (e) {
        const raw = localStorage.getItem(key);
        if (raw) return JSON.parse(raw) as JobRow[];
        throw e;
      }
    },
  });
  const byId = new Map((jobs.data ?? []).map((j) => [j.id, j]));
  const tomorrow = useQuery({
    queryKey: ["my-jobs", user?.id, "tomorrow-count"],
    enabled: !!user && navigator.onLine,
    queryFn: async () => {
      const t = new Date(`${date}T12:00:00`); t.setDate(t.getDate() + 1);
      const d = await fetchTodaysJobs({ date: format(t, "yyyy-MM-dd"), agentId: user!.id });
      return d.open.length;
    },
  });
  useEffect(() => {
    const ch = supabase.channel("field-today-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => qc.invalidateQueries({ queryKey: ["my-jobs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "job_schedules" }, () => qc.invalidateQueries({ queryKey: ["my-jobs"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);
  const nextIdx = Math.max(0, open.findIndex((e) => (byId.get(e.job_id ?? "")?.status ?? "") !== "completed"));
  return (
    <FieldShell title="Today">
      <div className="space-y-3" data-testid="field-today">
        <div className="flex items-end justify-between gap-2">
          <div>
            <div className="v8-eyebrow">Technician</div>
            <p className="text-sm text-muted-foreground">{format(new Date(`${date}T12:00:00`), "EEEE d MMMM")} · {open.length} job{open.length === 1 ? "" : "s"}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["my-jobs"] })}><RefreshCw className="mr-1 h-4 w-4" />Refresh</Button>
        </div>
        {day.isLoading ? <JobCardListSkeleton rows={2} /> : day.error ? (
          <Card><CardContent className="p-4 text-sm">Couldn't load today's jobs. Pull to refresh when you have signal.</CardContent></Card>
        ) : open.length === 0 ? (
          <Card><CardContent className="space-y-1 p-6 text-center">
            <p className="font-semibold">No jobs today</p>
            <p className="text-sm text-muted-foreground">New job offers show under More → Job offers.</p>
          </CardContent></Card>
        ) : open.map((e, i) => <TodayCard key={e.key} e={e} job={e.job_id ? byId.get(e.job_id) : undefined} open={i === nextIdx} index={i} />)}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Button asChild variant="outline" className="min-h-[44px]"><Link to="/admin/my-jobs"><Briefcase className="mr-1 h-4 w-4" />Job offers</Link></Button>
          <Button asChild variant="outline" className="min-h-[44px]"><Link to="/field/schedule">Week{tomorrow.data != null ? ` · ${tomorrow.data} tomorrow` : ""}</Link></Button>
        </div>
      </div>
    </FieldShell>
  );
}
