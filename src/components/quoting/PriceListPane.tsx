/* eslint-disable @typescript-eslint/no-explicit-any -- untyped supabase tables, same as EstimateBuilder */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Maximize2, X } from "lucide-react";
import PdfCanvasViewer from "./PdfCanvasViewer";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PRICE_LIST_PREF_KEY, priceListCandidates, priceListLabel, type PriceListRow } from "@/lib/priceListPdf";

/** Screenshot harness only. Skips the live catalogue — no prices, no storage reads. */
export type PriceListDemo = { label: string; heading: string };

/** Live price list PDFs, viewed through short-lived signed URLs. Admin-only (caller gates). */
export default function PriceListPane({ heightClass = "h-[calc(100vh-9rem)]", onClose, demo }: { heightClass?: string; onClose?: () => void; demo?: PriceListDemo }) {
  const { data: lists = [], isLoading } = useQuery({
    queryKey: ["quote-pricelist-pdfs"],
    enabled: !demo,
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
  const rows = useMemo(
    () => (demo ? [{ row: { id: "demo-pricelist" } as PriceListRow, label: demo.label }] : lists),
    [demo, lists],
  );
  const current = useMemo(() => rows.find((l) => l.row.id === picked) ?? rows[0] ?? null, [rows, picked]);
  const pick = (id: string) => { setPicked(id); try { localStorage.setItem(PRICE_LIST_PREF_KEY, id); } catch { /* private mode */ } };

  const [url, setUrl] = useState<string | null>(null);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (demo || !current) return;
    let blobUrl: string | null = null;
    let cancelled = false;
    setUrl(null); setBytes(null); setErr(null);
    (async () => {
      for (const c of priceListCandidates(current.row)) {
        const { data } = await supabase.storage.from(c.bucket).createSignedUrl(c.path, 300);
        if (!data?.signedUrl) continue;
        try {
          const res = await fetch(data.signedUrl);
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          const buf = await blob.arrayBuffer();
          if (cancelled) return;
          blobUrl = URL.createObjectURL(new Blob([buf], { type: "application/pdf" }));
          setBytes(buf);
          setUrl(blobUrl);
          return;
        } catch { /* try next */ }
      }
      if (!cancelled) setErr("Couldn't open this price list.");
    })();
    return () => { cancelled = true; if (blobUrl) URL.revokeObjectURL(blobUrl); };
  }, [current, demo]);

  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [expanded]);

  if (!demo && isLoading) return <p className="p-4 text-sm opacity-70">Loading price lists…</p>;
  if (!rows.length) return <p className="p-4 text-sm opacity-70" data-testid="pricelist-empty">No live price lists yet.</p>;

  const pill = "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium ring-1 ring-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50";
  const picker = (full: boolean) => rows.length > 1
    ? (
      <Select value={current?.row.id} onValueChange={pick}>
        <SelectTrigger className={`h-10 min-w-0 flex-1 rounded-full text-xs ${full ? "max-w-md" : ""}`} data-testid={full ? "pricelist-picker-full" : "pricelist-picker"}><SelectValue /></SelectTrigger>
        <SelectContent className="z-[110]">
          {rows.map((l) => <SelectItem key={l.row.id} value={l.row.id}>{l.label}</SelectItem>)}
        </SelectContent>
      </Select>
    )
    : <div className="min-w-0 flex-1 truncate text-xs font-medium opacity-80">{current?.label}</div>;

  const newTab = url && (
    <a href={url} target="_blank" rel="noopener noreferrer" className={pill} aria-label="Open price list in a new tab" data-testid="pricelist-newtab">
      <ExternalLink className="h-3.5 w-3.5" /> New tab
    </a>
  );

  const view = (cls: string, testId: string) => demo
    ? <DemoPriceList heading={demo.heading} className={`w-full ${cls}`} testId={testId} />
    : err ? <p className="p-4 text-sm text-red-600">{err}</p>
    : bytes ? <PdfCanvasViewer key={`${testId}-${current?.row.id}`} data={bytes} className={`w-full ${cls}`} testId={testId} />
    : <p className="p-4 text-sm opacity-70">Opening…</p>;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="pricelist-pane">
      <div className="flex shrink-0 items-center gap-2" data-testid="pricelist-toolbar">
        {picker(false)}
        <button type="button" onClick={() => setExpanded(true)} disabled={!demo && !bytes} className={pill} aria-label="Expand price list to full page" data-testid="pricelist-expand">
          <Maximize2 className="h-3.5 w-3.5" /> Expand
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full bg-[#C2410C] px-3.5 text-sm font-semibold text-white hover:bg-[#9A3412]" aria-label="Close price list" data-testid="pricelist-sheet-close">
            <X className="h-4 w-4" /> Close
          </button>
        )}
      </div>
      {!expanded && view(heightClass, "pricelist-frame")}
      {url && !expanded && <div className="flex shrink-0 justify-end">{newTab}</div>}
      {/* The open sheet sets pointer-events:none on body, so this portal opts back in. */}
      {expanded && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Price list"
          className="pointer-events-auto fixed inset-0 z-[100] flex flex-col gap-2 bg-slate-100 px-3 pt-[calc(var(--fl-pricelist-safe-top,env(safe-area-inset-top,0px))+0.75rem)] pb-[calc(var(--fl-pricelist-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)]"
          style={{
            paddingTop: "calc(var(--fl-pricelist-safe-top, env(safe-area-inset-top, 0px)) + 0.75rem)",
            paddingBottom: "calc(var(--fl-pricelist-safe-bottom, env(safe-area-inset-bottom, 0px)) + 0.75rem)",
          }}
          data-testid="pricelist-fullpage"
        >
          <div className="flex shrink-0 items-center gap-2" data-testid="pricelist-full-toolbar">
            {picker(true)}
            {newTab}
            <button type="button" onClick={() => setExpanded(false)} autoFocus className="inline-flex h-12 min-w-[7.5rem] shrink-0 items-center justify-center gap-2 rounded-full bg-[#C2410C] px-5 text-base font-semibold text-white shadow-sm hover:bg-[#9A3412]" aria-label="Close full page price list (Esc)" data-testid="pricelist-close">
              <X className="h-5 w-5" /> Close
            </button>
          </div>
          {view("min-h-0 flex-1", "pricelist-frame-full")}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Static stand-in used only by the screenshot harness. */
function DemoPriceList({ heading, className, testId }: { heading: string; className: string; testId: string }) {
  const sample = [
    ["DEMO-09", "9 000", "Sample row"],
    ["DEMO-12", "12 000", "Sample row"],
    ["DEMO-18", "18 000", "Sample row"],
    ["DEMO-24", "24 000", "Sample row"],
  ];
  return (
    <div className={`overflow-auto rounded-md bg-slate-50 p-3 ring-1 ring-slate-200 ${className}`} data-testid={testId}>
      <article className="mx-auto bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#C2410C]">Demo</p>
        <h2 className="mt-1 text-lg font-semibold text-[#0F2A44]">{heading}</h2>
        <p className="mt-1 text-xs text-slate-500">Demo — harness, not live client data. No catalogue prices.</p>
        <table className="mt-3 w-full text-left text-xs">
          <thead>
            <tr className="bg-[#3D9BEB] text-white">
              <th className="px-2 py-1.5 font-semibold">Model</th>
              <th className="px-2 py-1.5 font-semibold">BTU</th>
              <th className="px-2 py-1.5 font-semibold">Note</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((r) => (
              <tr key={r[0]} className="border-b border-slate-100">
                <td className="px-2 py-2">{r[0]}</td>
                <td className="px-2 py-2">{r[1]}</td>
                <td className="px-2 py-2">{r[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </div>
  );
}
