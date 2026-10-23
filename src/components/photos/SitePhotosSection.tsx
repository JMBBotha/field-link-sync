import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Loader2, PenLine, Trash2, X, Eye, EyeOff } from "lucide-react";
import { unitLineModelKey } from "@/lib/unitCards";
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

interface SitePhoto { caption: string | null; client_visible: boolean; id: string; storage_path: string; annotated_path: string | null; annotation: unknown; uploaded_by: string | null; url: string; originalUrl: string }

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
        .select("id, storage_path, annotated_path, annotation, uploaded_by, created_at, caption, client_visible")
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

  // assigned tech/salesperson (or office) may upload + delete; RLS enforces the same rule (photo_lead_ok)
  const canManage = useQuery({
    queryKey: ["photo-lead-ok", leadId],
    enabled: !!leadId && !readOnly,
    queryFn: async () => {
      const { data } = await (supabase.rpc as any)("photo_lead_ok", { _lead: leadId });
      return data === true;
    },
  }).data === true;

  const deletePhoto = async (p: SitePhoto) => {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    try {
      const paths = [p.storage_path, p.annotated_path].filter(Boolean) as string[];
      const { error } = await (supabase.from("job_photos") as any).delete().eq("id", p.id);
      if (error) throw error;
      await supabase.storage.from("job-photos").remove(paths);
      toast({ title: "Photo deleted" });
      setOpen(null);
      qc.invalidateQueries({ queryKey: ["site-photos", leadId] });
    } catch (e: any) {
      toast({ title: "Couldn't delete the photo", description: e?.message, variant: "destructive" });
    }
  };

  // Unit mockups: approved cut-outs of the units on this lead's latest quote.
  const mockups = useQuery({
    queryKey: ["lead-unit-mockups", leadId],
    enabled: !!leadId && !readOnly,
    queryFn: async () => {
      const { data: q } = await (supabase.from("quotes") as any).select("id").eq("lead_id", leadId).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!q) return [];
      const { data: items } = await (supabase.from("quote_items") as any).select("item_name, item_type, item_number, product_code, is_bundle, metadata").eq("quote_id", q.id);
      const keys = [...new Set(((items || []) as any[]).map(unitLineModelKey).filter(Boolean))] as string[];
      if (!keys.length) return [];
      const { data: media } = await (supabase.from("product_media" as never) as any).select("model_key, model_code, display_name, image_url, status").in("model_key", keys);
      return ((media || []) as any[]).filter((m) => m.image_url && m.status === "approved")
        .map((m) => ({ label: String(m.display_name || m.model_code).slice(0, 40), url: m.image_url as string }));
    },
  }).data ?? [];

  const updatePhoto = async (p: SitePhoto, patch: Partial<Pick<SitePhoto, "caption" | "client_visible">>) => {
    const { error } = await (supabase.from("job_photos") as any).update(patch).eq("id", p.id);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); return; }
    setOpen((o) => (o && o.id === p.id ? { ...o, ...patch } : o));
    qc.invalidateQueries({ queryKey: ["site-photos", leadId] });
  };

  const list = photos.data ?? [];
  if (readOnly && list.length === 0) return null;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 space-y-3" data-testid="site-photos">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Site photos{list.length ? ` (${list.length})` : ""}</h2>
        {photos.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {!readOnly && canManage && (
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
        <p className="text-xs text-muted-foreground">No site photos yet. Photos stay internal unless you switch on "Client sees this".</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {list.map((p) => (
            <button key={p.id} type="button" onClick={() => setOpen(p)} className="relative aspect-square overflow-hidden rounded-md bg-muted" data-testid="site-photo-thumb">
              {p.url && <img src={p.url} alt="Site photo" className="h-full w-full object-cover" loading="lazy" />}
              {p.annotated_path && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-xs text-white">Marked</span>}
              {p.client_visible && <span className="absolute top-1 left-1 rounded bg-primary px-1 text-xs text-primary-foreground flex items-center gap-0.5"><Eye className="h-3 w-3" />Client</span>}
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
            {!readOnly && canManage && (
              <Button variant="destructive" className="min-h-[44px]" onClick={() => deletePhoto(open)} data-testid="site-photo-delete"><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
            )}
            <Button variant="ghost" className="min-h-[44px] text-white" onClick={() => setOpen(null)} aria-label="Close"><X className="h-5 w-5" /></Button>
          </div>
          <div className="flex-1 min-h-0 flex items-center justify-center p-2"><img src={open.url} alt="Site photo" className="max-h-full max-w-full object-contain" /></div>
          {readOnly ? (open.caption ? <p className="p-3 text-sm text-white">{open.caption}</p> : null) : (
            <div className="p-3 space-y-2 bg-black/80">
              <textarea key={open.id} defaultValue={open.caption ?? ""} placeholder="Add info about this photo…" maxLength={500} rows={2}
                onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (open.caption ?? null)) void updatePhoto(open, { caption: v }); }}
                className="w-full rounded-md bg-white/10 p-2 text-sm text-white placeholder:text-white/50" data-testid="site-photo-caption" />
              {canManage && (
                <Button variant={open.client_visible ? "default" : "secondary"} className="min-h-[44px] w-full" data-testid="site-photo-client-toggle"
                  onClick={() => void updatePhoto(open, { client_visible: !open.client_visible })}>
                  {open.client_visible ? <><Eye className="h-4 w-4 mr-1" />Client sees this — tap to hide</> : <><EyeOff className="h-4 w-4 mr-1" />Hidden from client — tap to show</>}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {editing && (
        <PhotoAnnotator imageUrl={editing.originalUrl} initial={parseAnnotation(editing.annotation)} saving={saving}
          onCancel={() => setEditing(null)} onSave={saveAnnotation} mockups={mockups} />
      )}
    </div>
  );
}
