import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { hoursLabel, nextVisit, sortVisits, totalVisitMinutes, visitDayLabel, visitMinutes, type JobVisit } from "@/lib/jobVisits";

export async function loadJobVisits(jobId: string): Promise<JobVisit[]> {
  const { data, error } = await (supabase.rpc as any)("job_visits", { p_job: jobId });
  if (error) throw new Error(error.message);
  return sortVisits((data ?? []) as JobVisit[]);
}
export const useJobVisits = (jobId: string, enabled = true) =>
  useQuery({ queryKey: ["job-visits", jobId], enabled: enabled && !!jobId, queryFn: () => loadJobVisits(jobId), staleTime: 30_000 });

/** Job page: every visit with its hours, plus the total. */
export function JobVisitsCardView({ visits }: { visits: JobVisit[] }) {
  const total = totalVisitMinutes(visits);
  return (
    <Card className="rounded-2xl" data-testid="job-visits-card">
      <CardContent className="space-y-2 p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="h-4 w-4" />{visits.length === 1 ? "Visit" : `${visits.length} visits`}
          </h2>
          <span className="text-sm font-semibold" data-testid="job-visits-total">{hoursLabel(total)} total</span>
        </div>
        <ul className="divide-y">
          {visits.map((v, i) => (
            <li key={v.id ?? i} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{visits.length > 1 && <span className="text-muted-foreground">Day {i + 1} · </span>}{visitDayLabel(v.date)}</p>
                <p className="text-muted-foreground tabular-nums">{v.start}–{v.end}{v.tech_name ? ` · ${v.tech_name.trim()}` : ""}</p>
                {v.note && <p className="text-xs text-muted-foreground truncate">{v.note}</p>}
              </div>
              <span className="shrink-0 tabular-nums text-muted-foreground">{hoursLabel(visitMinutes(v))}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
export default function JobVisitsCard({ jobId }: { jobId: string }) {
  const { data } = useJobVisits(jobId);
  if (!data?.length) return null;
  return <JobVisitsCardView visits={data} />;
}

/** Sheet editor. Admin: add / remove / tech / note. Rep: date + times only. */
export function VisitsEditor({ visits, onChange, admin, techs, today }: {
  visits: JobVisit[]; onChange: (v: JobVisit[]) => void; admin: boolean; techs: { id: string; name: string }[]; today: string;
}) {
  const set = (i: number, patch: Partial<JobVisit>) => onChange(visits.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div className="space-y-2" data-testid="visits-editor">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Visits</span>
        <span className="text-xs text-muted-foreground" data-testid="visits-editor-total">{hoursLabel(totalVisitMinutes(visits))} total</span>
      </div>
      {visits.map((v, i) => (
        <div key={v.id ?? `n${i}`} className="rounded-xl border p-3 space-y-2" data-testid="visit-row">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Day {i + 1}{v.worked ? " · checked in" : ""}</span>
            {admin && visits.length > 1 && !v.worked && (
              <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-destructive" onClick={() => onChange(visits.filter((_, j) => j !== i))} aria-label={`Remove day ${i + 1}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 items-end md:grid-cols-[1fr_auto_auto]">
            <div className="col-span-2 space-y-1 md:col-span-1"><label className="block text-xs text-muted-foreground" htmlFor={`v-d-${i}`}>Date</label>
              <Input id={`v-d-${i}`} type="date" value={v.date} disabled={!!v.worked} onChange={(e) => set(i, { date: e.target.value })} /></div>
            <div className="space-y-1"><label className="block text-xs text-muted-foreground" htmlFor={`v-s-${i}`}>Start</label>
              <TimeInput24 id={`v-s-${i}`} value={v.start} onChange={(e) => set(i, { start: e.target.value })} /></div>
            <div className="space-y-1"><label className="block text-xs text-muted-foreground" htmlFor={`v-e-${i}`}>End</label>
              <TimeInput24 id={`v-e-${i}`} value={v.end} onChange={(e) => set(i, { end: e.target.value })} /></div>
          </div>
          {admin && (
            <div className="grid gap-2 md:grid-cols-2">
              <select aria-label={`Day ${i + 1} technician`} data-testid="visit-tech" className="w-full min-h-[40px] rounded-md border bg-background px-2 text-sm" value={v.tech ?? ""} onChange={(e) => set(i, { tech: e.target.value || null })}>
                <option value="">Job's technician</option>
                {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                {v.tech && !techs.some((t) => t.id === v.tech) && <option value={v.tech}>{v.tech_name?.trim() || "Current tech"}</option>}
              </select>
              <Input aria-label={`Day ${i + 1} note`} placeholder="Visit note (optional)" maxLength={500} value={v.note ?? ""} onChange={(e) => set(i, { note: e.target.value })} />
            </div>
          )}
        </div>
      ))}
      {admin && (
        <Button type="button" variant="outline" className="w-full min-h-[44px]" onClick={() => onChange([...visits, nextVisit(visits, today)])} data-testid="add-visit">
          <Plus className="h-4 w-4 mr-1" />Add another day
        </Button>
      )}
    </div>
  );
}
