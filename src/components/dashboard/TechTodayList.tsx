import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { hhmm } from "@/lib/leadClock";
import { URGENCY_CLASS, URGENCY_ICON } from "./LeadToPaidPanel";
import type { Urgency } from "@/lib/leadFlow";

/** Techs: today's allocated jobs in time order only (no funnel, no leads). Red only if late; one pulse = next job. */
export default function TechTodayList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data = [], isLoading } = useQuery({
    queryKey: ["tech-today", user?.id],
    enabled: !!user?.id,
    refetchInterval: 60_000,
    queryFn: async () => {
      const tz = 2 * 3600_000, day = 86400_000, s = Math.floor((Date.now() + tz) / day) * day - tz;
      const { data: a } = await supabase.from("assignments").select("job_id").eq("profile_id", user!.id);
      const ids = ((a as any[]) || []).map((r) => r.job_id);
      if (!ids.length) return [];
      const { data: j } = await supabase.from("jobs").select("id, title, address, status, scheduled_for, started_at, completed_at")
        .in("id", ids).gte("scheduled_for", new Date(s).toISOString()).lt("scheduled_for", new Date(s + day).toISOString()).order("scheduled_for");
      return ((j as any[]) || []).filter((x) => x.status !== "cancelled");
    },
  });
  const now = Date.now();
  const firstOpen = data.findIndex((j: any) => !j.completed_at && j.status !== "completed");
  return (
    <section data-testid="tech-today" className="rounded-xl border border-[#d6d9de] bg-[#eef0f3] p-3 text-[#111827] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
      <h2 className="px-1 text-base font-extrabold">Today's jobs</h2>
      {isLoading ? <p className="p-2 text-xs text-muted-foreground">Loading…</p> : data.length === 0 ? (
        <p className="p-2 text-xs text-muted-foreground">No jobs allocated to you today.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {data.map((j: any, idx: number) => {
            const done = !!j.completed_at || j.status === "completed";
            const late = !done && !j.started_at && Date.parse(j.scheduled_for) < now;
            const u: Urgency = done ? "grey" : late ? "red" : idx === firstOpen ? "blue" : "grey";
            const c = URGENCY_CLASS[u], Icon = URGENCY_ICON[u];
            const label = done ? "DONE" : late ? `LATE · ${hhmm(j.scheduled_for)}` : idx === firstOpen ? `NEXT · ${hhmm(j.scheduled_for)}` : hhmm(j.scheduled_for);
            return (
              <li key={j.id} className="flex items-center gap-2 py-2">
                <span className={cn("h-9 w-1 shrink-0 rounded", c.bg)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 break-words leading-snug text-[13px] font-bold" title={j.title || undefined}>{j.title || "Job"}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{j.address}</div>
                </div>
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-extrabold", c.bg, c.text)}><Icon className="h-3.5 w-3.5" />{label}</span>
                <span className="relative shrink-0">{idx === firstOpen && <span aria-hidden className={cn("absolute inset-0 animate-ping rounded-lg opacity-40", c.bg)} />}<button onClick={() => navigate(`/field/jobs/${j.id}`)}
                  className={cn("relative rounded-lg px-2.5 py-1.5 text-[11px] font-extrabold", c.bg, c.text)}>
                  Open
                </button></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
