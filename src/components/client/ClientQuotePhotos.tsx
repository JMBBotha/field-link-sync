import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { PhotoViewer, PHOTO_GRID } from "@/components/photos/PhotoViewer";

type Photo = { id: string; url: string; caption: string | null };

/** Client quote link: only site photos/mockups staff marked "Client sees this". */
export default function ClientQuotePhotos({ token }: { token: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [idx, setIdx] = useState<number | null>(null);
  useEffect(() => {
    supabase.functions.invoke("quote-site-photos", { body: { token } }).then(({ data }) => setPhotos((data?.photos as Photo[]) || []));
  }, [token]);
  if (!photos.length) return null;
  return (
    <Card className="rounded-2xl border-0 shadow-md print:hidden">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">Photos of your site</p>
        <div className={PHOTO_GRID}>
          {photos.map((p, i) => (
            <figure key={p.id} className="space-y-1">
              <button type="button" onClick={() => setIdx(i)} className="block aspect-square w-full overflow-hidden rounded-lg bg-muted" data-testid="client-photo-thumb"><img src={p.url} alt={p.caption || "Site photo"} className="h-full w-full object-cover" loading="lazy" /></button>
              {p.caption && <figcaption className="text-sm text-muted-foreground">{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
        {idx !== null && <PhotoViewer photos={photos} index={idx} onIndex={setIdx} onClose={() => setIdx(null)} label="Photos of your site" />}
      </CardContent>
    </Card>
  );
}
