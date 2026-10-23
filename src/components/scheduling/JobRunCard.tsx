import { useQuery } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DAY_STATE_TEXT, dayLabel, hoursText, loadJobDays, rangeLabel, type JobDays } from "@/lib/jobDays";
import { RunProgressBar } from "@/components/scheduling/RunProgress";

const DOT: Record<string, string> = {
  done: "bg-green-600", on_site: "bg-blue-600", en_route: "bg-sky-400", missed: "bg-red-500",
  not_needed: "bg-muted-foreground/30", today: "bg-background ring-2 ring-primary", upcoming: "bg-muted-foreground/20",
};

/** Office view of a multi-day run: Day N of M, % done, expected end, and one dot per working day (tap-free, compact for 3 to 130 days). */
export function JobRunCardView({ data, today }: { data: JobDays; today?: string }) {
  const t = today ?? data.today;
  const first = data.days[0]?.date;
  const last = data.days[data.days.length - 1]?.date;
  const counts = data.days.reduce<Record<string, number>>((a, d) => { a[d.state] = (a[d.state] ?? 0) + 1; return a; }, {});
  return (
    <Card className="rounded-2xl" data-testid="job-run-card">
      <CardContent className="space-y-3 p-4 md:p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarRange className="h-4 w-4" />{data.day_count}-day job
          </h2>
          <span className="text-xs text-muted-foreground">Logged {hoursText(data.labour_hours)}</span>
        </div>
        <RunProgressBar data={data} today={t} />
        {first && <p className="text-xs text-muted-foreground" data-testid="job-run-range">{rangeLabel(first, last)} · working days only</p>}
        <div className="flex flex-wrap gap-1" data-testid="job-run-dots" aria-label="Days of the run">
          {data.days.map((d) => (
            <span key={d.schedule_id} title={`Day ${d.day_index} · ${dayLabel(d.date)} · ${DAY_STATE_TEXT[d.state] ?? d.state}`}
              className={cn("h-3 w-3 rounded-sm", DOT[d.state] ?? "bg-muted", d.date === t && "ring-2 ring-primary ring-offset-1")} />
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {([["done", "done"], ["on_site", "on site"], ["en_route", "en route"], ["missed", "missed"], ["upcoming", "to go"]] as const)
            .filter(([k]) => counts[k] || k === "upcoming").map(([k, t]) => `${counts[k] ?? 0} ${t}`).join(" · ")}
        </p>
      </CardContent>
    </Card>
  );
}

export default function JobRunCard({ jobId }: { jobId: string }) {
  const { data } = useQuery({ queryKey: ["job-days", jobId, "office"], enabled: !!jobId, queryFn: () => loadJobDays(jobId), staleTime: 30_000 });
  if (!data || !(data.day_count > 1)) return null;
  return <JobRunCardView data={data} />;
}
