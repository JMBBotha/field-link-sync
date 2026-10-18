import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, RefreshCw, Upload, Undo2, Wand2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuoteUnitCardsView, ensureUnitContent } from "@/components/quoting/QuoteUnitCards";
import { normalizeModelCode, type ProductMedia } from "@/lib/unitCards";

/** Admin > Unit content (Massair admins): review, edit and approve quote unit cards. Drafts never reach clients. */

const SPEC_FIELDS: [string, string][] = [
  ["cool_kw", "Cool kW"], ["heat_kw", "Heat kW"], ["btu", "BTU/h"], ["eer", "EER"], ["cop", "COP"], ["seer", "SEER"],
  ["energy_class", "Energy class"], ["noise_in_db", "Indoor dBA (hi/lo)"], ["noise_out_db", "Outdoor dBA"],
  ["refrigerant", "Refrigerant"], ["room_m2", "Room m²"], ["warranty", "Warranty"],
  // Net (unpacked) sizes and weights only, never box/gross (Johan 13 Oct 11:45).
  ["indoor_dim_mm", "Indoor net W×H×D mm"], ["outdoor_dim_mm", "Outdoor net W×H×D mm"], ["indoor_net_kg", "Indoor net kg"], ["outdoor_net_kg", "Outdoor net kg"],
];
const ICONS = ["windfree", "ai", "fast", "protect", "inverter", "filter", "wifi", "quiet"];

const isAlphaPng = async (f: File) => {
  const b = new Uint8Array(await f.slice(0, 26).arrayBuffer());
  return b[0] === 0x89 && b[1] === 0x50 && (b[25] === 6 || b[25] === 4);
};

