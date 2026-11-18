import { useState } from "react";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { useJobLinkedPhotos } from "@/hooks/useJobLinkedPhotos";
import { groupLinkedPhotos, linkedPhotosQuietError, type LinkedPhotoView } from "@/lib/linkedPhotos";
import { PHOTO_GRID, PhotoViewer } from "@/components/photos/PhotoViewer";

/**
 * Pictures already saved on the quote, invoice, site visit, or customer's site.
 * Read-only: the files stay in their own buckets.
 */
export default function JobLinkedPhotos({ jobId, jobLeadId }: { jobId: string; jobLeadId?: string | null }) {
  const q = useJobLinkedPhotos(jobId, jobLeadId);
  const [open, setOpen] = useState<{ list: LinkedPhotoView[]; i: number; label: string } | null>(null);
  const photos = q.data ?? [];
  const message = q.error instanceof Error ? q.error.message : q.error ? String(q.error) : "";
  if (!photos.length && q.isError && linkedPhotosQuietError(message)) return null;
  if (!q.isLoading && !q.isError && photos.length === 0) return null;

  const groups = groupLinkedPhotos(photos);
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 text-card-foreground shadow-sm" data-testid="job-linked-photos">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 h-1 w-10 rounded-full" style={{ background: "#3D9BEB" }} />
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            Photos linked to this job{photos.length ? ` (${photos.length})` : ""}
          </h2>
        </div>
        {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Pictures already saved on the quote, the invoice, the site visit, and the customer's site.</p>
      {q.isError && photos.length === 0 ? (
        <p className="text-xs text-destructive" data-testid="job-linked-photos-error">Linked photos could not be loaded.</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label} data-testid="linked-photo-group">
              <p className="mb-2 text-sm font-semibold text-foreground" data-testid="linked-photo-label">{g.label}</p>
              <div className={PHOTO_GRID}>
                {g.photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpen({ list: g.photos, i, label: g.label })}
                    className="aspect-square overflow-hidden rounded-md bg-muted"
                    data-testid="linked-photo-thumb"
                  >
                    <img src={p.url} alt={p.caption || g.label} className="h-full w-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {open && (
        <PhotoViewer
          testId="linked-photo-viewer"
          photos={open.list}
          index={open.i}
          onIndex={(i) => setOpen({ ...open, i })}
          onClose={() => setOpen(null)}
          label={open.label}
        />
      )}
    </section>
  );
}
