/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase tables, same as EstimateBuilder */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRICE_LIST_PREF_KEY, priceListViewerSrc, priceListCandidates, priceListLabel, type PriceListRow } from "@/lib/priceListPdf";

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

  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [expanded]);

  if (isLoading) return <p className="p-4 text-sm opacity-70">Loading price lists…</p>;
  if (!lists.length) return <p className="p-4 text-sm opacity-70" data-testid="pricelist-empty">No live price lists yet.</p>;

  const picker = (full: boolean) => lists.length > 1
    ? (
      <Select value={current?.row.id} onValueChange={pick}>
        <SelectTrigger className={`h-10 rounded-full text-xs ${full ? "max-w-md" : ""} flex-1`} data-testid={full ? "pricelist-picker-full" : "pricelist-picker"}><SelectValue /></SelectTrigger>
        <SelectContent className="z-[110]">
          {lists.map((l) => <SelectItem key={l.row.id} value={l.row.id}>{l.label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
    : <div className="flex-1 truncate text-xs font-medium opacity-80">{current?.label}</div>;

  const frame = (cls: string, testId: string) => err ? <p className="p-4 text-sm text-red-600">{err}</p>
    : url ? <iframe key={`${testId}-${url}`} title={current?.label ?? "Price list"} src={priceListViewerSrc(url)} className={`w-full ${cls} rounded-md bg-white ring-1 ring-slate-200`} data-testid={testId} />
    : <p className="p-4 text-sm opacity-70">Opening…</p>;

  return (
    <div className="flex flex-col gap-2" data-testid="pricelist-pane">
      <div className="flex items-center gap-2">
        {picker(false)}
        <button type="button" onClick={() => setExpanded(true)} disabled={!url}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
          aria-label="Expand price list to full page" data-testid="pricelist-expand">
          <Maximize2 className="h-3.5 w-3.5" /> Expand
        </button>
      </div>
      {!expanded && frame(heightClass, "pricelist-frame")}
      {expanded && typeof document !== "undefined" && createPortal(
        <div role="dialog" aria-modal="true" aria-label="Price list" className="fixed inset-0 z-[100] flex flex-col gap-2 bg-slate-100 p-3" data-testid="pricelist-fullpage">
          <div className="flex items-center gap-2">
            {picker(true)}
            <button type="button" onClick={() => setExpanded(false)} autoFocus
              className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-slate-200 bg-white hover:bg-slate-50"
              aria-label="Close full page price list (Esc)" data-testid="pricelist-close">
              <X className="h-3.5 w-3.5" /> Close
            </button>
          </div>
          {frame("flex-1 min-h-0", "pricelist-frame-full")}
        </div>,
        document.body,
      )}
    </div>
  );
}
