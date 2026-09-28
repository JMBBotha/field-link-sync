/**
 * Pricing-check chips (staff only, never printed / captured). Non-blocking:
 * each chip offers one-tap fix with confirm + undo. Logic lives in lib/pricingChecks.ts.
 */
import { useMemo } from "react";
import { AlertTriangle, Package, Clock, Info } from "lucide-react";
import { useQuoteContext } from "@/contexts/QuoteContext";
import { useQuoteBuilderProducts } from "@/hooks/useQuoteBuilderProducts";
import { useQuoteBuilderBundles } from "@/hooks/useQuoteBuilderBundles";
import { useInstallTemplates } from "@/hooks/useInstallTemplates";
import { useLabourNorms } from "@/hooks/useLabourNorms";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { lineUnitCostOrNull } from "@/components/quoting/StaffMarginCard";
import { isLabourItem, findAreaLabour, planLabour, standardLabourRate } from "@/lib/labour";
import { installTag } from "@/lib/installTemplates";
import { isMetreLine, isAirConditioningProduct, planStandardInstall, addKitToQuote, catalogLineFields, baseItem } from "@/lib/mandy/quoteOps";
import { extractBtu } from "@/lib/bundles";
import { gpCheck, planPriceToTarget, missingMaterials, labourGaps, GROUP_LABEL, type CheckLine } from "@/lib/pricingChecks";
import type { MarginSettings } from "@/lib/margin";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { formatRand } from "@/utils/formatRand";

interface Props {
  settings: MarginSettings;
  discount: number;
  /** Discount writer that also refreshes quote totals (estimate page). */
  onApplyDiscount?: (type: string | null, value: number) => Promise<void> | void;
}

const chip = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]";

