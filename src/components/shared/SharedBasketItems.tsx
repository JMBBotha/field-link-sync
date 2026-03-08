import { useState } from "react";
import { Plus, Trash2, Minus, Package, Ruler, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { getCategoryIcon, getCategoryBg } from "@/components/catalog/quote-builder/ProductPalette";
import { getProductDisplayName } from "@/components/catalog/quote-builder/productDisplayUtils";
import ProductInfoDialog from "@/components/shared/ProductInfoDialog";
import BundleItemsPopover from "@/components/catalog/quote-builder/BundleItemsPopover";
import type { BasketItem } from "@/components/catalog/QuoteBuilderTab";
import { getEffectiveUnitPrices } from "@/components/catalog/QuoteBuilderTab";

interface SharedBasketItemProps {
  item: BasketItem;
  isCompact?: boolean;
  onRemove: () => void;
  onUpdateQuantity: (qty: number) => void;
  onUpdateLength: (length: number) => void;
}

/** Collapsible bundle card — shared between admin and agent builders */
export function CollapsibleBundleCard({
  item,
  onRemove,
  onUpdateQuantity,
  onUpdateLength,
}: SharedBasketItemProps) {
  const [bundleExpanded, setBundleExpanded] = useState(false);
  const bundleUnitPx = item.bundleUnitPrice || 0;
  const isBundleLength = item.bundlePricingType === "p/meter";
  const multiplier = isBundleLength ? (item.length || 1) : item.quantity;
  const sliderMin = isBundleLength ? 0.5 : 1;
  const sliderMax = 50;
  const sliderStep = isBundleLength ? 0.5 : 1;
  const bundleDisplayPrice = multiplier * bundleUnitPx;

  const decrement = () =>
    isBundleLength
      ? onUpdateLength(Math.max(sliderMin, multiplier - sliderStep))
      : onUpdateQuantity(Math.max(sliderMin, multiplier - sliderStep));
  const increment = () =>
    isBundleLength
      ? onUpdateLength(Math.min(sliderMax, multiplier + sliderStep))
      : onUpdateQuantity(Math.min(sliderMax, multiplier + sliderStep));
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    if (!isNaN(v)) {
      const clamped = Math.max(sliderMin, Math.min(sliderMax, v));
      isBundleLength ? onUpdateLength(clamped) : onUpdateQuantity(clamped);
    }
  };

  return (
    <div className="rounded border bg-accent/30 dark:bg-accent/10 overflow-hidden">
      {/* Collapsed header row */}
      <div className="flex items-center gap-1.5 p-1.5 text-xs">
        <button
          className="shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
          onClick={() => setBundleExpanded(!bundleExpanded)}
          title={bundleExpanded ? "Collapse" : "Expand sub-items"}
        >
          {bundleExpanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>

        <div className="flex items-center gap-1 min-w-0 flex-1">
          <Package className="h-3 w-3 text-primary shrink-0" />
          {item.bundleItems && item.bundleName ? (
            <BundleItemsPopover bundleName={item.bundleName} items={item.bundleItems} side="top">
              <span className="font-medium truncate max-w-[100px] cursor-pointer hover:underline">
                {item.bundleName}
              </span>
            </BundleItemsPopover>
          ) : (
            <span className="font-medium truncate max-w-[100px]">{item.bundleName}</span>
          )}
          <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0">
            {item.bundleItems?.length || 0} items
          </Badge>
        </div>

        {/* Multiplier control */}
        <Button variant="outline" size="icon" className="h-5 w-5 shrink-0" onClick={decrement} disabled={multiplier <= sliderMin}>
          <Minus className="h-3 w-3" />
        </Button>
        <Input
          type="number" min={sliderMin} max={sliderMax} step={sliderStep} value={multiplier}
          onChange={handleInputChange}
          className="h-5 w-12 text-[10px] text-center px-0.5 shrink-0"
        />
        <Button variant="outline" size="icon" className="h-5 w-5 shrink-0" onClick={increment} disabled={multiplier >= sliderMax}>
          <Plus className="h-3 w-3" />
        </Button>
        <span className="text-[9px] text-muted-foreground shrink-0">{isBundleLength ? "m" : "×"}</span>

        <span className="font-semibold text-xs whitespace-nowrap shrink-0 ml-auto">
          R{bundleDisplayPrice.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
        </span>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-destructive/60 hover:text-destructive" onClick={onRemove}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded sub-items (read-only) */}
      {bundleExpanded && item.bundleItems && item.bundleItems.length > 0 && (
        <div className="border-t border-border/50 bg-muted/30 px-3 py-1.5 space-y-0.5">
          {item.bundleItems.map((sub, idx) => {
            const subQty = sub.isLengthItem
              ? (sub.length || 1) * multiplier
              : sub.quantity * multiplier;
            const subPrice = sub.isLengthItem
              ? (sub.product.price_per_metre || 0) * subQty
              : (sub.product.selling_price || (sub.product as any).discounted_cost || sub.product.cost_excl_vat || 0) * subQty;
            return (
              <div key={idx} className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span className="truncate flex-1 min-w-0 pl-4">
                  {getProductDisplayName(sub.product)}
                </span>
                <span className="shrink-0 tabular-nums">
                  {sub.isLengthItem ? `${subQty.toFixed(1)}m` : `×${subQty}`}
                </span>
                <span className="shrink-0 w-14 text-right tabular-nums">
                  R{subPrice.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Regular product item card — shared between admin and agent builders */
export function RegularItemCard({
  item,
  isCompact,
  onRemove,
  onUpdateQuantity,
  onUpdateLength,
}: SharedBasketItemProps) {
  const isLengthItem = item.product.sold_in_length && !!item.product.price_per_metre;
  const [markupAdj, setMarkupAdj] = useState(0);
  const baseMarkup = (item.product as any).markup_percent ?? 20;
  const effectiveMarkup = baseMarkup + markupAdj;

  const { unitSell: rawUnitSell, isPackItem, packQty } = getEffectiveUnitPrices(item.product);
  // Apply markup adjustment
  const markupMultiplier = markupAdj !== 0 ? (1 + effectiveMarkup / 100) / (1 + baseMarkup / 100) : 1;
  const unitSell = rawUnitSell * markupMultiplier;

  const price = isLengthItem
    ? (item.product.price_per_metre || 0) * markupMultiplier * (item.length || 1)
    : unitSell * item.quantity;
  const displayPrice = item.isBundle
    ? item.bundlePricingType === "p/meter"
      ? (item.bundleUnitPrice || 0) * (item.length || 1)
      : (item.bundleUnitPrice || 0) * item.quantity
    : price;

  if (isCompact) {
    return (
      <div className="flex items-center gap-1 rounded border bg-background px-1 py-0.5 text-[10px]">
        <div className="min-w-0 flex-1 truncate font-medium flex items-center gap-0.5">
          <span className="truncate">{getProductDisplayName(item.product)}</span>
          <ProductInfoDialog product={item.product} />
        </div>
        {isLengthItem ? (
          <div className="flex items-center gap-0.5 shrink-0">
            <Input type="number" min={0.1} step={0.5} value={item.length || 1}
              onChange={(e) => onUpdateLength(parseFloat(e.target.value) || 0.1)}
              className="h-4 w-10 text-[10px] text-center px-0.5" />
            <span className="text-[8px] text-muted-foreground">m</span>
          </div>
        ) : (
          <div className="flex items-center gap-0 shrink-0">
            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => onUpdateQuantity(item.quantity - 1)} disabled={item.quantity <= 1}>
              <Minus className="h-2 w-2" />
            </Button>
            <span className="w-4 text-center font-semibold">{item.quantity}</span>
            <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => onUpdateQuantity(item.quantity + 1)}>
              <Plus className="h-2 w-2" />
            </Button>
          </div>
        )}
        {/* Markup quick-adjust */}
        <div className="flex items-center gap-0.5 shrink-0" data-no-dnd="true">
          <button
            className="h-3.5 px-1 rounded-full bg-muted text-[8px] font-medium text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
            onClick={() => setMarkupAdj(prev => prev - 5)}
            onPointerDown={(e) => e.stopPropagation()}
          >-5</button>
          <span className="text-[8px] font-semibold text-foreground w-6 text-center">{effectiveMarkup}%</span>
          <button
            className="h-3.5 px-1 rounded-full bg-muted text-[8px] font-medium text-muted-foreground hover:bg-green-500/20 hover:text-green-600 transition-colors"
            onClick={() => setMarkupAdj(prev => prev + 5)}
            onPointerDown={(e) => e.stopPropagation()}
          >+5</button>
        </div>
        <span className="font-bold w-12 text-right shrink-0">
          R{displayPrice.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
        </span>
        <Button variant="ghost" size="icon" className="h-4 w-4 text-destructive/60 hover:text-destructive shrink-0" onClick={onRemove}>
          <Trash2 className="h-2 w-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-background p-1.5 text-xs">
      <div className={`shrink-0 rounded p-1 ${getCategoryBg(item.product.product_category)}`}>
        {getCategoryIcon(item.product.product_category, "h-3 w-3")}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate flex items-center gap-1">
          <span className="truncate">{getProductDisplayName(item.product)}</span>
          <ProductInfoDialog product={item.product} />
        </p>
        <div className="flex items-center gap-1.5">
          <p className="text-[10px] font-mono font-medium text-primary/80 truncate">
            {item.product.product_code}
          </p>
          {isLengthItem && (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 gap-0.5 border-orange-400/40 text-orange-600">
              <Ruler className="h-2 w-2" />
              R{(item.product.price_per_metre || 0).toFixed(2)}/m
            </Badge>
          )}
          {!isLengthItem && isPackItem && (
            <Badge variant="outline" className="text-[7px] px-0.5 py-0 h-3 border-muted-foreground/40 text-muted-foreground">
              pk/{packQty} · R{unitSell.toFixed(2)}/ea
            </Badge>
          )}
        </div>
      </div>
      {isLengthItem ? (
        <div className="flex items-center gap-1 shrink-0">
          <Input type="number" min={0.1} step={0.5} value={item.length || 1}
            onChange={(e) => onUpdateLength(parseFloat(e.target.value) || 0.1)}
            className="h-6 w-14 text-xs text-center px-1" />
          <span className="text-[10px] text-muted-foreground">m</span>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => onUpdateQuantity(item.quantity - 1)} disabled={item.quantity <= 1}>
            <Minus className="h-2.5 w-2.5" />
          </Button>
          <span className="w-6 text-center font-semibold text-xs">{item.quantity}</span>
          <Button variant="outline" size="icon" className="h-5 w-5" onClick={() => onUpdateQuantity(item.quantity + 1)}>
            <Plus className="h-2.5 w-2.5" />
          </Button>
        </div>
      )}
      {/* Markup quick-adjust pills */}
      <div className="flex items-center gap-0.5 shrink-0" data-no-dnd="true">
        <button
          className="h-5 px-1.5 rounded-full bg-muted text-[9px] font-semibold text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
          onClick={() => setMarkupAdj(prev => prev - 5)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Decrease markup 5%"
        >-5%</button>
        <span className="text-[10px] font-bold text-foreground w-8 text-center tabular-nums">{effectiveMarkup}%</span>
        <button
          className="h-5 px-1.5 rounded-full bg-muted text-[9px] font-semibold text-muted-foreground hover:bg-green-500/20 hover:text-green-600 transition-colors"
          onClick={() => setMarkupAdj(prev => prev + 5)}
          onPointerDown={(e) => e.stopPropagation()}
          title="Increase markup 5%"
        >+5%</button>
      </div>
      <span className="text-xs font-bold w-16 text-right shrink-0">
        R{displayPrice.toLocaleString("en-ZA")}
      </span>
      <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive/60 hover:text-destructive shrink-0" onClick={onRemove}>
        <Trash2 className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

/** Unified basket item renderer — delegates to bundle or regular card */
export function SharedBasketItemCard(props: SharedBasketItemProps) {
  if (props.item.isBundle) {
    return <CollapsibleBundleCard {...props} />;
  }
  return <RegularItemCard {...props} />;
}
