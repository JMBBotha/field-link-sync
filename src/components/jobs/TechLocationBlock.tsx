import { useQuery } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { etaMinutes, friendlyAgo, JobTechLocation, mapUrl, sastTime, techStatusLabel } from "@/lib/techLocation";

/** Live tech location for the job's salesperson (and admins), only during the job window.
 *  The server (job_tech_location RPC) decides who may see it and when; this only renders. */
export default function TechLocationBlock({ jobId, compact = false }: { jobId: string | null | undefined; compact?: boolean }) {
  const q = useQuery({
    queryKey: ["job-tech-location", jobId],
    enabled: !!jobId,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("job_tech_location", { p_job_id: jobId });
      if (error) throw error;
      return data as JobTechLocation;
    },
  });
  const d = q.data;
  if (!jobId || !d?.allowed || !d.window_start) return null;
  const done = d.window_end && new Date(d.window_end).getTime() <= Date.now();
  if (!d.in_window) {
    if (done) return null;
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="tech-location-later">
        <MapPin className="h-3.5 w-3.5" /> Live location available from {sastTime(d.window_start)}
      </p>
    );
  }
  const techs = d.techs || [];
  return (
    <div className={`rounded-xl border border-[#1590D6]/30 bg-[#1590D6]/5 ${compact ? "p-2" : "p-3"} space-y-1.5`} data-testid="tech-location">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#0F2A44] dark:text-[#CFE6F6]">Tech location</p>
      {!techs.length && <p className="text-sm text-muted-foreground">No technician on this job yet</p>}
      {techs.map((t) => {
        const url = mapUrl(t, d.job_lat, d.job_lng);
        const eta = t.status === "on_the_way" ? etaMinutes(t.distance_km) : null;
        return (
          <div key={t.tech_id} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-sm">
              <span className="font-medium">{t.name}</span>
              <span className="text-muted-foreground"> · {techStatusLabel(t)}</span>
              {t.shared && (
                <span className="block text-xs text-muted-foreground">
                  {t.arrived_at ? `Arrived ${sastTime(t.arrived_at)}${t.left_at ? ` · left ${sastTime(t.left_at)}` : ""} · ` : ""}
                  Updated {friendlyAgo(t.last_updated)}
                  {t.distance_km != null ? ` · ${t.distance_km} km away` : ""}
                  {eta ? ` · about ${eta} min` : ""}
                </span>
              )}
            </div>
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
