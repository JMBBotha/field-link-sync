/**
 * EstimateBuilder — the single quote surface on /admin/estimates/:id.
 *
 * The estimate document IS the editor: areas are section headers, lines are
 * editable in place, and everything writes into the already-open quoteId via
 * QuoteContext (quote_items / quote_areas). Cost, markup and profit live in a
 * separate staff card outside the pdf capture root.
 */
import { useQuoteEditors } from "@/hooks/useQuoteEditors";
import RemoveUnitDialog from "@/components/quoting/RemoveUnitDialog";
import { linkedToUnit } from "@/lib/unitInstallLinks";
import { useIsPhone } from "@/hooks/useIsPhone";
import { isLabourItem } from "@/lib/labour";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuoteContext, trackQuoteWrite } from "@/contexts/QuoteContext";
import { unassignedLabourLines } from "@/lib/areaLabour";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { installTag, qtyUnitLabel, BRACKET_OPTIONS } from "@/lib/installTemplates";
import { qtyLabel, shortInstallName, kitTitleFromMetadata, kitContents, isAcUnitLine } from "@/lib/lineDisplay";
import { catalogLineFields, kitSwapPatch, isMetreLine, metreLineTotal, kitLengthPatch } from "@/lib/mandy/quoteOps";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { swappableKits, kitSizeLabel } from "@/lib/kitSizes";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatRand } from "@/utils/formatRand";
import EstimateDocument, { type EstimateEditArea } from "@/components/quoting/EstimateDocument";
import QuoteQuickEditor from "@/components/quoting/QuoteQuickEditor";
import StaffMarginCard, { lineUnitCostOrNull } from "@/components/quoting/StaffMarginCard";
import SalespersonHistoryLine from "@/components/quoting/SalespersonHistoryLine";
import PricingChecksRow from "@/components/quoting/PricingChecksRow";
import { useMarginView } from "@/hooks/useMarginView";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useLabourNorms } from "@/hooks/useLabourNorms";
import { serviceNormKey } from "@/lib/pricingChecks";
import { applyAutoLabourDelta, areaLabourStatus, countAcUnits, labourTargetAreaId, normalizeLabourMode, isJobLabour, defaultLabourHours } from "@/lib/areaLabour";
import { labourFields, planLabour, standardLabourRate } from "@/lib/labour";

interface Props {
  quoteNumber: string;
  issueDate: string;
  validUntil?: string | null;
  customerName: string;
  customerCompany?: string | null;
  customerAddress?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  vatRate: number;
  notes?: string | null;
  termsText?: string | null;
  onChanged?: () => void;
}

/** Header shown for the default catch-all section (named areas keep their name). */
const DEFAULT_SECTION_LABEL = "Add items to quote";
/** Stable fallback: a fresh {} each render re-runs editAreas -> collapse layout effect -> setState loop. */
const EMPTY_PRODUCT_INFO: Record<string, any> = {};

const discountAmountFor = (subtotal: number, type: string | null, value: number) => {
  if (type === "percentage" || type === "percent") return (subtotal * value) / 100;
  if (type === "fixed") return value;
  return 0;
};


