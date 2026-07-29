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
}

export type BundlePricingType = "p/meter" | "p/qty";

export function computeBundlePricing(items: BundleSubItem[]): {
  pricingType: BundlePricingType;
  unitPrice: number;
  unitCost: number;
} {
  const nonOptional = items.filter((i) => !i.isOptional);
  if (nonOptional.length === 0) return { pricingType: "p/qty", unitPrice: 0, unitCost: 0 };

  const allPerMeter = nonOptional.every(
    (i) => i.isLengthItem && i.product.price_per_metre && i.product.price_per_metre > 0
  );

  if (allPerMeter) {
    const totalSell = nonOptional.reduce((sum, i) => {
      const { unitSell } = getEffectiveUnitPrices(i.product, true);
      return sum + unitSell;
    }, 0);
    const totalCost = nonOptional.reduce((sum, i) => {
      const { unitCost } = getEffectiveUnitPrices(i.product, true);
      return sum + unitCost;
    }, 0);
    return { pricingType: "p/meter", unitPrice: totalSell, unitCost: totalCost };
  }

  // Mixed or all per-unit
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
  const nonOptional = items.filter((i) => !i.isOptional);

  const rows = nonOptional.map((item) => {
    const { unitCost, unitSell, isPackItem, packQty } = getEffectiveUnitPrices(item.product, item.isLengthItem);
    const pricingUnit = resolvePricingUnit(item.product);
    const qtyOrLen = item.isLengthItem ? (item.length || 1) : item.quantity;
    const markupAmt = unitSell - unitCost;
    const markupPct = unitCost > 0 ? (markupAmt / unitCost) * 100 : 0;
    const hasMarkup = markupAmt > 0.01;
    const lineTotal = computeLineTotal(qtyOrLen, unitSell, pricingUnit);
    const lineCost = computeLineTotal(qtyOrLen, unitCost, pricingUnit);
    const lineMarkup = lineTotal - lineCost;


    return {
      item,
      isLen: item.isLengthItem,
      costPerUnit: unitCost,
      sellPerUnit: unitSell,
      qtyOrLen,
      markupAmt,
      markupPct,
      hasMarkup,
      lineTotal,
      lineCost,
      lineMarkup,
      isPackItem,
      packQty,
    };
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
                  R{fmt(r.costPerUnit)}
                  <span className="text-[7px]">{r.isLen ? " /m" : " /ea"}</span>
                </td>
                <td className="text-right py-1 px-0.5 text-foreground font-medium whitespace-nowrap">
                  R{fmt(r.sellPerUnit)}
                </td>
                <td className="text-right py-1 px-0.5 whitespace-nowrap">
                  {r.hasMarkup ? (
                    <span className="text-green-600 dark:text-green-400">
                      R{fmt(r.markupAmt)}
                      <span className="text-[7px] ml-0.5">({r.markupPct.toFixed(0)}%)</span>
                    </span>
                  ) : (
                    <span className="text-orange-500 text-[8px]">No m/up</span>
                  )}
                </td>
                <td className="text-right py-1 px-0.5 text-muted-foreground">
                  <span className="flex items-center justify-end gap-0.5">
                    {r.isLen ? (
                      <><Ruler className="h-2 w-2" />{r.qtyOrLen}m</>
                    ) : (
                      <><Hash className="h-2 w-2" />×{r.qtyOrLen}</>
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