export default function PricingChecksRow({ settings, discount, onApplyDiscount }: Props) {
  const ctx = useQuoteContext();
  const { items, areas, meta, updateItem, addItem, deleteItem, updateQuote } = ctx;
  const { products } = useQuoteBuilderProducts();
  const { bundles } = useQuoteBuilderBundles();
  const { templates } = useInstallTemplates();
  const { data: norms = [] } = useLabourNorms();
  const { settings: co } = useCompanySettings() as any;
  const standardRate = standardLabourRate(co?.default_hourly_rate);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const top = useMemo(() => items.filter((i) => !i.parent_item_id), [items]);
  const lines: CheckLine[] = useMemo(() => top.map((i) => {
    const md = (i.metadata || {}) as any;
    const p = i.product_id ? byId.get(i.product_id) : undefined;
    const tag = installTag(i);
    const isUnit = !!p && !tag && !md.kit && isAirConditioningProduct(p);
    return {
      id: i.id, name: i.item_name, areaId: i.area_id ?? null,
      qty: Number(i.quantity || 0), unitPrice: Number(i.unit_price || 0),
      unitCost: lineUnitCostOrNull(i), isLabour: isLabourItem(i), isService: !!md.catalog_service_id,
      isUnit, btu: p ? extractBtu(p as any) : null,
      kindText: [i.item_name, p?.category, p?.product_category, (p as any)?.unit_type].filter(Boolean).join(" "),
      installRole: tag?.role ?? null, isKit: !!md.kit, kitMetres: i.length != null ? Number(i.length) : null,
      locked: isMetreLine(i as any) || !!md.price_locked || !!md.kit,
      labourHours: isLabourItem(i) ? Number(md.hours ?? i.quantity ?? 0) : undefined,
    };
  }), [top, byId]);

  const gp = gpCheck(lines, discount, settings);
  const missing = missingMaterials(lines, templates);
  const gaps = labourGaps(lines, norms);
  const areaName = (id: string | null) => areas.find((a) => a.id === id)?.name ?? "Items";
  if (!gp.belowTarget && !gp.notPriced && !missing.length && !gaps.length) return null;

  const priceToTarget = async () => {
    const plan = planPriceToTarget(lines, { type: meta?.discount_type ?? null, value: Number(meta?.discount_value ?? 0) }, gp);
    const setDiscount = (t: string | null, v: number) => (onApplyDiscount ? onApplyDiscount(t, v) : updateQuote({ discount_type: t, discount_value: v } as any));
    if (plan.kind === "clear_discount") {
      if (!window.confirm("Remove the job discount to lift GP?")) return;
      await setDiscount(null, 0);
      toast({ title: "Discount removed", action: <ToastAction altText="Undo" onClick={() => void setDiscount(plan.undo.discount_type, plan.undo.discount_value)}>Undo</ToastAction> });
    } else if (plan.kind === "scale") {
      if (!window.confirm(`Add ${formatRand(gp.uplift)} (ex VAT) across ${plan.patches.length} line${plan.patches.length === 1 ? "" : "s"} (×${plan.factor.toFixed(3)}) to reach ${gp.target}% GP?`)) return;
      for (const p of plan.patches) await updateItem(p.id, { unit_price: p.unit_price, total_price: p.total_price } as any);
      toast({ title: "Priced to target", action: <ToastAction altText="Undo" onClick={() => { for (const u of plan.undo) void updateItem(u.id, { unit_price: u.unit_price, total_price: u.total_price } as any); }}>Undo</ToastAction> });
    } else toast({ title: "Nothing to adjust", description: "No priced lines can be scaled." });
  };

  const addMissing = async (m: (typeof missing)[number]) => {
    const unit = items.find((i) => i.id === m.unitId);
    const p = unit?.product_id ? byId.get(unit.product_id) : undefined;
    if (!unit || !p) return;
    const plan = planStandardInstall(p, templates, bundles as any, products);
    const tag = (role: any) => ({ install: { unit_item_id: unit.id, role, template_id: plan.template?.id ?? null } });
    let sort = Math.max(0, ...items.map((i) => i.sort_order || 0)) + 1;
    const added: string[] = [];
    if (m.roles.includes("piping_kit") && plan.kitBundle) {
      const k = await addKitToQuote({ addItem, bundle: plan.kitBundle, areaId: unit.area_id ?? null, sortOrder: sort++, length: plan.kitLength, extraMeta: tag("piping_kit") });
      if (k.kit) added.push(k.kit.id);
    }
    for (const l of plan.lines.filter((x) => m.roles.includes(x.role))) {
      const { unitSell: _u, ...f } = catalogLineFields(l.product, l.qty);
      const row = await addItem({ ...baseItem(), ...f, metadata: { ...f.metadata, ...tag(l.role) }, area_id: unit.area_id ?? null, sort_order: sort++, source: "catalog" } as any);
      if (row) added.push(row.id);
    }
    if (!added.length) { toast({ title: "No standard item found", description: plan.notes.join(" · ") || "The install template has nothing for this." }); return; }
    toast({ title: `Added ${added.length} standard item${added.length === 1 ? "" : "s"}`, description: areaName(m.areaId), action: <ToastAction altText="Undo" onClick={() => { for (const id of added) void deleteItem(id); }}>Undo</ToastAction> });
  };

  const setLabour = async (g: (typeof gaps)[number]) => {
    if (!g.areaId) return;
    const line = findAreaLabour(items, g.areaId);
    const plan = planLabour(line, g.norm, standardRate);
    if (plan.needsRate || !plan.fields) { toast({ title: "Set a labour rate", description: "Set the standard rate in Settings first." }); return; }
    const before = line ? { ...line } : null;
    let createdId: string | null = null;
    if (line) await updateItem(line.id, plan.fields as any);
    else {
      const row = await addItem({ ...plan.fields, area_id: g.areaId, sort_order: Math.max(0, ...items.map((i) => i.sort_order || 0)) + 1, source: "labour" } as any);
      createdId = row?.id ?? null;
    }
    toast({
      title: `Labour set to ${g.norm} h`, description: areaName(g.areaId),
      action: <ToastAction altText="Undo" onClick={() => {
        if (before) void updateItem(before.id, { quantity: before.quantity, unit_price: before.unit_price, total_price: before.total_price, metadata: before.metadata } as any);
        else if (createdId) void deleteItem(createdId);
      }}>Undo</ToastAction>,
    });
  };

  return (
    <div data-testid="pricing-checks" data-html2canvas-ignore className="flex flex-wrap gap-1.5 print:hidden">
      {gp.belowTarget && (
        <span className={`${chip} border-amber-300 bg-amber-50 text-amber-800`}>
          <AlertTriangle className="h-3 w-3" /> GP {gp.gpPercent?.toFixed(1)}% below target {gp.target}%
          <button type="button" className="ml-1 font-semibold underline" onClick={() => void priceToTarget()}>Price to target</button>
        </span>
      )}
      {gp.notPriced > 0 && (
        <span className={`${chip} border-border text-muted-foreground`}><Info className="h-3 w-3" /> {gp.notPriced} line{gp.notPriced === 1 ? "" : "s"} not priced</span>
      )}
      {missing.map((m) => (
        <span key={`m-${m.areaId}`} className={`${chip} border-sky-300 bg-sky-50 text-sky-800`}>
          <Package className="h-3 w-3" /> {areaName(m.areaId)}: no {m.missing.map((g) => GROUP_LABEL[g]).join(", ")}
          <button type="button" className="ml-1 font-semibold underline" onClick={() => void addMissing(m)}>Add standard</button>
        </span>
      ))}
      {gaps.map((g) => (
        <span key={`l-${g.areaId}`} className={`${chip} border-violet-300 bg-violet-50 text-violet-800`} title={g.parts.join(" + ")}>
          <Clock className="h-3 w-3" /> {areaName(g.areaId)}: labour {g.hours}h below norm {g.norm}h
          {g.areaId && <button type="button" className="ml-1 font-semibold underline" onClick={() => void setLabour(g)}>Set {g.norm}h</button>}
        </span>
      ))}
    </div>
  );
}
