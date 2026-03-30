import { useMemo } from "react";
import { Package, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BasketItem } from "../QuoteBuilderTab";
import { extractBtu, findMatchingBundle } from "@/lib/bundles";
import { computeProductPricing } from "@/lib/pricing";

interface BundleSectionProps {
  basketItems: BasketItem[];
  dbBundles: Array<{ id: string; name: string; min_btu?: number | null; max_btu?: number | null; items: any[] }>;
  onRemoveBundle: (instanceId: string) => void;
  onSwapBundle: (instanceId: string, newBundle: any) => void;
}

/**
 * Shows auto-attached bundles in a zone, with remove/swap controls.
 * Replaces the old ConsumablesSuggestionPanel.
 */
const ZoneBundleSection = ({ basketItems, dbBundles, onRemoveBundle, onSwapBundle }: BundleSectionProps) => {
  const bundleItems = basketItems.filter((i) => i.isBundle);
  const acItems = basketItems.filter((i) => i.product.product_category === "Air Conditioning" && !i.isBundle);

  // Check if there are AC units without a matching bundle
  const missingBundles = useMemo(() => {
    const missing: Array<{ product: BasketItem; suggestedBundle: any }> = [];
    for (const ac of acItems) {
      const btu = extractBtu(ac.product);
      if (!btu) continue;
      const match = findMatchingBundle(btu, dbBundles);
      if (match && !bundleItems.some((b) => b.bundleId === match.id)) {
        missing.push({ product: ac, suggestedBundle: match });
      }
    }
    return missing;
  }, [acItems, bundleItems, dbBundles]);

  if (bundleItems.length === 0 && missingBundles.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-2 mt-1.5">
      <p className="text-[10px] font-semibold text-primary flex items-center gap-1 mb-1.5">
        <Package className="h-3 w-3" />
        Piping Kits
      </p>

      {/* Active bundles */}
      {bundleItems.map((item) => {
        const price = item.bundleUnitPrice || 0;
        return (
          <div key={item.instanceId} className="flex items-center justify-between gap-1 py-0.5">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                Bundle
              </Badge>
              <span className="text-[10px] font-medium truncate">{item.bundleName || "Piping Kit"}</span>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {price > 0 && (
                <span className="text-[9px] text-muted-foreground">
                  R{price.toLocaleString("en-ZA", { minimumFractionDigits: 0 })}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 text-destructive/60 hover:text-destructive"
                onClick={() => onRemoveBundle(item.instanceId)}
              >
                <X className="h-2.5 w-2.5" />
              </Button>
            </div>
          </div>
        );
      })}

      {/* Missing bundle suggestions */}
      {missingBundles.map(({ product, suggestedBundle }) => (
        <div key={`missing-${product.instanceId}`} className="flex items-center gap-1 py-0.5 opacity-70">
          <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-amber-400/40 text-amber-600">
            Missing
          </Badge>
          <span className="text-[9px] truncate flex-1">{suggestedBundle.name}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[9px] px-1.5 gap-0.5"
            onClick={() => onSwapBundle(product.instanceId, suggestedBundle)}
          >
            <RefreshCw className="h-2.5 w-2.5" />
            Add
          </Button>
        </div>
      ))}
    </div>
  );
};

export default ZoneBundleSection;
