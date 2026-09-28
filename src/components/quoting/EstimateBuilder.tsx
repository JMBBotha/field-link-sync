/**
 * EstimateBuilder — the single quote surface on /admin/estimates/:id.
 *
 * The estimate document IS the editor: areas are section headers, lines are
 * editable in place, and everything writes into the already-open quoteId via
 * QuoteContext (quote_items / quote_areas). Cost, markup and profit live in a
 * separate staff card outside the pdf capture root.
 */
import { isLabourItem } from "@/lib/labour";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuoteContext } from "@/contexts/QuoteContext";
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
import PricingChecksRow from "@/components/quoting/PricingChecksRow";
import { useMarginView } from "@/hooks/useMarginView";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useLabourNorms } from "@/hooks/useLabourNorms";
import { serviceNormKey } from "@/lib/pricingChecks";
import { applyAutoLabourDelta, areaLabourStatus, countAcUnits } from "@/lib/areaLabour";
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
    quoteId, meta, areas, items,
    addArea, updateArea, deleteArea, updateItem, deleteItem, updateQuote, addItem,
  } = useQuoteContext();
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



  const topLevel = useMemo(() => items.filter((i) => !i.parent_item_id), [items]);

  // Catalog product images for the sales-card thumb on each line.
  const productIds = useMemo(
    () => [...new Set(topLevel.map((i) => i.product_id).filter(Boolean))] as string[],
    [topLevel],
  );
  const { data: productImages = {} } = useQuery({
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

  const addLabourForArea = async (areaId: string) => {
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
    await updateItem(id, { ...plan.fields, metadata: { ...plan.fields.metadata, labour_auto: false } } as any);
    onChanged?.();
  };

  const adjustAutoLabour = async (areaId: string | null, delta: number) => {
    if (!areaId || !labourRate) return;
    await applyAutoLabourDelta({ items, areaId, unitDelta: delta, perUnit: perUnitHours, rate: labourRate, addItem, updateItem });
  };

  const allowNewArea = () => {
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

          onDeleteArea: (id) => {
            const area = editAreas.find((a) => a.id === id);
            const lineCount = area?.lines.length ?? 0;
            const msg = lineCount > 0
              ? `Delete this area and its ${lineCount} line${lineCount === 1 ? "" : "s"}?`
              : "Delete this area?";
            if (!window.confirm(msg)) return;
            for (const line of area?.lines ?? []) void deleteItem(line.id);
            void deleteArea(id);
            if (activeAreaId === id) setActiveAreaId(null);
            onChanged?.();
          },
          addBar: (
            <QuoteQuickEditor
              onChanged={onChanged}
              dropUp
              onAddedToArea={(areaId) => {
                setActiveAreaId(areaId);
                window.setTimeout(() => {
                  const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(areaId) : areaId.replace(/["\\]/g, "\\$&");
                  document.querySelector(`[data-area-id="${escaped}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 0);
              }}
              onUnitAdded={(areaId, qty) => void adjustAutoLabour(areaId, qty)}
              beforeCreateArea={allowNewArea}
            />
          ),
          discountControl,
          onMoveLine: (id, areaId) => {
            // A unit carries its install lines with it.
            const source = items.find((i) => i.id === id);
            const kids = items.filter((x) => installTag(x)?.unit_item_id === id);
            for (const x of [source, ...kids]) if (x) void updateItem(x.id, { area_id: areaId } as any);
            if (source && lineFor(source).isAcUnit && source.area_id !== areaId) {
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
          unassignedLabour: topLevel.filter((i) => isLabourItem(i) && (!i.area_id || !areas.some((a) => a.id === i.area_id))).map(lineFor),

        }}
      />

      {margin.visible && (
        <div className="print:hidden" data-html2canvas-ignore>
          <PricingChecksRow settings={margin.settings} discount={discount} onApplyDiscount={applyDiscount} />
        </div>
      )}
      {margin.visible && (
        <StaffMarginCard items={topLevel} selectedId={selectedLineId} areas={areas} discount={discount} settings={margin.settings} quoteId={quoteId} />
      )}
    </div>
  );
}