export default function EstimateBuilder({
  quoteNumber,
  issueDate,
  validUntil,
  customerName,
  customerCompany,
  customerAddress,
  customerEmail,
  customerPhone,
  vatRate,
  notes,
  termsText,
  onChanged,
}: Props) {
  const {
    quoteId, meta, areas, items, loading,
    addArea, updateArea, deleteArea, updateItem, deleteItem, updateQuote, addItem, refetch,
  } = useQuoteContext();
  const labourMode = normalizeLabourMode((meta as any)?.labour_mode);
  const { others: otherEditors } = useQuoteEditors(quoteId, "estimate");
  const builderEditor = otherEditors.find((e) => e.surface === "builder");
  const [removeUnit, setRemoveUnit] = useState<{ id: string; linked: string[] } | null>(null);
  const deleteUnitLine = (id: string, linked: string[], removeAll: boolean) => {
    const cur = items.find((i) => i.id === id);
    if (cur && lineFor(cur).isAcUnit) void adjustAutoLabour(cur.area_id, -Number(cur.quantity || 0));
    void deleteItem(id);
    for (const lid of linked) {
      if (removeAll) void deleteItem(lid);
      else {
        const l = items.find((i) => i.id === lid);
        if (l) { const { install: _drop, ...rest } = (l.metadata || {}) as any; void updateItem(lid, { metadata: rest } as any); }
      }
    }
    if (selectedLineId === id) setSelectedLineId(null);
    onChanged?.();
  };
  const [modeBusy, setModeBusy] = useState(false);
  const { products: liveProducts } = useQuoteBuilderProducts();
  const { bundles } = useQuoteBuilderBundles();
  const { toast } = useToast();
  const margin = useMarginView(quoteId ?? null, meta?.company_id ?? null);
  const { settings: companySettings } = useCompanySettings();
  const { data: labourNorms = [] } = useLabourNorms();
  const labourRate = standardLabourRate(companySettings.default_hourly_rate);
  const perUnitHours = Number(companySettings.default_install_labour_hours) || 3.5;
  const kitPool = useMemo(() => swappableKits(bundles as any, liveProducts), [bundles, liveProducts]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [activeAreaId, setActiveAreaId] = useState<string | null>(null);
  const [focusAreaId, setFocusAreaId] = useState<string | null>(null);
  const [openAdd, setOpenAdd] = useState<{ key: string; mode: "unit" | "service" | "material" | "favourites" } | null>(null);
  const isPhone = useIsPhone();
  const [collapsedAreaKeys, setCollapsedAreaKeys] = useState<Set<string>>(new Set());
  const collapseReadyRef = useRef(false);
  const previousLineAreasRef = useRef<Map<string, string>>(new Map());
  const previousAreaKeysRef = useRef<Set<string>>(new Set());



  const topLevel = useMemo(() => items.filter((i) => !i.parent_item_id), [items]);

  // Catalog product images for the sales-card thumb on each line.
  const productIds = useMemo(
    () => [...new Set(topLevel.map((i) => i.product_id).filter(Boolean))] as string[],
    [topLevel],
  );
  const { data: productImages = EMPTY_PRODUCT_INFO } = useQuery({
    queryKey: ["quote-item-product-info", productIds.sort().join(",")],
    enabled: productIds.length > 0,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, image_url, product_category, category, subcategory")
        .in("id", productIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((p: any) => [p.id, p]));
    },
  });

  const lineFor = (i: (typeof topLevel)[number]) => ({
    id: i.id,
    name: i.item_name,
    description: i.description,
    quantity: Number(i.quantity || 0),
    unit_price: Number(i.unit_price || 0),
    imageUrl: i.product_id ? (productImages as Record<string, any>)[i.product_id]?.image_url ?? null : null,
    installRole: installTag(i)?.role ?? null,
    installUnitId: installTag(i)?.unit_item_id ?? null,
    lengthLabel: qtyUnitLabel(Number(i.quantity || 0), i.metadata as any, Number(i.unit_price || 0)),
    perMetre: isMetreLine(i as any),
    itemNumber: i.item_number ?? null,
    kitBundleId: (i.metadata as any)?.kit?.bundle_id ?? null,
    kitPerMetre: (i.metadata as any)?.kit?.pricing_type === "p/meter",
    kitLength: (i as any).length != null ? Number((i as any).length) : null,
    isService: !!(i.metadata as any)?.catalog_service_id || String(i.item_type || "").toLowerCase() === "service",
    isLabour: isLabourItem(i) || !!(i.metadata as any)?.labour,
    labourAuto: (i.metadata as any)?.labour_auto === true,
    acUnitCount: 0,
    isAcUnit: isAcUnitLine({ item_name: i.item_name, item_type: i.item_type, is_bundle: (i as any).is_bundle, metadata: i.metadata as any, isLabour: isLabourItem(i) }, i.product_id ? (productImages as Record<string, any>)[i.product_id] : null),
    isInstallMaterial: !!(i as any).is_bundle || !!(i.metadata as any)?.kit || /^(consumables|installation kit)$/i.test(String(i.item_type || "").trim()),
    displayName: (() => {
      const dl = { item_name: i.item_name, quantity: Number(i.quantity || 0), unit_price: Number(i.unit_price || 0), length: (i as any).length ?? null, metadata: i.metadata as any };
      return kitTitleFromMetadata(dl) ?? shortInstallName(dl);
    })(),
    unitText: qtyLabel({ item_name: i.item_name, quantity: Number(i.quantity || 0), unit_price: Number(i.unit_price || 0), length: (i as any).length ?? null, metadata: i.metadata as any }),
    kitItems: (i.metadata as any)?.kit ? kitContents({ item_name: i.item_name, quantity: 0, length: (i as any).length ?? null, metadata: i.metadata as any }) : null,
    staffNote: margin.visible && lineUnitCostOrNull(i) != null ? `cost ${formatRand(lineUnitCostOrNull(i)!)}` : null,
  });

  const editAreas: EstimateEditArea[] = useMemo(() => {
    const grouped: EstimateEditArea[] = areas.map((a) => {
      const areaItems = topLevel.filter((i) => i.area_id === a.id);
      const unitCount = countAcUnits(areaItems.map((i) => ({ ...i, product: i.product_id ? (productImages as Record<string, any>)[i.product_id] : null })));
      return {
      id: a.id, name: a.name,
      labourLines: areaItems.filter(isLabourItem).map((i) => ({ ...lineFor(i), acUnitCount: unitCount })),
      defaultLabourHours: unitCount * perUnitHours,
      lines: areaItems
        .filter((i) => i.area_id === a.id && !isLabourItem(i))
        .sort((x, y) => (x.sort_order || 0) - (y.sort_order || 0))
        .reduce<typeof topLevel>((acc, i, _n, all) => {
          // Install lines sit directly under their unit.
          if (installTag(i) && all.some((u) => u.id === installTag(i)!.unit_item_id)) return acc;
          acc.push(i, ...all.filter((x) => installTag(x)?.unit_item_id === i.id));
          return acc;
        }, [])
        .map(lineFor),
    }});
    const orphans = topLevel.filter((i) => !i.area_id && !isLabourItem(i));
    if (orphans.length > 0) {
      grouped.push({
        id: null,
        name: DEFAULT_SECTION_LABEL,
        lines: orphans.map(lineFor),
      });
    }
    if (grouped.length === 0) grouped.push({ id: null, name: DEFAULT_SECTION_LABEL, lines: [] });
    return grouped;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areas, topLevel, productImages, margin.visible, perUnitHours]);

  useLayoutEffect(() => {
    if (loading) return;
    const currentAreaKeys = new Set(editAreas.map((area) => area.id ?? "unassigned"));
    const currentLineAreas = new Map<string, string>();
    for (const area of editAreas) {
      const key = area.id ?? "unassigned";
      for (const line of area.lines) currentLineAreas.set(line.id, key);
    }

    if (!collapseReadyRef.current) {
      setCollapsedAreaKeys(new Set(currentAreaKeys));
      collapseReadyRef.current = true;
    } else {
      setCollapsedAreaKeys((current) => {
        const next = new Set([...current].filter((key) => currentAreaKeys.has(key)));
        for (const key of currentAreaKeys) {
          if (!previousAreaKeysRef.current.has(key)) next.add(key);
        }
        for (const [lineId, key] of currentLineAreas) {
          if (previousLineAreasRef.current.get(lineId) !== key) next.delete(key);
        }
        return next.size === current.size && [...next].every((k) => current.has(k)) ? current : next;
      });
    }
    previousAreaKeysRef.current = currentAreaKeys;
    previousLineAreasRef.current = currentLineAreas;
  }, [editAreas, loading]);

  const withProduct = (i: (typeof topLevel)[number]) => ({ ...i, product: i.product_id ? (productImages as Record<string, any>)[i.product_id] : null });
  const quoteUnitCount = countAcUnits(topLevel.map(withProduct));

  const addJobLabour = async () => {
    if (!(labourRate && labourRate > 0)) { toast({ title: "Set a labour rate", description: "Set the standard labour rate in Billing first." }); return; }
    const hours = defaultLabourHours(quoteUnitCount, perUnitHours);
    const base = labourFields(hours, labourRate, false, true);
    const fields = { ...base, item_name: "Job labour", metadata: { ...base.metadata, labour_scope: "job" } };
    const existing = topLevel.find((i) => isJobLabour(i as any));
    if (existing) await updateItem(existing.id, fields as any);
    else await addItem({ ...fields, area_id: null, sort_order: Math.max(0, ...items.map((i) => i.sort_order || 0)) + 1, source: "labour" } as any);
    onChanged?.();
  };

  const switchLabourMode = async (next: "per_area" | "job") => {
    if (next === labourMode || modeBusy) return;
    if (!window.confirm(next === "job" ? "Move all labour hours to one job line?" : "Split job labour back into the areas?")) return;
    setModeBusy(true);
    try {
      const unitsByArea: Record<string, number> = {};
      for (const a of areas) unitsByArea[a.id] = countAcUnits(topLevel.filter((i) => i.area_id === a.id).map(withProduct));
      const { error } = await trackQuoteWrite<any>((supabase as any).rpc("set_quote_labour_mode", { p_quote_id: quoteId, p_mode: next, p_per_unit_hours: perUnitHours, p_area_units: unitsByArea }));
      if (error) throw error;
      await refetch();
      onChanged?.();
    } catch (e: any) {
      toast({ title: "Could not change labour mode", description: e.message, variant: "destructive" });
    } finally {
      setModeBusy(false);
    }
  };

  const addLabourForArea = async (rawAreaId: string) => {
    const areaId = labourTargetAreaId(labourMode, rawAreaId);
    if (!areaId) { await addJobLabour(); return; }
    if (!(labourRate && labourRate > 0)) { toast({ title: "Set a labour rate", description: "Set the standard labour rate in Billing first." }); return; }
    const areaItems = topLevel.filter((i) => i.area_id === areaId);
    const status = areaLabourStatus(areaItems.map((i) => ({ ...i, product: i.product_id ? (productImages as Record<string, any>)[i.product_id] : null })), perUnitHours);
    let hours = status.defaultHours;
    let auto = hours > 0;
    if (!hours) {
      const service = areaItems.find((i) => String(i.item_type).toLowerCase() === "service" || !!(i.metadata as any)?.catalog_service_id);
      const key = service ? serviceNormKey(service.item_name) : null;
      hours = key ? Number(labourNorms.find((norm) => norm.key === key)?.hours || 0) : 0;
      auto = false;
    }
    const existingZero = status.labourLines.find((line) => Number((line.metadata as any)?.hours ?? line.quantity) <= 0);
    if (existingZero) {
      if (hours > 0) await updateItem(existingZero.id!, labourFields(hours, labourRate, false, auto) as any);
      else document.querySelector<HTMLInputElement>(`[aria-label="Labour hours for ${CSS.escape(areas.find((area) => area.id === areaId)?.name || "")}"]`)?.focus();
      return;
    }
    const fields = labourFields(hours, labourRate, false, auto);
    await addItem({ ...fields, area_id: areaId, sort_order: Math.max(0, ...items.map((i) => i.sort_order || 0)) + 1, source: "labour" } as any);
    onChanged?.();
  };

  const changeLabour = async (id: string, hours: number, rate?: number) => {
    const line = items.find((i) => i.id === id);
    if (!line) return;
    const chosenRate = rate != null && rate > 0 ? rate : Number((line.metadata as any)?.rate ?? line.unit_price ?? labourRate);
    const plan = planLabour(line, hours, labourRate, chosenRate);
    if (!plan.fields) return;
    const job = isJobLabour(line as any);
    await updateItem(id, { ...plan.fields, ...(job ? { item_name: line.item_name || "Job labour" } : {}), metadata: { ...plan.fields.metadata, ...(job ? { labour_scope: "job" } : {}), labour_auto: false } } as any);
    onChanged?.();
  };

  const adjustAutoLabour = async (areaId: string | null, delta: number) => {
    if (!areaId || !labourRate) return;
    const target = labourTargetAreaId(labourMode, areaId);
    await applyAutoLabourDelta({ items, areaId: target, job: target === null, unitDelta: delta, perUnit: perUnitHours, rate: labourRate, addItem, updateItem });
  };

  const allowNewArea = () => {
    if (labourMode === "job") return true;
    const last = editAreas.filter((a) => a.id).at(-1);
    if (!last || !areaLabourStatus(topLevel.filter((i) => i.area_id === last.id), perUnitHours).missing) return true;
    toast({ title: `${last.name} has no labour yet. Add labour first.`, action: <ToastAction altText="Add labour" onClick={() => document.getElementById(`area-labour-${last.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}>Add labour</ToastAction> });
    return false;
  };


  const subtotal = useMemo(
    () => topLevel.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    [topLevel],
  );
  const discountType = meta?.discount_type ?? null;
  const discountValue = Number(meta?.discount_value ?? 0);
  const discount = discountAmountFor(subtotal, discountType, discountValue);
  const taxAmount = Math.round((subtotal - discount) * vatRate * 100) / 100;
  const total = Math.round((subtotal - discount) * (1 + vatRate) * 100) / 100;

  /** The DB trigger only recalcs on line changes, so push totals when the discount moves. */
  const applyDiscount = async (type: string | null, value: number) => {
    await updateQuote({ discount_type: type, discount_value: value } as any);
    const d = discountAmountFor(subtotal, type, value);
    await supabase
      .from("quotes")
      .update({
        subtotal,
        vat_amount: Math.round((subtotal - d) * vatRate * 100) / 100,
        total: Math.round((subtotal - d) * (1 + vatRate) * 100) / 100,
      })
      .eq("id", quoteId);
    onChanged?.();
  };

  const discountControl = (
    <div className="flex items-center gap-2 pt-1">
      <Select
        value={discountType ?? "none"}
        onValueChange={(v) => applyDiscount(v === "none" ? null : v, v === "none" ? 0 : discountValue)}
      >
        <SelectTrigger className="h-8 w-[130px] border-slate-200 bg-white text-[11px] text-slate-700">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No discount</SelectItem>
          <SelectItem value="percentage">Discount %</SelectItem>
          <SelectItem value="fixed">Discount R</SelectItem>
        </SelectContent>
      </Select>
      {discountType && (
        <Input
          type="number"
          step="0.01"
          min="0"
          key={`${discountType}-${discountValue}`}
          defaultValue={discountValue}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== discountValue) void applyDiscount(discountType, v);
          }}
          className="h-8 w-24 border-slate-200 bg-white text-right text-[11px] text-slate-700"
        />
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {builderEditor && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 print:hidden" data-pdf-hide data-html2canvas-ignore>
          {builderEditor.name} has this quote open in the builder. Their builder won't save over your changes.
        </div>
      )}
      <RemoveUnitDialog
        open={!!removeUnit}
        linkedCount={removeUnit?.linked.length ?? 0}
        onYes={() => { const r = removeUnit!; setRemoveUnit(null); deleteUnitLine(r.id, r.linked, true); }}
        onNo={() => { const r = removeUnit!; setRemoveUnit(null); deleteUnitLine(r.id, r.linked, false); }}
        onCancel={() => setRemoveUnit(null)}
      />
      <div className="flex items-center justify-end gap-2 print:hidden" data-pdf-hide data-html2canvas-ignore>
        {editAreas.some((area) => area.lines.length > 0) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={() => {
              const keysWithLines = editAreas.filter((area) => area.lines.length > 0).map((area) => area.id ?? "unassigned");
              const anyCollapsed = keysWithLines.some((key) => collapsedAreaKeys.has(key));
              setCollapsedAreaKeys(anyCollapsed ? new Set() : new Set(keysWithLines));
            }}
          >
            {editAreas.some((area) => area.lines.length > 0 && collapsedAreaKeys.has(area.id ?? "unassigned")) ? "Expand all" : "Collapse all"}
          </Button>
        )}
        <span className="text-xs text-muted-foreground">Labour</span>
        <Select value={labourMode} onValueChange={(v) => void switchLabourMode(v as "per_area" | "job")} disabled={modeBusy}>
          <SelectTrigger aria-label="Labour mode" className="h-8 w-[240px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="per_area">Labour per area</SelectItem>
            <SelectItem value="job">One time line for the whole job</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <EstimateDocument
        estimateNumber={quoteNumber}
        issueDate={issueDate}
        validUntil={validUntil}
        customerName={customerName}
        customerCompany={customerCompany}
        customerAddress={customerAddress}
        customerEmail={customerEmail}
        customerPhone={customerPhone}
        items={[]}
        subtotal={subtotal}
        taxRate={vatRate}
        taxAmount={taxAmount}
        grandTotal={total}
        discountAmount={discount}
        discountLabel={
          discountType === "fixed" ? null : discountType ? `${discountValue}%` : null
        }
        notes={notes}
        termsText={termsText}
        editing={{
          areas: editAreas,
          collapsedAreaKeys,
          onToggleArea: (key) => setCollapsedAreaKeys((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
          }),
          selectedLineId,
          onSelectLine: setSelectedLineId,
          onLineChange: (id, patch) => {
            const cur = items.find((i) => i.id === id);
            if (cur && isLabourItem(cur)) { void changeLabour(id, patch.quantity ?? Number(cur.quantity), patch.unit_price); return; }
            const display = cur ? lineFor(cur) : null;
            if (cur && display?.isAcUnit && patch.quantity != null) void adjustAutoLabour(cur.area_id, Number(patch.quantity) - Number(cur.quantity || 0));
            // Per-metre trunking: keep total_price = round(metres × length sell ÷ length, 2).
            if (cur && isMetreLine(cur as any) && (patch.quantity != null || patch.unit_price != null)) {
              const next = { ...cur, ...patch } as any;
              (patch as any).total_price = metreLineTotal(next, Number(next.quantity) || 0);
            }
            void updateItem(id, patch as any);
            onChanged?.();
          },
          bracketOptions: BRACKET_OPTIONS.filter((o) => liveProducts.some((p) => p.product_code === o.code)),
          onSwapBracket: (id, code) => {
            const cur = items.find((i) => i.id === id);
            const p = liveProducts.find((x) => x.product_code === code);
            if (!cur || !p) return;
            const qty = Number(cur.quantity) || 1;
            const { unitSell: _u, ...f } = catalogLineFields(p, qty);
            void updateItem(id, { ...f, metadata: { ...(cur.metadata || {}), ...f.metadata, install: (cur.metadata as any)?.install }, total_price: Number((qty * f.unit_price).toFixed(2)) } as any);
            onChanged?.();
          },
          kitOptions: kitPool.map((k) => ({ id: k.id, label: `${kitSizeLabel(k)} kit` })),
          onSwapKit: (id, bundleId) => {
            const cur = items.find((i) => i.id === id);
            const b = kitPool.find((k) => k.id === bundleId);
            if (!cur || !b) return;
            const before = { item_name: cur.item_name, item_number: cur.item_number, description: cur.description, length: cur.length, unit_price: cur.unit_price, total_price: cur.total_price, metadata: cur.metadata };
            const { perMetre: _p, ...patch } = kitSwapPatch(cur as any, b as any);
            void updateItem(id, patch as any);
            onChanged?.();
            toast({
              title: `Kit is now ${kitSizeLabel(b)}`,
              description: `${patch.length} m · ${formatRand(patch.unit_price)} excl. VAT`,
              action: <ToastAction altText="Undo kit swap" onClick={() => { void updateItem(id, before as any); onChanged?.(); }}>Undo</ToastAction>,
            });
          },
          onKitLengthChange: (id, metres) => {
            const cur = items.find((i) => i.id === id);
            if (!cur || !(metres > 0)) return;
            const before = { length: cur.length, unit_price: cur.unit_price, total_price: cur.total_price, metadata: cur.metadata };
            const patch = kitLengthPatch(cur as any, metres);
            void updateItem(id, patch as any);
            onChanged?.();
            toast({
              title: `Kit length ${patch.length} m · ${formatRand(patch.unit_price)} excl. VAT`,
              action: <ToastAction altText="Undo kit length" onClick={() => { void updateItem(id, before as any); onChanged?.(); }}>Undo</ToastAction>,
            });
          },
          onDeleteLine: (id) => {
            const cur = items.find((i) => i.id === id);
            const linked = cur && lineFor(cur).isAcUnit ? linkedToUnit(items, id, (x) => installTag(x)?.unit_item_id).map((x) => x.id) : [];
            if (linked.length) { setRemoveUnit({ id, linked }); return; }
            if (cur && lineFor(cur).isAcUnit) void adjustAutoLabour(cur.area_id, -Number(cur.quantity || 0));
            void deleteItem(id);
            if (selectedLineId === id) setSelectedLineId(null);
            onChanged?.();
          },
          onRenameArea: (id, name) => {
            void updateArea(id, { name });
            onChanged?.();
          },
          focusAreaId,
          onNameDefaultArea: async (name) => {
            const created = await addArea(name);
            if (created?.id) {
              // Move any orphan lines into the newly named area.
              for (const i of topLevel.filter((x) => !x.area_id)) {
                void updateItem(i.id, { area_id: created.id } as any);
              }
              setActiveAreaId(created.id);
              setFocusAreaId(null);
            }
            onChanged?.();
          },
          activeAreaId,
          onSelectArea: setActiveAreaId,
          onAddArea: async () => {
            if (!allowNewArea()) return;
            const created = await addArea(`Area ${areas.length + 1}`);
            if (created?.id) {
              setActiveAreaId(created.id);
              setFocusAreaId(created.id);
            }
          },

          onDeleteArea: async (id) => {
            const area = editAreas.find((a) => a.id === id);
            const count = items.filter((i) => i.area_id === id).length;
            const name = area?.name || "this area";
            const msg = count > 0
              ? `Delete ${name} and its ${count} line${count === 1 ? "" : "s"} (incl. labour)?`
              : `Delete ${name}?`;
            if (!window.confirm(msg)) return;
            if (activeAreaId === id) setActiveAreaId(null);
            const { error } = await trackQuoteWrite(supabase.from("quote_items").delete().eq("area_id", id).eq("quote_id", quoteId));
            if (error) { toast({ title: "Could not delete area lines", description: error.message, variant: "destructive" }); return; }
            await deleteArea(id);
            onChanged?.();
          },
          renderAreaAdd: (areaId) => {
            const key = areaId ?? "unassigned";
            const open = openAdd?.key === key ? openAdd.mode : null;
            if (open) {
              return (
                <QuoteQuickEditor
                  key={`${key}-${open}`}
                  mode={open}
                  targetAreaId={areaId ?? undefined}
                  createTargetArea={areaId ? undefined : async () => {
                    if (!allowNewArea()) return null;
                    const created = await addArea(`Area ${areas.length + 1}`);
                    if (!created?.id) return null;
                    setOpenAdd({ key: created.id, mode: open });
                    return created.id;
                  }}
                  onClose={() => setOpenAdd(null)}
                  onChanged={onChanged}
                  onAddedToArea={(id) => setActiveAreaId(id)}
                  onUnitAdded={(id, qty) => void adjustAutoLabour(id, qty)}
                />
              );
            }
            const btn = (mode: "unit" | "service" | "material", label: string) => (
              <Button key={mode} type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); setOpenAdd({ key, mode }); }}>
                <Plus className="mr-1 h-3 w-3" />{label}
              </Button>
            );
            return <div className="flex flex-wrap gap-2">{btn("unit", "Add unit")}{btn("service", "Add service")}{btn("material", "Add material")}{isPhone && (
              <Button key="favourites" type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={(e) => { e.stopPropagation(); setOpenAdd({ key, mode: "favourites" }); }}>★ Favourites</Button>
            )}</div>;
          },
          discountControl,
          onMoveLine: (id, areaId) => {
            // A unit carries its install lines with it.
            const source = items.find((i) => i.id === id);
            const kids = items.filter((x) => installTag(x)?.unit_item_id === id);
            for (const x of [source, ...kids]) if (x) void updateItem(x.id, { area_id: areaId } as any);
            if (labourMode !== "job" && source && lineFor(source).isAcUnit && source.area_id !== areaId) {
              void adjustAutoLabour(source.area_id, -Number(source.quantity || 0));
              void adjustAutoLabour(areaId, Number(source.quantity || 0));
            }
            onChanged?.();
          },
          onDuplicateLine: async (id, areaId) => {
            const src = items.find((i) => i.id === id);
            if (!src) return;
            const { id: _id, created_at: _c, updated_at: _u, quote_id: _q, ...rest } = src as any;
            const md = { ...(rest.metadata || {}) };
            delete md.install; // the copy is a stand-alone line, not linked to the original unit
            const maxSort = Math.max(0, ...items.filter((i) => i.area_id === areaId).map((i) => Number(i.sort_order) || 0));
            await addItem({ ...rest, metadata: md, area_id: areaId, sort_order: maxSort + 1 } as any);
            if (lineFor(src).isAcUnit) await adjustAutoLabour(areaId, Number(src.quantity || 0));
            onChanged?.();
          },
          onAddLabour: (areaId) => void addLabourForArea(areaId),
          onLabourChange: (id, hours, rate) => void changeLabour(id, hours, rate),
          unassignedLabour: unassignedLabourLines(topLevel, areas).map(lineFor),
          jobLabour: labourMode === "job"
            ? { lines: topLevel.filter((i) => isJobLabour(i as any)).map((i) => ({ ...lineFor(i), acUnitCount: quoteUnitCount })), defaultHours: defaultLabourHours(quoteUnitCount, perUnitHours), onAdd: () => void addJobLabour() }
            : undefined,

        }}
      />

      {margin.visible && (
        <div className="print:hidden" data-html2canvas-ignore>
          <PricingChecksRow settings={margin.settings} discount={discount} onApplyDiscount={applyDiscount} />
        </div>
      )}
      {margin.visible && (
        <StaffMarginCard items={topLevel} selectedId={selectedLineId} areas={areas} discount={discount} settings={margin.settings} quoteId={quoteId} splits={margin.splits} />
      )}
      {margin.visible && <SalespersonHistoryLine quoteId={quoteId} />}
    </div>
  );
}
