import { useState } from "react";
import { Package, Ruler, Hash } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getProductDisplayName } from "./productDisplayUtils";
import type { PaletteProduct } from "../QuoteBuilderTab";
import { determinePricingMode } from "./pricingModeUtils";

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
} {
  const nonOptional = items.filter((i) => !i.isOptional);
  if (nonOptional.length === 0) return { pricingType: "p/qty", unitPrice: 0 };

  const allPerMeter = nonOptional.every(
    (i) => i.isLengthItem && i.product.price_per_metre && i.product.price_per_metre > 0
  );
  const allPerUnit = nonOptional.every(
    (i) => !i.isLengthItem || !i.product.price_per_metre
  );

  if (allPerMeter) {
    // Sum of all per-meter prices
    const total = nonOptional.reduce(
      (sum, i) => sum + (i.product.price_per_metre || 0),
      0
    );
    return { pricingType: "p/meter", unitPrice: total };
  }

  // Mixed or all per-unit: calculate total based on quantities/lengths
  const total = nonOptional.reduce((sum, i) => {
    if (i.isLengthItem && i.product.price_per_metre) {
      return sum + i.product.price_per_metre * (i.length || 1);
    }
    const price = i.product.selling_price || i.product.cost_incl_vat || 0;
    return sum + price * i.quantity;
  }, 0);

  return { pricingType: "p/qty", unitPrice: total };
}

function PopoverBody({
  bundleName,
  items,
  pricingType,
  totalPrice,
}: {
  bundleName: string;
  items: BundleSubItem[];
  pricingType: BundlePricingType;
  totalPrice: number;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Package className="h-3.5 w-3.5 text-primary shrink-0" />
        <p className="font-semibold text-xs">{bundleName}</p>
        <Badge
          variant="outline"
          className="text-[8px] px-1 py-0 h-3.5 ml-auto shrink-0"
        >
          {pricingType}
        </Badge>
      </div>
      <div className="space-y-1 border-t pt-1.5">
        {items.map((item, idx) => {
          const isLen =
            item.isLengthItem && item.product.price_per_metre;
          const itemPrice = isLen
            ? (item.product.price_per_metre || 0) * (item.length || 1)
            : (item.product.selling_price ||
                item.product.cost_incl_vat ||
                0) * item.quantity;

          return (
            <div key={idx} className="flex items-center justify-between gap-2 text-[10px]">
              <div className="min-w-0 flex-1">
                <span className="truncate block text-foreground">
                  {getProductDisplayName(item.product)}
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {item.product.product_code}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground">
                {isLen ? (
                  <span className="flex items-center gap-0.5">
                    <Ruler className="h-2 w-2" />
                    {item.length || 1}m
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5">
                    <Hash className="h-2 w-2" />
                    ×{item.quantity}
                  </span>
                )}
                <Badge
                  variant="outline"
                  className="text-[7px] px-0.5 py-0 h-3 border-muted-foreground/30"
                >
                  {isLen ? "p/m" : "p/qty"}
                </Badge>
              </div>
              <span className="font-medium text-foreground shrink-0 w-14 text-right">
                R{itemPrice.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between border-t pt-1.5 text-xs font-bold text-foreground">
        <span>Total</span>
        <span>R{totalPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</span>
      </div>
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
  const { pricingType, unitPrice } = computeBundlePricing(items);

  // Calculate actual total for display
  const total = items
    .filter((i) => !i.isOptional)
    .reduce((sum, i) => {
      if (i.isLengthItem && i.product.price_per_metre) {
        return sum + (i.product.price_per_metre) * (i.length || 1);
      }
      const price = i.product.selling_price || i.product.cost_incl_vat || 0;
      return sum + price * i.quantity;
    }, 0);

  const body = (
    <PopoverBody
      bundleName={bundleName}
      items={items}
      pricingType={pricingType}
      totalPrice={total}
    />
  );

  // Mobile: use Popover (tap to open), Desktop: use HoverCard
  if (isMobile) {
    return (
      <Popover>
        <PopoverTrigger asChild>{children}</PopoverTrigger>
        <PopoverContent side={side} className="w-72 text-xs">
          {body}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard openDelay={300} closeDelay={150}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} className="w-72 text-xs">
        {body}
      </HoverCardContent>
    </HoverCard>
  );
}
