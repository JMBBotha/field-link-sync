/**
 * Company switch for the job / warranty card.
 * Auto-send defaults off so a preview cannot email real clients.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { DEFAULT_JOB_CARD_PHOTO_MODE, normalisePhotoMode, type JobCardPhotoMode } from "@/lib/jobCard";

export default function JobCardSettingsCard() {
  const { companyId } = useUserCompanyId() as { companyId?: string | null };
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["job-card-settings", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const res = await (supabase.from("companies") as any).select("auto_send_job_card, job_card_photo_mode").eq("id", companyId).maybeSingle();
      if (!res || res.error || !res.data) return { autoSend: false, photoMode: DEFAULT_JOB_CARD_PHOTO_MODE };
      return {
        autoSend: res.data.auto_send_job_card === true,
        photoMode: normalisePhotoMode(res.data.job_card_photo_mode),
      };
    },
  });
  const [autoSend, setAutoSend] = useState(false);
  const [photoMode, setPhotoMode] = useState<JobCardPhotoMode>(DEFAULT_JOB_CARD_PHOTO_MODE);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data) return;
    setAutoSend(data.autoSend === true);
    setPhotoMode(data.photoMode);
  }, [data]);

  const save = async () => {
    if (!companyId) return;
    setSaving(true);
    const { error } = await (supabase.from("companies") as any).update({
      auto_send_job_card: autoSend === true,
      job_card_photo_mode: photoMode,
    }).eq("id", companyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(autoSend ? "Job card will email when a job is finished" : "Job card auto-send is off");
    qc.invalidateQueries({ queryKey: ["job-card-settings"] });
  };

  return (
    <Card className="mt-4" data-testid="job-card-settings">
      <CardHeader className="pb-2"><CardTitle className="text-base">Job / warranty card</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="font-medium">Auto-send job card</span>
            <span className="mt-0.5 block text-muted-foreground">Leave this off until go-live. When it is on, finishing a job emails the card to the client from johan@0800becool.co.za. It does not send while this is off.</span>
          </span>
          <Switch checked={autoSend} onCheckedChange={setAutoSend} aria-label="Auto-send job card" data-testid="job-card-auto-send" />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Photos on the card</span>
          <select
            className="h-10 w-full rounded-md border border-input bg-background px-2"
            value={photoMode}
            onChange={(e) => setPhotoMode(normalisePhotoMode(e.target.value))}
            data-testid="job-card-photo-mode"
          >
            <option value="client_visible_else_after">Photos marked for the client. If none are marked, use the after photos.</option>
            <option value="client_visible_only">Only photos marked for the client.</option>
          </select>
        </label>
        <Button size="sm" className="bg-[#C2410C] text-white hover:bg-[#C2410C]/90" onClick={() => void save()} disabled={saving || !companyId}>Save</Button>
      </CardContent>
    </Card>
  );
}
