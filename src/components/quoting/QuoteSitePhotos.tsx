import { useQuery } from "@tanstack/react-query";
import { ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import SitePhotosSection from "@/components/photos/SitePhotosSection";

export type QuoteSitePhoto = { id: string; url: string; caption: string | null };

/** Staff (RLS-scoped): the quote's lead photos switched to "Client sees this" — same rule as the public quote-site-photos function. */
export async function loadQuoteSitePhotos(quoteId: string): Promise<QuoteSitePhoto[]> {
  const { data: q } = await (supabase.from("quotes") as any).select("lead_id").eq("id", quoteId).maybeSingle();
  if (!q?.lead_id) return [];
  const { data } = await (supabase.from("job_photos") as any)
    .select("id, storage_path, annotated_path, caption")
    .eq("lead_id", q.lead_id).eq("client_visible", true).order("created_at", { ascending: true }).limit(40);
  const out: QuoteSitePhoto[] = [];
  for (const p of (data ?? []) as any[]) {
    const { data: s } = await supabase.storage.from("job-photos").createSignedUrl(p.annotated_path || p.storage_path, 3600);
    if (s?.signedUrl) out.push({ id: p.id, url: s.signedUrl, caption: p.caption ?? null });
  }
  return out;
}

/** Public quote link: the same photos via the client's token. */
export async function loadQuoteSitePhotosByToken(token: string): Promise<QuoteSitePhoto[]> {
  const { data } = await supabase.functions.invoke("quote-site-photos", { body: { token } });
  return ((data as any)?.photos as QuoteSitePhoto[]) || [];
}

export function useQuoteSitePhotos(opts: { quoteId?: string | null; token?: string | null }) {
  const key = opts.token || opts.quoteId || "";
  return useQuery({
    queryKey: ["quote-site-photos", key],
    enabled: !!key,
    staleTime: 60_000,
    queryFn: () => (opts.token ? loadQuoteSitePhotosByToken(opts.token) : loadQuoteSitePhotos(opts.quoteId!)),
  }).data ?? [];
}

/** Printed on the quote document itself (link + PDF), after the unit cards. */
export function QuoteSitePhotosBlock({ photos }: { photos: QuoteSitePhoto[] }) {
  if (!photos.length) return null;
  return (
    <section data-paper data-testid="quote-site-photos" style={{ marginTop: 16, breakInside: "avoid" }}>
      <p style={{ fontWeight: 800, fontSize: 14, color: "#0B4FA8", margin: "0 0 8px" }}>Your site &amp; unit mockups</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
        {photos.map((p) => (
          <figure key={p.id} style={{ margin: 0, breakInside: "avoid" }}>
            <img src={p.url} crossOrigin="anonymous" alt={p.caption || "Site photo"} style={{ width: "100%", borderRadius: 8, display: "block", objectFit: "cover" }} />
            {p.caption && <figcaption style={{ fontSize: 12, color: "#334155", marginTop: 4 }}>{p.caption}</figcaption>}
          </figure>
        ))}
      </div>
    </section>
  );
}

/** Staff quote screen: take photos, place unit mockups, and choose which ones the client sees — without leaving the quote. */
export function QuoteSitePhotosEditor({ quoteId }: { quoteId: string }) {
  const { data: leadId } = useQuery({
    queryKey: ["quote-lead-id", quoteId],
    queryFn: async () => ((await (supabase.from("quotes") as any).select("lead_id").eq("id", quoteId).maybeSingle()).data?.lead_id as string | null) ?? null,
  });
  if (!leadId) return null;
  return (
    <div className="rounded-xl border bg-card p-3 space-y-2 print:hidden" data-testid="quote-site-photos-editor">
      <div className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4" />Site photos &amp; unit mockups</div>
      <p className="text-xs text-muted-foreground">Open a photo, tap Mark up → air-con to place a quoted unit. Switch on "Client sees this" to put it on the quote link and PDF.</p>
      <SitePhotosSection leadId={leadId} />
    </div>
  );
}
