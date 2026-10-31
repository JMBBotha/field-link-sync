import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { photoDisplayPath, signedPhotoUrl } from "@/lib/photoUrls";
import { photoSummary } from "@/lib/jobActionBar";
import SitePhotosSection from "@/components/photos/SitePhotosSection";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { PhotoViewer, PHOTO_GRID } from "@/components/photos/PhotoViewer";

type P = { id: string; url: string; photo_type: string; caption: string | null };

/** Job photos with clear Site / Before / After labels. "No photos yet" only when all three are empty. */
export default function JobPhotosCard({ leadId, addSlot }: { leadId: string; addSlot?: React.ReactNode }) {
  const [open, setOpen] = useState<{ list: P[]; i: number; label: string } | null>(null);
  const q = useQuery({
    queryKey: ["job-photos-typed", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await (supabase.from("job_photos") as any)
        .select("id, storage_path, annotated_path, caption, photo_type, created_at")
        .eq("lead_id", leadId).in("photo_type", ["site", "before", "after"]).order("created_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const withUrls = await Promise.all(rows.filter((r) => r.photo_type !== "site").map(async (r) => ({
        id: r.id, photo_type: r.photo_type, caption: r.caption, url: await signedPhotoUrl(photoDisplayPath(r)),
      })));
      return {
        counts: { site: rows.filter((r) => r.photo_type === "site").length, before: rows.filter((r) => r.photo_type === "before").length, after: rows.filter((r) => r.photo_type === "after").length },
        before: withUrls.filter((r) => r.photo_type === "before") as P[],
        after: withUrls.filter((r) => r.photo_type === "after") as P[],
      };
    },
  });
  const counts = q.data?.counts ?? { site: 0, before: 0, after: 0 };
  const { empty } = photoSummary(counts);

  const Group = ({ label, list, testId }: { label: string; list: P[]; testId: string }) => (
    <div className="rounded-xl border border-border/60 bg-card p-3 sm:p-4 space-y-3" data-testid={testId}>
      <h2 className="text-sm font-semibold">{label} ({list.length})</h2>
      {list.length === 0 ? <p className="text-xs text-muted-foreground">None yet</p> : (
        <div className={PHOTO_GRID}>
          {list.map((p, i) => (
            <button key={p.id} type="button" onClick={() => setOpen({ list, i, label })} className="aspect-square overflow-hidden rounded-md bg-muted">
              {p.url && <img src={p.url} alt={`${label} photo`} className="h-full w-full object-cover" loading="lazy" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3" data-testid="job-photos-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm flex items-center gap-1.5">
          <ImageIcon className="h-4 w-4 text-muted-foreground" /> Photos{!q.isLoading && ` (${counts.site + counts.before + counts.after})`}
        </h3>
        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {addSlot}
      {q.isError ? (
        <p className="text-xs text-destructive">Couldn't load photos. Pull to refresh or try again.</p>
      ) : q.isLoading ? null : empty ? (
        <p className="text-xs text-muted-foreground text-center py-3" data-testid="job-photos-empty">No photos yet</p>
      ) : (
        <>
          {counts.site > 0 ? <SitePhotosSection leadId={leadId} /> : <Group label="Site photos" list={[]} testId="job-photos-site" />}
          <Group label="Before" list={q.data?.before ?? []} testId="job-photos-before" />
          <Group label="After" list={q.data?.after ?? []} testId="job-photos-after" />
        </>
      )}
      {open && <PhotoViewer photos={open.list} index={open.i} onIndex={(i) => setOpen({ ...open, i })} onClose={() => setOpen(null)} label={open.label} />}
    </div>
  );
}
