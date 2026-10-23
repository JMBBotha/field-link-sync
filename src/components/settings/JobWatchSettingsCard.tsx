import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { clampWatch, DEFAULT_JOB_WATCH, JOB_WATCH_LIMITS, type JobWatchSettings } from "@/lib/jobWatch";

const FIELDS: { key: keyof JobWatchSettings; label: string; help: string }[] = [
  { key: "late_checkin_minutes", label: "Late alert after", help: "after the booked start if the tech hasn't checked in (every job)" },
  { key: "en_route_buffer_minutes", label: "Buffer on top of drive time", help: "at risk if not en route by start − (drive + buffer)" },
  { key: "en_route_floor_minutes", label: "Always en route by", help: "before start, even when the drive is short" },
  { key: "en_route_fallback_minutes", label: "No drive estimate: en route by", help: "before start, when an address has no map pin" },
];

/** job_watch_settings: the late / at-risk minutes for the job watchdog (admin only). Drive time uses saved addresses only. */
export default function JobWatchSettingsCard() {
  const { companyId } = useUserCompanyId() as any;
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["job-watch-settings", companyId], enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase.from("job_watch_settings" as any) as any).select("*").eq("company_id", companyId).maybeSingle();
      return { ...DEFAULT_JOB_WATCH, ...(data || {}) } as JobWatchSettings;
    },
  });
  const [v, setV] = useState<JobWatchSettings>(DEFAULT_JOB_WATCH);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) setV(data); }, [data]);
  const save = async () => {
    setSaving(true);
    const row = { company_id: companyId, ...Object.fromEntries(FIELDS.map((f) => [f.key, clampWatch(f.key, v[f.key])])), updated_at: new Date().toISOString() };
    const { error } = await (supabase.from("job_watch_settings" as any) as any).upsert(row, { onConflict: "company_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Job alerts saved"); qc.invalidateQueries({ queryKey: ["job-watch-settings"] });
  };
  return (
    <Card className="mt-4" data-testid="job-watch-settings">
      <CardHeader className="pb-2"><CardTitle className="text-base">Jobs: late and at-risk alerts</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Drive time is worked out from the previous job's address that day, or the tech's home base for the first job. No live location is used.</p>
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-wrap items-center gap-2">
            <span className="w-full font-medium sm:w-56">{f.label}</span>
            <Input type="number" min={JOB_WATCH_LIMITS[f.key][0]} max={JOB_WATCH_LIMITS[f.key][1]} value={v[f.key]}
              onChange={(e) => setV({ ...v, [f.key]: clampWatch(f.key, e.target.value) })} className="h-9 w-20" data-testid={`jw-${f.key}`} />
            <span className="text-muted-foreground">min {f.help}</span>
          </label>
        ))}
        <Button size="sm" onClick={save} disabled={saving || !companyId}>Save</Button>
      </CardContent>
    </Card>
  );
}
