/**
 * /field (pure technicians): Today. One clear card per job today, next job opened up; tap through to the job pack.
 * No money anywhere. The full old field home is under More → Full field view (/field/all).
 */
import { useContext, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import FieldShell from "@/components/field/FieldShell";
import { Button } from "@/components/ui/button";
import { fetchTodaysJobs, todayInJohannesburg, type CalendarEntry } from "@/lib/todaysJobs";
import { primeJobPack } from "@/lib/jobPack";
import { V8BarContext } from "@/components/v8/v8BarContext";
import RoleMapFrame from "@/components/v8/roleHome/RoleMapFrame";
import { TechHomeScreen, type HomeJob } from "@/components/v8/roleHome/screens";
import { loadMaterialCheck } from "@/components/v8/roleHome/data";
import { checkKindOf, type MaterialCheck } from "@/lib/materialCheck";
import { areaFromAddress, greetingEyebrow, greetingTitle, jobTypeWord } from "@/lib/roleHome";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";

const CACHE = (uid: string) => `fls.today.${uid}`;

type JobRow = { id: string; title: string | null; description: string | null; job_type: string | null; status: string | null; site_check_status: string | null; customers?: { phone?: string | null } | null };

const timeOf = (e: CalendarEntry) => (e.start_time ? e.start_time.slice(0, 5) : "Any time");

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
  useEffect(() => {
    jobIds.forEach((id) => { if (navigator.onLine) void primeJobPack(id); });
    const ch = supabase.channel("field-today-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, () => qc.invalidateQueries({ queryKey: ["my-jobs"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "job_schedules" }, () => qc.invalidateQueries({ queryKey: ["my-jobs"] }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc, jobIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  const identity = useSignedInIdentity();
  const v8 = useContext(V8BarContext);
  const checks = useQuery({
    queryKey: ["today-material-checks", jobIds.join(","), (jobs.data || []).map((j) => `${j.id}:${j.job_type || ""}`).join(",")],
    enabled: jobIds.length > 0 && !!jobs.data,
    queryFn: async () => {
      const out: Record<string, MaterialCheck> = {};
      await Promise.all(jobIds.map(async (id) => {
        const job = byId.get(id);
        out[id] = await loadMaterialCheck(id, checkKindOf({ jobType: job?.job_type, title: job?.title }), null);
      }));
      return out;
    },
  });
  const homeJobs: HomeJob[] = open.map((e) => ({
    id: e.job_id || e.key,
    href: e.job_id ? `/field/jobs/${e.job_id}` : e.lead_id ? `/field?lead=${e.lead_id}` : "/field/schedule",
    time: timeOf(e) === "Any time" ? "Anytime" : timeOf(e),
    type: jobTypeWord(e.job_id ? byId.get(e.job_id)?.job_type : null, e.job_id ? byId.get(e.job_id)?.title : null),
    area: areaFromAddress(e.customer_address),
    client: e.customer_name || "Client",
    check: e.job_id ? checks.data?.[e.job_id] || null : null,
  }));
  const screen = (
    <div data-testid="field-today">
      {day.isLoading ? <p className="rh-muted">Loading today’s jobs…</p> : day.error ? (
        <p className="rh-muted">Couldn’t load today’s jobs. Pull to refresh when you have signal.</p>
      ) : (
        <TechHomeScreen eyebrow={greetingEyebrow(new Date())} title={greetingTitle(new Date(), identity?.name)} jobs={homeJobs} />
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <Button asChild variant="outline" className="min-h-[48px]"><Link to="/admin/my-jobs"><Briefcase className="mr-1 h-4 w-4" />Job offers</Link></Button>
        <Link to="/field/schedule" className="fl-btn-text inline-flex items-center" data-testid="today-week">See the week →</Link>
      </div>
    </div>
  );
  const framed = <RoleMapFrame fill={v8}>{screen}</RoleMapFrame>;
  if (v8) return framed;
  return <FieldShell title="Today">{framed}</FieldShell>;
}
