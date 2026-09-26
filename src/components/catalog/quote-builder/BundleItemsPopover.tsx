import { useState } from "react";
import { Package, Ruler, Hash, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { getProductDisplayName } from "./productDisplayUtils";
import type { PaletteProduct } from "../QuoteBuilderTab";
import { getEffectiveUnitPrices } from "../QuoteBuilderTab";
import { computeLineTotal, resolvePricingUnit } from "@/lib/pricingUnits";


export interface BundleSubItem {
  product: PaletteProduct;
  quantity: number;
  length?: number;
  isLengthItem: boolean;
  isOptional?: boolean;
  /** Metres (or qty) of this part per 1 m of kit — bundle_items.length_metres. Default 1. */
  perKitMetre?: number;
}

export type BundlePricingType = "p/meter" | "p/qty";

/**
 * How many pieces the catalog price covers, for kit pricing only.
 * pack_qty > 1 is already divided out by getEffectiveUnitPrices → 1.
 * Otherwise a 'pack'/'box' priced per N (price_per_unit_qty > 1) → N.
 */
export function packUnits(p: any): number {
  if (!p) return 1;
  if (Number(p.pack_qty) > 1) return 1;
  const per = Number(p.price_per_unit_qty);
  return (p.unit_type === "pack" || p.unit_type === "box") && per > 1 ? per : 1;
}

/** Per-piece cost/sell for a count item inside a kit (standalone lines unaffected). */
export function bundlePieceUnitPrices(p: PaletteProduct) {
  const r = getEffectiveUnitPrices(p, false);
  const n = packUnits(p);
  return { ...r, unitSell: r.unitSell / n, unitCost: r.unitCost / n, piecePack: n };
}

const isLen = (i: BundleSubItem) => i.isLengthItem && !!i.product.price_per_metre && i.product.price_per_metre > 0;

/** True when the kit is priced per kit metre (has at least one non-optional length item). */
export function isPerMetreKit(items: BundleSubItem[]): boolean {
  return items.some((i) => !i.isOptional && isLen(i));
}

/** Per-kit-metre unit prices for one part (length → per metre, count → per piece). */
export function kitPartUnitPrices(i: BundleSubItem) {
  if (isLen(i)) { const r = getEffectiveUnitPrices(i.product, true); return { ...r, piecePack: 1 }; }
  return bundlePieceUnitPrices(i.product);
}

/** Map bundle_items rows to sub-items; count parts of a per-metre kit get qty = perKitMetre × kitLength. */
export function toBundleSubItems(
  rows: Array<{ quantity?: number | null; length_metres?: number | null; is_length_item?: boolean | null; is_optional?: boolean | null; product?: any; supplier_product?: any }>,
  kitLength = 3,
  lengthFallback?: (row: any, product: PaletteProduct) => number,
): BundleSubItem[] {
  const subs: BundleSubItem[] = (rows || [])
    .filter((b) => b.product || b.supplier_product)
    .map((b) => {
      const product = (b.product || b.supplier_product) as PaletteProduct;
      const isLengthItem = !!b.is_length_item && !!product.price_per_metre;
      return {
        product,
        quantity: b.quantity || 1,
        isLengthItem,
        isOptional: !!b.is_optional,
        perKitMetre: b.length_metres ?? b.quantity ?? 1,
        ...(isLengthItem ? { length: lengthFallback ? lengthFallback(b, product) : (b.length_metres || 1) } : {}),
      };
    });
  if (isPerMetreKit(subs)) {
    for (const s of subs) if (!s.isLengthItem) s.quantity = Math.round((s.perKitMetre ?? 1) * kitLength * 1000) / 1000;
  }
  return subs;
}

/** Rescale count sub-items of a per-metre kit to a new kit length. */
export function scaleKitCountItems<T extends BundleSubItem>(items: T[], kitLength: number): T[] {
  return items.map((s) => (s.isLengthItem ? s : { ...s, quantity: Math.round((s.perKitMetre ?? 1) * kitLength * 1000) / 1000 }));
}

export function computeBundlePricing(items: BundleSubItem[]): {
  pricingType: BundlePricingType;
  unitPrice: number;
  unitCost: number;
} {
  const nonOptional = items.filter((i) => !i.isOptional);
  if (nonOptional.length === 0) return { pricingType: "p/qty", unitPrice: 0, unitCost: 0 };

  if (isPerMetreKit(nonOptional)) {
    let totalSell = 0, totalCost = 0;
    for (const i of nonOptional) {
      const { unitSell, unitCost } = kitPartUnitPrices(i);
      const k = i.perKitMetre ?? 1;
      totalSell += unitSell * k;
      totalCost += unitCost * k;
    }
    return { pricingType: "p/meter", unitPrice: totalSell, unitCost: totalCost };
  }

  // No length items — per-unit
  const totalSell = nonOptional.reduce((sum, i) => {
    const { unitSell } = getEffectiveUnitPrices(i.product, i.isLengthItem);
    const unit = resolvePricingUnit(i.product);
    const qty = i.isLengthItem ? (i.length || 1) : i.quantity;
    return sum + computeLineTotal(qty, unitSell, unit);
  }, 0);

  const totalCost = nonOptional.reduce((sum, i) => {
    const { unitCost } = getEffectiveUnitPrices(i.product, i.isLengthItem);
    const unit = resolvePricingUnit(i.product);
    const qty = i.isLengthItem ? (i.length || 1) : i.quantity;
    return sum + computeLineTotal(qty, unitCost, unit);
  }, 0);

  return { pricingType: "p/qty", unitPrice: totalSell, unitCost: totalCost };
}

/** Popover row numbers — same maths as computeBundlePricing. */
export function bundlePopoverRows(items: BundleSubItem[], pricingType: BundlePricingType) {
  return items.filter((i) => !i.isOptional).map((item) => {
    if (pricingType === "p/meter") {
      const { unitCost, unitSell, isPackItem, packQty, piecePack } = kitPartUnitPrices(item);
      const qtyOrLen = item.perKitMetre ?? 1;
      const lineTotal = unitSell * qtyOrLen;
      const lineCost = unitCost * qtyOrLen;
      return { item, isLen: isLen(item), costPerUnit: unitCost, sellPerUnit: unitSell, qtyOrLen, lineTotal, lineCost,
        isPackItem: isPackItem || piecePack > 1, packQty: piecePack > 1 ? piecePack : packQty };
    }
    const { unitCost, unitSell, isPackItem, packQty } = getEffectiveUnitPrices(item.product, item.isLengthItem);
    const pricingUnit = resolvePricingUnit(item.product);
    const qtyOrLen = item.isLengthItem ? (item.length || 1) : item.quantity;
    return { item, isLen: item.isLengthItem, costPerUnit: unitCost, sellPerUnit: unitSell, qtyOrLen,
      lineTotal: computeLineTotal(qtyOrLen, unitSell, pricingUnit), lineCost: computeLineTotal(qtyOrLen, unitCost, pricingUnit), isPackItem, packQty };
  });
}

const fmtU = (v: number) => (Math.abs(v) < 10 && Math.round(v * 100) !== v * 100 ? v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : fmt(v));
const fmt = (v: number) => v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function PopoverBody({
  bundleName,
  items,
  pricingType,
}: {
  bundleName: string;
  items: BundleSubItem[];
  pricingType: BundlePricingType;
}) {
  const rows = bundlePopoverRows(items, pricingType).map((r) => {
    const markupAmt = r.sellPerUnit - r.costPerUnit;
    return { ...r, markupAmt, markupPct: r.costPerUnit > 0 ? (markupAmt / r.costPerUnit) * 100 : 0,
      hasMarkup: markupAmt > 0.0001, lineMarkup: r.lineTotal - r.lineCost };
  });

  const totalCost = rows.reduce((s, r) => s + r.lineCost, 0);
  const totalMarkup = rows.reduce((s, r) => s + r.lineMarkup, 0);
  const totalSell = rows.reduce((s, r) => s + r.lineTotal, 0);
  const overallMarkupPct = totalCost > 0 ? (totalMarkup / totalCost) * 100 : 0;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="font-semibold text-xs">{bundleName}</p>
        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 ml-auto shrink-0">
          {pricingType}
        </Badge>
      </div>

      <ScrollArea className="max-h-[300px]">
        <table className="w-full text-[9px] border-collapse">
          <thead>
            <tr className="border-b text-muted-foreground">
              <th className="text-left py-1 pr-1 font-medium">Item</th>
              <th className="text-right py-1 px-0.5 font-medium">Cost p/item</th>
              <th className="text-right py-1 px-0.5 font-medium">Sell</th>
              <th className="text-right py-1 px-0.5 font-medium">M/up</th>
              <th className="text-right py-1 px-0.5 font-medium">Qty/Len</th>
              <th className="text-right py-1 pl-0.5 font-medium">Line Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} className="border-b border-border/30">
                <td className="py-1 pr-1 max-w-[110px]">
                  <span className="truncate block text-foreground leading-tight">
                    {getProductDisplayName(r.item.product)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[8px] text-muted-foreground">
                      {r.item.product.product_code}
                    </span>
                    {r.isPackItem && (
                      <Badge variant="outline" className="text-[6px] px-0.5 py-0 h-3 border-muted-foreground/40 text-muted-foreground">
                        pk/{r.packQty}
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="text-right py-1 px-0.5 text-muted-foreground whitespace-nowrap">
                  R{fmtU(r.costPerUnit)}
                  <span className="text-[7px]">{r.isLen ? " /m" : " /ea"}</span>
                </td>
                <td className="text-right py-1 px-0.5 text-foreground font-medium whitespace-nowrap">
                  R{fmtU(r.sellPerUnit)}
                </td>
                <td className="text-right py-1 px-0.5 whitespace-nowrap">
                  {r.hasMarkup ? (
                    <span className="text-green-600 dark:text-green-400">
                      R{fmtU(r.markupAmt)}
                      <span className="text-[7px] ml-0.5">({r.markupPct.toFixed(0)}%)</span>
                    </span>
                  ) : (
                    <span className="text-orange-500 text-[8px]">No m/up</span>
                  )}
                </td>
                <td className="text-right py-1 px-0.5 text-muted-foreground">
                  <span className="flex items-center justify-end gap-0.5">
                    {r.isLen ? (
                      <><Ruler className="h-2 w-2" />{+r.qtyOrLen.toFixed(3)}m</>
                    ) : (
                      <><Hash className="h-2 w-2" />×{+r.qtyOrLen.toFixed(3)}{pricingType === "p/meter" ? "/m" : ""}</>
                    )}
                  </span>
                </td>
                <td className="text-right py-1 pl-0.5 text-foreground font-medium whitespace-nowrap">
                  R{fmt(r.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-bold text-[10px]">
              <td className="py-1.5 text-foreground">Totals</td>
              <td className="text-right py-1.5 px-0.5 text-muted-foreground">
                R{fmt(totalCost)}
              </td>
              <td className="text-right py-1.5 px-0.5 text-foreground">
                R{fmt(totalSell)}
              </td>
              <td className="text-right py-1.5 px-0.5 text-green-600 dark:text-green-400">
                R{fmt(totalMarkup)}
                <span className="text-[7px] ml-0.5">({overallMarkupPct.toFixed(0)}%)</span>
              </td>
              <td></td>
              <td className="text-right py-1.5 pl-0.5 text-foreground">
                R{fmt(totalSell)}
              </td>
            </tr>
          </tfoot>
        </table>
      </ScrollArea>
    </div>
  );
}

interface BundleItemsPopoverProps {
  bundleName: string;
  items: BundleSubItem[];
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

export default function BundleItemsPopover({
  bundleName,
  items,
  children,
  side = "right",
}: BundleItemsPopoverProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { pricingType } = computeBundlePricing(items);

  const body = (
    <PopoverBody
      bundleName={bundleName}
      items={items}
      pricingType={pricingType}
    />
  );

  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent side={side} className="w-[380px] max-w-[95vw] text-xs p-3">
          <div className="flex justify-end mb-1">
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setOpen(false)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} className="w-[420px] max-w-[95vw] text-xs p-3">
        {body}
      </HoverCardContent>
    </HoverCard>
  );
}
