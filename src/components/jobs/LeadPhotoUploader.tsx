import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { useJobPhotos } from "@/hooks/useJobPhotos";

/**
 * Upload-only site photos for a lead (sales after Assign). Same private job-photos bucket and
 * job_photos rows (photo_type "site") as SitePhotosSection; a sales rep may not be able to list
 * them afterwards, so this only counts what was added in this session.
 */
export default function LeadPhotoUploader({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isOnline } = useOnlineStatus() as { isOnline: boolean };
  const { queueOperation } = useSyncQueue(isOnline) as { queueOperation: (...a: any[]) => Promise<unknown> };
  const { uploadPhoto } = useJobPhotos({ leadId, agentId: user?.id ?? "", isOnline, queueOperation });
  const ref = useRef<HTMLInputElement>(null);
  const [added, setAdded] = useState(0);
  const [busy, setBusy] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(files)) {
      try { await uploadPhoto(f, "site"); ok++; } catch (e: any) { toast({ title: "Photo not added", description: e?.message || String(e), variant: "destructive" }); }
    }
    setAdded((n) => n + ok); setBusy(false);
    qc.invalidateQueries({ queryKey: ["site-photos", leadId] });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="lead-photo-uploader">
      <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-1 h-4 w-4" />}Add photos
      </Button>
      {added > 0 && <span className="text-xs text-muted-foreground">{added} photo{added === 1 ? "" : "s"} added</span>}
    </div>
  );
}
