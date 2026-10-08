import { useMemo, useState } from "react";
import { liveProducts } from "@/lib/liveProducts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Upload, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatRand } from "@/utils/formatRand";
import { SpecialsPdfDialog } from "@/components/specials/SpecialsUi";
import { fmtDate, isSpecialRunning, normModel, todayIso, type SupplierSpecial } from "@/lib/specials";

type Draft = { id?: string; supplier_id: string; model_number: string; special_cost: string; start_date: string; end_date: string; notes: string };
const emptyDraft = (): Draft => ({ supplier_id: "", model_number: "", special_cost: "", start_date: todayIso(), end_date: todayIso(), notes: "" });

export default function AdminSpecialsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [pdf, setPdf] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const { data: specials = [], isLoading } = useQuery({
    queryKey: ["supplier-specials-admin"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_specials" as any) as any).select("*").order("end_date", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SupplierSpecial[];
    },
  });
  const { data: suppliers = [] } = useQuery({
    queryKey: ["specials-suppliers"],
    queryFn: async () => ((await supabase.from("suppliers").select("id, name").order("name")).data ?? []) as { id: string; name: string }[],
  });
  const { data: products = [] } = useQuery({
    queryKey: ["specials-products"],
    queryFn: async () => {
      const out: { id: string; product_code: string | null; short_name: string | null; supplier_id: string | null; cost_excl_vat: number | null }[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data } = await liveProducts()
          .select("id, product_code, short_name, supplier_id, cost_excl_vat").eq("is_active", true).range(from, from + 999);
        out.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return out;
    },
  });

  const byModel = useMemo(() => {
    const m = new Map<string, (typeof products)[number]>();
    products.forEach((p) => { const k = normModel(p.product_code); if (k && !m.has(k)) m.set(k, p); });
    return m;
  }, [products]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const supplierName = (id: string | null) => suppliers.find((s) => s.id === id)?.name ?? "—";
  const draftMatch = draft ? byModel.get(normModel(draft.model_number)) ?? null : null;
  const list = specials.filter((s) => showInactive || s.is_active);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["supplier-specials-admin"] }); qc.invalidateQueries({ queryKey: ["active-specials"] }); };

  const save = async () => {
    if (!draft) return;
    const cost = Number(draft.special_cost);
    if (!draft.model_number.trim() || !Number.isFinite(cost) || cost < 0) { toast({ title: "Model number and a valid cost are required", variant: "destructive" }); return; }
    if (draft.end_date < draft.start_date) { toast({ title: "End date is before start date", variant: "destructive" }); return; }
    setSaving(true);
    const match = byModel.get(normModel(draft.model_number));
    const row = {
      supplier_id: draft.supplier_id || match?.supplier_id || null,
      model_number: draft.model_number.trim(),
      supplier_product_id: match?.id ?? null,
      special_cost: cost, start_date: draft.start_date, end_date: draft.end_date,
      notes: draft.notes.trim() || null,
    };
    const q = (supabase.from("supplier_specials" as any) as any);
    const { data, error } = draft.id ? await q.update(row).eq("id", draft.id).select("id") : await q.insert(row).select("id");
    setSaving(false);
    if (error || !data?.length) { toast({ title: "Couldn't save special", description: error?.message ?? "Not allowed", variant: "destructive" }); return; }
    toast({ title: match ? `Saved — linked to ${match.short_name || match.product_code}` : "Saved — no catalogue product matched this model" });
    setDraft(null); refresh();
  };

  const setActive = async (s: SupplierSpecial, active: boolean) => {
    const { data, error } = await (supabase.from("supplier_specials" as any) as any).update({ is_active: active }).eq("id", s.id).select("id");
    if (error || !data?.length) { toast({ title: "Couldn't update", description: error?.message, variant: "destructive" }); return; }
    refresh();
  };

  const uploadPdf = async (file: File) => {
    if (!picked.size) return;
    setUploading(true);
    const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
    const up = await supabase.storage.from("specials-pdfs").upload(path, file, { contentType: "application/pdf" });
    if (up.error) { setUploading(false); toast({ title: "Upload failed", description: up.error.message, variant: "destructive" }); return; }
    const { data, error } = await (supabase.from("supplier_specials" as any) as any).update({ specials_pdf_path: path }).in("id", [...picked]).select("id");
    setUploading(false);
    if (error) { toast({ title: "Couldn't attach PDF", description: error.message, variant: "destructive" }); return; }
    toast({ title: `PDF attached to ${data?.length ?? 0} special(s)` });
    setPicked(new Set()); refresh();
  };

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Tag className="h-5 w-5 text-primary" /> Supplier specials</h1>
          <p className="text-sm text-muted-foreground">Specials sit on top of the price list — catalogue prices never change. Staff choose per quote line.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(!!v)} /> Show inactive</label>
          <Button variant="outline" disabled={!picked.size || uploading} asChild={!!picked.size && !uploading}>
            {picked.size && !uploading ? (
              <label className="cursor-pointer"><Upload className="mr-1 h-4 w-4" /> Attach PDF to {picked.size}
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadPdf(f); }} />
              </label>
            ) : <span>{uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />} Attach PDF (tick specials)</span>}
          </Button>
          <Button onClick={() => setDraft(emptyDraft())}><Plus className="mr-1 h-4 w-4" /> Add special</Button>
        </div>
      </div>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : list.length === 0 ? (
        <p className="rounded border border-dashed p-6 text-center text-sm text-muted-foreground">No specials yet.</p>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {list.map((s) => {
            const prod = s.supplier_product_id ? productById.get(s.supplier_product_id) : null;
            const running = isSpecialRunning(s);
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-3 p-3">
                <Checkbox checked={picked.has(s.id)} onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); v ? n.add(s.id) : n.delete(s.id); return n; })} aria-label="Select for PDF" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {s.model_number}
                    {!s.is_active ? <Badge variant="outline">Inactive</Badge> : running ? <Badge>Running</Badge> : <Badge variant="secondary">{s.start_date > todayIso() ? "Upcoming" : "Ended"}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {supplierName(s.supplier_id)} · {prod ? `Linked: ${prod.short_name || prod.product_code} (normal ${formatRand(Number(prod.cost_excl_vat || 0))})` : "Not linked to a catalogue product"}
                    {s.notes ? ` · ${s.notes}` : ""}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <div className="font-semibold">{formatRand(Number(s.special_cost))}</div>
                  <div className="text-xs text-muted-foreground">{fmtDate(s.start_date)} – {fmtDate(s.end_date)}</div>
                </div>
                <div className="flex gap-1">
                  {s.specials_pdf_path && <Button size="sm" variant="ghost" onClick={() => setPdf(s.specials_pdf_path)}><FileText className="h-4 w-4" /></Button>}
                  <Button size="sm" variant="outline" onClick={() => setDraft({ id: s.id, supplier_id: s.supplier_id ?? "", model_number: s.model_number, special_cost: String(s.special_cost), start_date: s.start_date, end_date: s.end_date, notes: s.notes ?? "" })}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => setActive(s, !s.is_active)}>{s.is_active ? "Deactivate" : "Activate"}</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{draft?.id ? "Edit special" : "Add special"}</DialogTitle></DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <Label>Model number</Label>
                <Input value={draft.model_number} onChange={(e) => setDraft({ ...draft, model_number: e.target.value })} placeholder="e.g. FTXM25R" />
                <p className="mt-1 text-xs text-muted-foreground">
                  {draft.model_number.trim() ? (draftMatch ? `Matches ${draftMatch.short_name || draftMatch.product_code} — normal cost ${formatRand(Number(draftMatch.cost_excl_vat || 0))}` : "No catalogue product with this code") : "Matched to the catalogue by product code (case and spaces ignored)."}
                </p>
              </div>
              <div>
                <Label>Supplier</Label>
                <Select value={draft.supplier_id || "auto"} onValueChange={(v) => setDraft({ ...draft, supplier_id: v === "auto" ? "" : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">From matched product</SelectItem>
                    {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Special cost (ex VAT)</Label><Input type="number" step="0.01" min="0" value={draft.special_cost} onChange={(e) => setDraft({ ...draft, special_cost: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Start</Label><Input type="date" value={draft.start_date} onChange={(e) => setDraft({ ...draft, start_date: e.target.value })} /></div>
                <div><Label>End</Label><Input type="date" value={draft.end_date} onChange={(e) => setDraft({ ...draft, end_date: e.target.value })} /></div>
              </div>
              <div><Label>Notes</Label><Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SpecialsPdfDialog path={pdf} onClose={() => setPdf(null)} />
    </div>
  );
}
