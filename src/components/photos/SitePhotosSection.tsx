import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { useSyncQueue } from "@/hooks/useSyncQueue";
import { useJobPhotos } from "@/hooks/useJobPhotos";
import { photoDisplayPath, signedPhotoUrl } from "@/lib/photoUrls";
import { parseAnnotation, serializeAnnotation, type AnnShape } from "@/lib/annotation";
import PhotoAnnotator from "./PhotoAnnotator";

interface SitePhoto { id: string; storage_path: string; annotated_path: string | null; annotation: unknown; uploaded_by: string | null; url: string; originalUrl: string }

/** Editable (salesperson visit): camera/gallery via the tech photo pipeline (offline queue), annotate own photos. */
export default function SitePhotosSection({ leadId }: { leadId: string }) {
  const { user } = useAuth();
  const { isOnline } = useOnlineStatus() as { isOnline: boolean };
  const { queueOperation } = useSyncQueue(isOnline) as { queueOperation: (...a: any[]) => Promise<unknown> };
  const { uploadPhoto, uploading } = useJobPhotos({ leadId, agentId: user?.id ?? "", isOnline, queueOperation });
  return <SitePhotosView leadId={leadId} uploading={uploading} upload={(f) => uploadPhoto(f, "site")} />;
}

/** Read-only (tech job sheet): no sync queue, no capture, no mark-up. Hidden when there are none. */
export function SitePhotosReadOnly({ leadId }: { leadId: string }) {
  return <SitePhotosView leadId={leadId} readOnly />;
}

/** Site photos on a lead (P2). Internal only: never on client PDFs or the portal. */
function SitePhotosView({ leadId, readOnly = false, upload, uploading = false }:
  { leadId: string; readOnly?: boolean; upload?: (f: File) => Promise<void>; uploading?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<SitePhoto | null>(null);
  const [editing, setEditing] = useState<SitePhoto | null>(null);
  const [saving, setSaving] = useState(false);

  const photos = useQuery({
    queryKey: ["site-photos", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("job_photos") as any)
        .select("id, storage_path, annotated_path, annotation, uploaded_by, created_at")
        .eq("lead_id", leadId).eq("photo_type", "site").order("created_at", { ascending: false });
      if (error) throw error;
      return Promise.all(((data ?? []) as any[]).map(async (p) => ({
        ...p, url: await signedPhotoUrl(photoDisplayPath(p)), originalUrl: await signedPhotoUrl(p.storage_path),
      }))) as Promise<SitePhoto[]>;
    },
  });

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    if (!upload) return;
    for (const f of Array.from(files)) await upload(f);
    setTimeout(() => qc.invalidateQueries({ queryKey: ["site-photos", leadId] }), 2500);
  };

  const saveAnnotation = async (shapes: AnnShape[], jpeg: Blob) => {
    if (!editing) return;
    setSaving(true);
    try {
      const path = `${leadId}/${editing.id}-annotated.jpg`;
      const up = await supabase.storage.from("job-photos").upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
      if (up.error) throw up.error;
      const { error } = await (supabase.from("job_photos") as any)
        .update({ annotation: serializeAnnotation(shapes), annotated_path: path }).eq("id", editing.id);
      if (error) throw error;
      toast({ title: "Annotation saved" });
      setEditing(null); setOpen(null);
      qc.invalidateQueries({ queryKey: ["site-photos", leadId] });
    } catch (e: any) {
      toast({ title: "Couldn't save the annotation", description: e?.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const list = photos.data ?? [];
  if (readOnly && list.length === 0) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3" data-testid="site-photos">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Site photos{list.length ? ` (${list.length})` : ""}</h2>
        {photos.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {!readOnly && (
        <div className="grid grid-cols-2 gap-2">
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <Button variant="outline" className="min-h-[44px]" disabled={uploading} onClick={() => camRef.current?.click()} data-testid="site-photo-camera">
            {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Camera className="h-4 w-4 mr-1" />}Take photo
          </Button>
          <Button variant="outline" className="min-h-[44px]" disabled={uploading} onClick={() => galRef.current?.click()}>
            <ImagePlus className="h-4 w-4 mr-1" />From gallery
          </Button>
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">No site photos yet. They stay internal (not on the client's quote).</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {list.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} className="relative aspect-square overflow-hidden rounded-md bg-muted" data-testid="site-photo-thumb">
              {p.url && <img src={p.url} alt="Site photo" className="h-full w-full object-cover" loading="lazy" />}
              {p.annotated_path && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">Marked</span>}
            </button>
          ))}
        </div>
      )}
      {open && !editing && (
        <div className="fixed inset-0 z-[90] bg-black/95 flex flex-col" data-testid="site-photo-viewer">
          <div className="flex justify-between p-2">
            {!readOnly && (open.uploaded_by === user?.id) ? (
              <Button variant="secondary" className="min-h-[44px]" onClick={() => setEditing(open)} data-testid="site-photo-annotate"><PenLine className="h-4 w-4 mr-1" />Mark up</Button>
            ) : <span />}
            <Button variant="ghost" className="min-h-[44px] text-white" onClick={() => setOpen(null)} aria-label="Close"><X className="h-5 w-5" /></Button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2"><img src={open.url} alt="Site photo" className="max-h-full max-w-full object-contain" /></div>
        </div>
      )}
      {editing && (
        <PhotoAnnotator imageUrl={editing.originalUrl} initial={parseAnnotation(editing.annotation)} saving={saving}
          onCancel={() => setEditing(null)} onSave={saveAnnotation} />
      )}
    </div>
  );
}
