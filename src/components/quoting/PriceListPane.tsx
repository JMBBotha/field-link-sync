/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase tables, same as EstimateBuilder */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRICE_LIST_PREF_KEY, priceListCandidates, priceListLabel, type PriceListRow } from "@/lib/priceListPdf";

/** Live price list PDFs, viewed through short-lived signed URLs. Admin-only (caller gates). */
export default function PriceListPane({ heightClass = "h-[calc(100vh-9rem)]" }: { heightClass?: string }) {
  const { data: lists = [], isLoading } = useQuery({
    queryKey: ["quote-pricelist-pdfs"],
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("pdf_uploads") as any)
        .select("id, supplier_id, file_name, brand, file_path, storage_path, file_url, price_list_type")
        .eq("is_active", true)
        .order("file_name");
      if (error) throw error;
      const rows = (data || []) as PriceListRow[];
      const ids = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))];
      const names: Record<string, string> = {};
      if (ids.length) {
        const { data: s } = await supabase.from("suppliers").select("id, name").in("id", ids);
        for (const r of (s || []) as any[]) names[r.id] = r.name;
      }
      return rows
        .filter((r) => /\.pdf$/i.test(r.file_name || "") || priceListCandidates(r).length > 0)
        .map((r) => ({ row: r, label: priceListLabel(r, names[r.supplier_id]) }))
        .sort((a, b) => a.label.localeCompare(b.label));
    },
  });

  const [picked, setPicked] = useState<string | null>(() => (typeof window === "undefined" ? null : localStorage.getItem(PRICE_LIST_PREF_KEY)));
  const current = useMemo(() => lists.find((l) => l.row.id === picked) ?? lists[0] ?? null, [lists, picked]);
  const pick = (id: string) => { setPicked(id); try { localStorage.setItem(PRICE_LIST_PREF_KEY, id); } catch { /* private mode */ } };

  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!current) return;
    let blobUrl: string | null = null;
    let cancelled = false;
    setUrl(null); setErr(null);
    (async () => {
      for (const c of priceListCandidates(current.row)) {
        const { data } = await supabase.storage.from(c.bucket).createSignedUrl(c.path, 300);
        if (!data?.signedUrl) continue;
        try {
          const res = await fetch(data.signedUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          blobUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
          setUrl(blobUrl);
          return;
        } catch { /* try next */ }
      }
      if (!cancelled) setErr("Couldn't open this price list.");
    })();
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [current]);

  if (isLoading) return <p className="p-4 text-sm opacity-70">Loading price lists…</p>;
  if (!lists.length) return <p className="p-4 text-sm opacity-70" data-testid="pricelist-empty">No live price lists yet.</p>;

  return (
    <div className="flex flex-col gap-2" data-testid="pricelist-pane">
      {lists.length > 1 && (
        <Select value={current?.row.id} onValueChange={pick}>
          <SelectTrigger className="h-10 rounded-full text-xs" data-testid="pricelist-picker"><SelectValue /></SelectTrigger>
          <SelectContent>
            {lists.map((l) => <SelectItem key={l.row.id} value={l.row.id}>{l.label}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {lists.length === 1 && <div className="text-xs font-medium opacity-80">{current?.label}</div>}
      {err ? <p className="p-4 text-sm text-red-600">{err}</p>
        : url ? <iframe title={current?.label ?? "Price list"} src={url} className={`w-full ${heightClass} rounded-md bg-white ring-1 ring-slate-200`} data-testid="pricelist-frame" />
        : <p className="p-4 text-sm opacity-70">Opening…</p>}
    </div>
  );
}
