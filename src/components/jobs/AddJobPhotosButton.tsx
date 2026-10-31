import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { useJobPhotos, type PhotoType } from "@/hooks/useJobPhotos";

const TYPES: { v: PhotoType; label: string }[] = [
  { v: "before", label: "Before" }, { v: "after", label: "After" }, { v: "site", label: "Site" },
];

/** Prominent add-photos control: pick Before/After/Site, then camera (phone) or gallery. Server checks photo_lead_ok. */
export default function AddJobPhotosButton({ leadId, defaultType = "before" }: { leadId: string; defaultType?: PhotoType }) {
  const { user } = useAuth();
  const { isOnline } = useOnlineStatus() as { isOnline: boolean };
  const { queueOperation } = useSyncQueue(isOnline) as { queueOperation: (...a: any[]) => Promise<unknown> };
  const { uploadPhoto, uploading } = useJobPhotos({ leadId, agentId: user?.id ?? "", isOnline, queueOperation });
  const qc = useQueryClient();
  const [type, setType] = useState<PhotoType>(defaultType);
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try { for (const f of Array.from(files)) await uploadPhoto(f, type); }
    finally {
      setBusy(false);
      const refresh = () => { qc.invalidateQueries({ queryKey: ["job-photos-typed", leadId] }); qc.invalidateQueries({ queryKey: ["site-photos", leadId] }); };
      refresh(); setTimeout(refresh, 4000); setTimeout(refresh, 10000);
    }
  };
  const working = busy || uploading;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2" data-testid="add-job-photos">
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Photo type">
        {TYPES.map((t) => (
          <button key={t.v} type="button" role="radio" aria-checked={type === t.v} onClick={() => setType(t.v)}
            className={`min-h-[40px] rounded-lg border text-sm font-semibold ${type === t.v ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-[48px] gap-1.5" onClick={() => cam.current?.click()} disabled={working} data-testid="add-photo-camera">
          {working ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />} Take photo
        </Button>
        <Button variant="outline" className="min-h-[48px] gap-1.5" onClick={() => lib.current?.click()} disabled={working}>
          <ImagePlus className="h-5 w-5" /> Choose
        </Button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
      <p className="text-[11px] text-muted-foreground">Adding as <b>{TYPES.find((t) => t.v === type)?.label}</b>. Saved on the phone first, then uploaded.</p>
    </div>
  );
}
