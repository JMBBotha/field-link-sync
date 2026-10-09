import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCanWriteMasterCatalog, MASTER_ONLY_NOTE } from "@/components/catalog/MasterCatalogGate";
import { INHOUSE_CATEGORIES, categoryByLabel, buildSku, nextFreeSku, isValidSku, suggestName } from "@/lib/inhouse/sku";
import { fmtRand, sortBookItems } from "@/lib/inhouse/pricebookPdf";
import { publishInhouseBook, type PublishItem } from "@/lib/inhouse/publish";
import { ArrowLeft, Plus, Pencil, Archive, RotateCcw, FileText, Loader2 } from "lucide-react";

/**
 * One Stop Shop extras (2026-10-09): in-house items that are not on the supplier PDF
 * (cable, conduit, consumables, bolts & nuts). Every save regenerates the in-house price
 * book PDF and publishes it with the items in one transaction. Master-catalogue admins only;
 * sales and dispatch only view/quote the items through the price lists and pickers.
 */
interface Row {
  id: string; product_code: string; short_name: string | null; description: string | null; category: string | null;
  cost_price: number | null; sold_in_length: boolean | null; unit_length: number | null; archived: boolean | null;
  sku?: { family: string; type_code: string | null; size_code: string | null; variant: string | null } | null;
}
interface Draft {
  id?: string; category: string; typeCode: string; size: string; variant: string; name: string; nameTouched: boolean;
  cost: string; perMetre: boolean; length: string; description: string; ownCode?: string;
}
const emptyDraft = (): Draft => ({ category: INHOUSE_CATEGORIES[0].label, typeCode: INHOUSE_CATEGORIES[0].types[0].code, size: "", variant: "", name: "", nameTouched: false, cost: "", perMetre: true, length: "100", description: "" });

function rowToPublish(r: Row, archived = !!r.archived): PublishItem {
  const cat = categoryByLabel(r.category || "");
  return {
    key: r.id, id: r.id, archived, sku_code: r.product_code, name: r.short_name || r.product_code, description: r.description,
    category: r.category || "Consumables", cost: Number(r.cost_price || 0), per_metre: !!r.sold_in_length, unit_length: r.unit_length,
    family: r.sku?.family || cat?.family || r.product_code.split("-")[0], type_code: r.sku?.type_code || r.product_code.split("-")[1] || "GEN",
    size_code: r.sku?.size_code ?? null, variant: r.sku?.variant ?? null,
  };
}

const AdminOssExtrasPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { canWrite, isLoading: accessLoading } = useCanWriteMasterCatalog();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const { data: supplier } = useQuery({
    queryKey: ["oss-extras-supplier"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("suppliers") as any).select("id, name").eq("supplier_type", "consumables").ilike("name", "%one stop%").limit(1).maybeSingle();
      if (error) throw error;
      return data as { id: string; name: string } | null;
    },
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["oss-extras-items", supplier?.id],
    enabled: !!supplier?.id,
    queryFn: async () => {
      const [items, codes, skus, book] = await Promise.all([
        (supabase.from("supplier_products") as any).select("id, product_code, short_name, description, category, cost_price, sold_in_length, unit_length, archived")
          .eq("supplier_id", supplier!.id).contains("import_flags", ["in_house"]).order("product_code"),
        (supabase.from("supplier_products") as any).select("product_code").eq("supplier_id", supplier!.id).limit(5000),
        (supabase.from("supplier_sku_map" as any) as any).select("supplier_product_id, internal_skus(sku_code, family, type_code, size_code, variant)").eq("supplier_id", supplier!.id).is("active_to", null),
        (supabase.from("pdf_uploads") as any).select("id, file_name, file_url, activated_at").eq("supplier_id", supplier!.id).eq("price_list_type", "in_house").eq("is_active", true).maybeSingle(),
      ]);
      for (const r of [items, codes, skus, book]) if (r.error) throw r.error;
      const allSkus = await (supabase.from("internal_skus" as any) as any).select("sku_code");
      const skuBy: Record<string, any> = {};
      (skus.data || []).forEach((m: any) => { if (m.supplier_product_id) skuBy[m.supplier_product_id] = m.internal_skus; });
      const rows: Row[] = (items.data || []).map((r: any) => ({ ...r, sku: skuBy[r.id] || null }));
      const taken = new Set<string>([...(codes.data || []).map((c: any) => c.product_code), ...((allSkus.data || []) as any[]).map((s) => s.sku_code)].filter(Boolean));
      return { rows, taken, book: book.data as any };
    },
  });
  const rows = data?.rows || [];
  const live = rows.filter((r) => !r.archived);
  const shown = sortBookItems((showArchived ? rows : live).map((r) => rowToPublish(r))).map((p) => rows.find((r) => r.id === p.key)!);

  const cat = draft ? categoryByLabel(draft.category) : undefined;
  const type = cat?.types.find((t) => t.code === draft?.typeCode);
  const baseSku = draft && cat && type ? buildSku({ family: cat.family, type: type.code, size: draft.size, variant: draft.variant }) : "";
  const sku = useMemo(() => (baseSku && data ? nextFreeSku(baseSku, data.taken, draft?.ownCode) : { code: baseSku, clashed: false }), [baseSku, data, draft?.ownCode]);
  const autoName = draft ? suggestName(cat, type, draft.size, draft.variant) : "";
  const name = draft ? (draft.nameTouched ? draft.name : autoName) : "";
  const costN = Number(String(draft?.cost || "").replace(",", "."));
  const lenN = Number(String(draft?.length || "").replace(",", "."));
  const formError = !draft ? null
    : !isValidSku(sku.code) ? "Pick a type (and size) to build the SKU"
    : !name.trim() ? "Name is required"
    : !(costN > 0) ? "Cost must be above R0"
    : draft.perMetre && !(lenN > 0) ? "Coil / pack length (m) is required for per-metre items" : null;

  const publish = async (items: PublishItem[], done: string) => {
    if (!supplier) return;
    setBusy(true);
    try {
      const r = await publishInhouseBook({ supplierId: supplier.id, supplierName: supplier.name, items });
      toast({ title: done, description: `Price book v${r.version} is live in the price lists.` });
      setDraft(null);
      await refetch();
      ["quote-builder-products", "visual-panel-pages", "visual-panel-suppliers", "live-products"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e: any) {
      toast({ title: "Not saved", description: e?.message || "The save was rejected", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (!draft || formError || !cat || !type) return;
    const others = live.filter((r) => r.id !== draft.id).map((r) => rowToPublish(r));
    const item: PublishItem = {
      key: draft.id || "new", id: draft.id || null, sku_code: sku.code, name: name.trim(), description: draft.description.trim() || null,
      category: cat.label, cost: Math.round(costN * 100) / 100, per_metre: draft.perMetre, unit_length: draft.perMetre ? lenN : null,
      family: cat.family, type_code: type.code, size_code: draft.size.trim() || null, variant: draft.variant.trim() || null,
    };
    void publish([...others, item], draft.id ? `Updated ${sku.code}` : `Added ${sku.code}`);
  };
  const setArchived = (r: Row, archived: boolean) => {
    const others = live.filter((x) => x.id !== r.id).map((x) => rowToPublish(x));
    void publish([...others, rowToPublish(r, archived)], archived ? `Archived ${r.product_code}` : `Restored ${r.product_code}`);
  };
  const edit = (r: Row) => {
    const p = rowToPublish(r);
    const c = categoryByLabel(p.category) || INHOUSE_CATEGORIES[2];
    setDraft({
      id: r.id, ownCode: r.product_code, category: c.label, typeCode: c.types.some((t) => t.code === p.type_code) ? p.type_code : c.types[0].code,
      size: p.size_code || "", variant: p.variant || "", name: p.name, nameTouched: true, cost: String(p.cost), perMetre: p.per_metre,
      length: String(p.unit_length || ""), description: r.description && r.description !== p.name ? r.description : "",
    });
  };

  if (accessLoading) return null;
  if (!canWrite) {
    return <div className="p-4"><p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">{MASTER_ONLY_NOTE}</p></div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-3 sm:p-6" data-testid="oss-extras-page">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/admin/price-lists")}><ArrowLeft className="mr-1 h-4 w-4" />Price lists</Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">One Stop Shop extras</h1>
          <p className="text-xs text-muted-foreground">Items not on the supplier PDF. Each save rebuilds the in-house price book shown after the One Stop Shop list.</p>
        </div>
        {data?.book?.file_url && (
          <Button variant="outline" size="sm" asChild><a href={data.book.file_url} target="_blank" rel="noreferrer"><FileText className="mr-1 h-4 w-4" />Current PDF</a></Button>
        )}
        <Button size="sm" onClick={() => setDraft(emptyDraft())} disabled={busy || !supplier} data-testid="oss-extras-add"><Plus className="mr-1 h-4 w-4" />Add item</Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <Switch id="show-arch" checked={showArchived} onCheckedChange={setShowArchived} />
        <Label htmlFor="show-arch">Show archived</Label>
        <span className="ml-auto text-xs text-muted-foreground">{live.length} live item{live.length === 1 ? "" : "s"}{data?.book ? ` · ${data.book.file_name}` : ""}</span>
      </div>
      {(isLoading || !supplier) && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && shown.length === 0 && <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No extras yet. Add cable, conduit, consumables or bolts & nuts.</p>}
      <div className="divide-y rounded-md border">
        {shown.map((r, i) => {
          const header = i === 0 || shown[i - 1].category !== r.category;
          return (
            <div key={r.id}>
              {header && <div className="bg-muted/60 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-primary">{r.category}</div>}
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${r.archived ? "opacity-50" : ""}`} data-testid="oss-extras-row">
                <code className="w-44 shrink-0 font-mono text-xs font-semibold">{r.product_code}</code>
                <span className="min-w-0 flex-1 truncate">{r.short_name}</span>
                <span className="text-xs text-muted-foreground">{r.sold_in_length ? `per m · ${r.unit_length} m coil` : "each"}</span>
                <span className="w-28 text-right font-medium tabular-nums">{fmtRand(Number(r.cost_price || 0))}</span>
                {r.archived ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setArchived(r, false)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Restore</Button>
                ) : (
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => edit(r)} aria-label={`Edit ${r.product_code}`}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setArchived(r, true)} aria-label={`Archive ${r.product_code}`}><Archive className="h-3.5 w-3.5" /></Button>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => { if (!o && !busy) setDraft(null); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit item" : "Add item"}</DialogTitle>
            <DialogDescription>Cost excl. VAT. Per-metre items are quoted per metre from the coil price (+ waste and markup).</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label>Category</Label>
                  <Select value={draft.category} onValueChange={(v) => { const c = categoryByLabel(v)!; setDraft({ ...draft, category: v, typeCode: c.types[0].code, perMetre: c.types[0].unit === "metre" }); }}>
                    <SelectTrigger data-testid="oss-cat"><SelectValue /></SelectTrigger>
                    <SelectContent>{INHOUSE_CATEGORIES.map((c) => <SelectItem key={c.label} value={c.label}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label>Type</Label>
                  <Select value={draft.typeCode} onValueChange={(v) => { const t = cat?.types.find((x) => x.code === v); setDraft({ ...draft, typeCode: v, perMetre: t ? t.unit === "metre" : draft.perMetre }); }}>
                    <SelectTrigger data-testid="oss-type"><SelectValue /></SelectTrigger>
                    <SelectContent>{cat?.types.map((t) => <SelectItem key={t.code} value={t.code}>{t.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="oss-size">Size</Label>
                  <Input id="oss-size" value={draft.size} placeholder={type?.sizeHint || "optional"} onChange={(e) => setDraft({ ...draft, size: e.target.value })} />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="oss-variant">Variant</Label>
                  <Input id="oss-variant" value={draft.variant} placeholder={type?.variantHint || "optional"} onChange={(e) => setDraft({ ...draft, variant: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1">
                <Label>Internal SKU (automatic)</Label>
                <div className="flex items-center gap-2 rounded-md border bg-muted px-3 py-2 font-mono text-sm" data-testid="oss-sku">{sku.code || "—"}</div>
                {sku.clashed && <p className="text-xs text-amber-600">{baseSku} is already used, so this item gets {sku.code}. Change size/variant if it is really a different product.</p>}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="oss-name">Name</Label>
                <Input id="oss-name" value={name} onChange={(e) => setDraft({ ...draft, name: e.target.value, nameTouched: true })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="oss-pm" checked={draft.perMetre} onCheckedChange={(v) => setDraft({ ...draft, perMetre: v })} />
                <Label htmlFor="oss-pm">Sold per metre (from a coil / length)</Label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1">
                  <Label htmlFor="oss-cost">{draft.perMetre ? "Coil cost (R, excl. VAT)" : "Cost each (R, excl. VAT)"}</Label>
                  <Input id="oss-cost" inputMode="decimal" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} />
                </div>
                {draft.perMetre && (
                  <div className="grid gap-1">
                    <Label htmlFor="oss-len">Coil / pack length (m)</Label>
                    <Input id="oss-len" inputMode="decimal" value={draft.length} onChange={(e) => setDraft({ ...draft, length: e.target.value })} />
                  </div>
                )}
              </div>
              {draft.perMetre && costN > 0 && lenN > 0 && (
                <p className="text-xs text-muted-foreground">Cost per metre {fmtRand(costN / lenN)} (quotes add 10% waste and the materials markup).</p>
              )}
              <div className="grid gap-1">
                <Label htmlFor="oss-desc">Notes for quotes (optional)</Label>
                <Input id="oss-desc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </div>
              {formError && <p className="text-xs text-destructive">{formError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveDraft} disabled={busy || !!formError} data-testid="oss-save">{busy ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Publishing…</> : "Save & publish"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminOssExtrasPage;