export default function AdminUnitContentPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"todo" | "approved" | "all">("todo");
  const [sel, setSel] = useState<ProductMedia | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["product_media_admin"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("product_media" as never) as any).select("*").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as (ProductMedia & { notes?: string; fetch_error?: string; image_source_url?: string })[];
    },
  });
  // Seed images ship with the app (/product-media/seed/*.png); move them into our own storage bucket on first admin visit.
  const moving = useRef(false);
  useEffect(() => {
    const seeds = rows.filter((r) => (r.image_url || "").startsWith("/product-media/"));
    if (!seeds.length || moving.current) return;
    moving.current = true;
    (async () => {
      for (const r of seeds) {
        try {
          const blob = await (await fetch(r.image_url!)).blob();
          const path = `cutouts/${r.model_key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
          const up = await supabase.storage.from("product-media").upload(path, blob, { contentType: "image/png", upsert: true });
          if (up.error) continue;
          const url = supabase.storage.from("product-media").getPublicUrl(path).data.publicUrl;
          await (supabase.from("product_media" as never) as any).update({ image_url: url, image_path: path }).eq("model_key", r.model_key);
        } catch { /* retry next visit */ }
      }
      qc.invalidateQueries({ queryKey: ["product_media_admin"] });
    })();
  }, [rows, qc]);

  const counts = useMemo(() => ({
    todo: rows.filter((r) => r.status !== "approved").length,
    approved: rows.filter((r) => r.status === "approved").length,
    all: rows.length,
  }), [rows]);
  const shown = rows.filter((r) => filter === "all" || (filter === "approved" ? r.status === "approved" : r.status !== "approved"));
  const refresh = () => qc.invalidateQueries({ queryKey: ["product_media_admin"] });

  const save = async (patch: Partial<ProductMedia> & Record<string, any>) => {
    if (!sel) return;
    const { error } = await (supabase.from("product_media" as never) as any).update(patch).eq("model_key", sel.model_key);
    if (error) return toast.error(error.message);
    setSel({ ...sel, ...patch });
    refresh();
    toast.success("Saved");
  };

  const upload = async (f: File) => {
    if (!sel) return;
    if (!(await isAlphaPng(f))) return toast.error("Please upload a transparent PNG cut-out (no white background).");
    const path = `cutouts/${sel.model_key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`;
    const up = await supabase.storage.from("product-media").upload(path, f, { contentType: "image/png", upsert: true });
    if (up.error) return toast.error(up.error.message);
    const url = supabase.storage.from("product-media").getPublicUrl(path).data.publicUrl + `?v=${Date.now()}`;
    await save({ image_url: url, image_status: "ready", image_path: path } as any);
  };

  const refetch = async (key: string) => {
    const { data, error } = await supabase.functions.invoke("lookup-ac-unit-specs", { body: { action: "refetch_media", model_codes: [key] } });
    if (error || (data as any)?.error) return toast.error("Fetch failed");
    toast.success("Fetched as draft");
    refresh();
  };

  /** Bulk pre-fill: Samsung units on current price lists with no content yet, one at a time into DRAFT. */
  const prefillSamsung = async () => {
    const { data } = await (supabase.from("supplier_products") as any)
      .select("product_code").eq("brand", "Samsung").eq("product_type", "ac_unit").eq("is_active", true).or("archived.is.null,archived.eq.false");
    const have = new Set(rows.map((r) => r.model_key));
    const keys = [...new Set(((data || []) as any[]).map((r) => normalizeModelCode(r.product_code)).filter((k): k is string => !!k && !have.has(k)))];
    if (!keys.length) return toast.info("All Samsung models already have content.");
    setBatch({ done: 0, total: keys.length });
    for (let i = 0; i < keys.length; i += 2) {
      await ensureUnitContent(keys.slice(i, i + 2));
      setBatch({ done: Math.min(i + 2, keys.length), total: keys.length });
    }
    setBatch(null);
    refresh();
    toast.success(`Pre-filled ${keys.length} Samsung models as drafts`);
  };

  const s = (sel?.specs || {}) as Record<string, any>;
  const h = (sel?.feature_highlight || { title: "", text: "", icon: "inverter" }) as any;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Unit content</h1>
          <p className="text-sm text-muted-foreground">Pictures, specs and highlights for the "units in this quote" cards. Only approved content reaches clients; until then a simple card shows.</p>
        </div>
        <Button variant="outline" onClick={prefillSamsung} disabled={!!batch}>
          {batch ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{batch.done}/{batch.total}</> : <><Wand2 className="mr-2 h-4 w-4" />Pre-fill Samsung (draft)</>}
        </Button>
      </div>
      <div className="flex gap-2">
        {(["todo", "approved", "all"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
            {f === "todo" ? "To approve" : f === "approved" ? "Approved" : "All"} ({counts[f]})
          </Button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardContent className="max-h-[70vh] space-y-1 overflow-auto p-2">
            {isLoading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
            {shown.map((r) => (
              <button key={r.model_key} onClick={() => setSel(r)} className={`flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted ${sel?.model_key === r.model_key ? "bg-muted" : ""}`}>
                <div className="flex h-10 w-14 items-center justify-center rounded bg-sky-50">{r.image_status === "ready" && r.image_url ? <img src={r.image_url} alt="" className="max-h-9 max-w-12" /> : <span className="text-xs text-muted-foreground">no image</span>}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.display_name || r.model_code}</div>
                  <div className="truncate text-xs text-muted-foreground">{r.model_code}</div>
                </div>
                <Badge variant={r.status === "approved" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>{r.status}</Badge>
              </button>
            ))}
            {!isLoading && !shown.length && <p className="p-3 text-sm text-muted-foreground">Nothing here.</p>}
          </CardContent>
        </Card>
        {sel ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
              <CardTitle className="text-lg">{sel.model_code}</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => refetch(sel.model_key)}><RefreshCw className="mr-1 h-4 w-4" />Re-fetch</Button>
                <label className="inline-flex cursor-pointer items-center rounded-md border px-3 text-sm"><Upload className="mr-1 h-4 w-4" />Cut-out PNG<input type="file" accept="image/png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
                {sel.status === "approved"
                  ? <Button size="sm" variant="outline" onClick={() => save({ status: "draft", approved_at: null } as any)}><Undo2 className="mr-1 h-4 w-4" />Back to draft</Button>
                  : <Button size="sm" onClick={async () => { const { data } = await supabase.auth.getUser(); save({ status: "approved", approved_at: new Date().toISOString(), approved_by: data.user?.id } as any); }}><Check className="mr-1 h-4 w-4" />Approve</Button>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {(sel as any).fetch_error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">Fetch error: {(sel as any).fetch_error}</p>}
              {(sel as any).notes && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">{(sel as any).notes}</p>}
              {sel.image_status === "needs_cutout" && <p className="rounded bg-amber-50 p-2 text-sm text-amber-800">The source image has a background. Upload a transparent PNG cut-out (source: <a className="underline" href={(sel as any).image_source_url} target="_blank" rel="noreferrer">image</a>).</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {([["display_name", "Name"], ["subtitle", "Subtitle"], ["product_url", "Product page URL"], ["support_url", "Support page URL"], ["source_label", "Source label"], ["family", "Family"]] as const).map(([k, label]) => (
                  <label key={k} className="text-xs text-muted-foreground">{label}
                    <Input defaultValue={(sel as any)[k] || ""} key={sel.model_key + k} onBlur={(e) => e.target.value !== ((sel as any)[k] || "") && save({ [k]: e.target.value || null } as any)} />
                  </label>
                ))}
              </div>
              <label className="block text-xs text-muted-foreground">Benefit bullets (one per line, 3–5)
                <Textarea key={sel.model_key + "b"} rows={5} defaultValue={(sel.bullets || []).join("\n")} onBlur={(e) => save({ bullets: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 5) })} />
              </label>
              <div className="grid gap-3 sm:grid-cols-4">
                {SPEC_FIELDS.map(([k, label]) => (
                  <label key={k} className="text-xs text-muted-foreground">{label}
                    <Input key={sel.model_key + k} defaultValue={s[k] ?? ""} onBlur={(e) => { const v = e.target.value.trim(); const n = Number(v); save({ specs: { ...s, [k]: v === "" ? null : (/^[\d.]+$/.test(v) && !Number.isNaN(n) ? n : v) } }); }} />
                  </label>
                ))}
                <label className="text-xs text-muted-foreground">Wi-Fi
                  <select key={sel.model_key + "wifi"} className="block h-10 w-full rounded-md border px-2" defaultValue={s.wifi === true ? "yes" : s.wifi === false ? "no" : ""} onChange={(e) => save({ specs: { ...s, wifi: e.target.value === "" ? null : e.target.value === "yes" } })}>
                    <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_1fr_2fr]">
                <label className="text-xs text-muted-foreground">Highlight icon
                  <select key={sel.model_key + "hi"} className="block h-10 w-full rounded-md border px-2" defaultValue={h.icon || "inverter"} onChange={(e) => save({ feature_highlight: { ...h, icon: e.target.value } })}>
                    {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </label>
                <label className="text-xs text-muted-foreground">Signature feature
                  <Input key={sel.model_key + "ht"} defaultValue={h.title || ""} onBlur={(e) => save({ feature_highlight: e.target.value ? { ...h, title: e.target.value } : null })} />
                </label>
                <label className="text-xs text-muted-foreground">What it does for the client (one line)
                  <Input key={sel.model_key + "hx"} defaultValue={h.text || ""} onBlur={(e) => save({ feature_highlight: { ...h, text: e.target.value } })} />
                </label>
              </div>
              <div className="rounded-lg border bg-white p-4">
                <p className="mb-2 text-xs text-muted-foreground">Preview (as the client sees it once approved)</p>
                <QuoteUnitCardsView cards={[{ modelKey: sel.model_key, modelCode: sel.model_code, quantity: 1, rooms: ["Room"], media: { ...sel, status: "approved" }, brand: sel.brand || null, btu: null, refrigerant: null, name: sel.display_name || sel.model_code }]} />
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card><CardContent className="p-6 text-sm text-muted-foreground">Pick a model to review it.</CardContent></Card>
        )}
      </div>
    </div>
  );
}
