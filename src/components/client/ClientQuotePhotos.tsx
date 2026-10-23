import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

type Photo = { id: string; url: string; caption: string | null };

/** Client quote link: only site photos/mockups staff marked "Client sees this". */
export default function ClientQuotePhotos({ token }: { token: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  useEffect(() => {
    supabase.functions.invoke("quote-site-photos", { body: { token } }).then(({ data }) => setPhotos((data?.photos as Photo[]) || []));
  }, [token]);
  if (!photos.length) return null;
  return (
    <Card className="rounded-2xl border-0 shadow-md print:hidden">
      <CardContent className="p-4 space-y-3">
        <p className="text-sm font-semibold">Photos of your site</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {photos.map((p) => (
            <figure key={p.id} className="space-y-1">
              <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.caption || "Site photo"} className="w-full rounded-lg object-cover" loading="lazy" /></a>
              {p.caption && <figcaption className="text-sm text-muted-foreground">{p.caption}</figcaption>}
            </figure>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
