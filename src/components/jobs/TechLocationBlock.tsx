import { useQuery } from "@tanstack/react-query";
import { Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { etaMinutes, friendlyAgo, type JobTechLocation, mapUrl, parseJobTechLocation, sastTime, showTechPin, techStatusLabel, WAY_LATER, wayDetail, wayPinLayout } from "@/lib/techLocation";

/** Presentational on-the-way map. The RPC decides who may see the job and whether a coordinate exists. */
export function TechOnTheWayView({ data, compact = false }: { data: JobTechLocation; compact?: boolean }) {
  if (!data.allowed || !data.window_start) return null;
  const done = !!(data.window_end && new Date(data.window_end).getTime() <= Date.now());
  if (!data.in_window) {
    if (done) return null;
    return (
      <p className="text-xs text-muted-foreground" data-testid="tech-location-later">
        {WAY_LATER} From {sastTime(data.window_start)}.
      </p>
    );
  }
  const techs = data.techs || [];
  return (
    <div className={`rounded-xl border border-[#1590D6]/30 bg-[#1590D6]/5 ${compact ? "p-2" : "p-3"} space-y-2`} data-testid="tech-location">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#0F2A44] dark:text-[#CFE6F6]">Technician</p>
      {!techs.length && <p className="text-sm text-muted-foreground" data-testid="tech-way-unavailable">No technician on this job yet.</p>}
      {techs.map((t) => {
        const pin = showTechPin(t);
        const layout = pin && t.lat != null && t.lng != null ? wayPinLayout(t, data.job_lat, data.job_lng) : null;
        const url = mapUrl(t, data.job_lat, data.job_lng);
        const eta = t.status === "on_the_way" ? etaMinutes(t.distance_km) : null;
        return (
          <div key={t.tech_id} className="space-y-1.5" data-testid={pin ? "tech-way-map" : "tech-way-unavailable"}>
            <div className="min-w-0 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-muted-foreground"> · {techStatusLabel(t)}</span>
              <span className="block text-xs text-muted-foreground">{wayDetail(t)}</span>
              {pin && (
                <span className="block text-xs text-muted-foreground">
                  {t.arrived_at ? `Arrived ${sastTime(t.arrived_at)}${t.left_at ? ` · left ${sastTime(t.left_at)}` : ""} · ` : ""}
                  Updated {friendlyAgo(t.last_updated)}
                  {t.distance_km != null ? ` · ${t.distance_km} km away` : ""}
                  {eta ? ` · about ${eta} min` : ""}
                </span>
              )}
            </div>
            {layout && (
              <svg viewBox="0 0 320 150" role="img" aria-label={`Map showing ${t.name}${layout.job ? " and the job" : ""}`} className="h-28 w-full rounded-lg bg-[#e7f3fb]">
                <rect width="320" height="150" fill="#e7f3fb" />
                {layout.job && <line x1={layout.tech.x} y1={layout.tech.y} x2={layout.job.x} y2={layout.job.y} stroke="#1590D6" strokeWidth="2" strokeDasharray="4 3" />}
                {layout.job && (
                  <>
                    <circle cx={layout.job.x} cy={layout.job.y} r="6" fill="#0F2A44" />
                    <text x={layout.job.x + 8} y={layout.job.y + 4} fontSize="11" fill="#0F2A44">Job</text>
                  </>
                )}
                <circle cx={layout.tech.x} cy={layout.tech.y} r="7" fill="#F7941D" data-testid="tech-way-pin" />
                <text x={layout.tech.x + 10} y={layout.tech.y + 4} fontSize="11" fill="#0F2A44">{t.name.split(" ")[0]}</text>
              </svg>
            )}
            {url && (
              <Button asChild size="sm" variant="outline" className="h-8 shrink-0 gap-1.5">
                <a href={url} target="_blank" rel="noreferrer"><Navigation className="h-3.5 w-3.5" /> Open map</a>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Live tech location for this job's salesperson (and company admins), only during the job window.
 *  The server (job_tech_location) decides who may see it and when; this only renders. */
export default function TechLocationBlock({ jobId, compact = false }: { jobId: string | null | undefined; compact?: boolean }) {
  const q = useQuery({
    queryKey: ["job-tech-location", jobId],
    enabled: !!jobId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("job_tech_location", { p_job_id: jobId as string });
      if (error) throw error;
      return parseJobTechLocation(data) ?? { allowed: false };
    },
  });
  if (!q.data) return null;
  return <TechOnTheWayView data={q.data} compact={compact} />;
}
