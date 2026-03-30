import { useMemo } from "react";
import { Package, X, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { BasketItem } from "../QuoteBuilderTab";
import { extractBtu } from "@/lib/bundles";
import { findTierConfigForBtu } from "@/lib/bundleTierConfig";

interface BundleSectionProps {
  basketItems: BasketItem[];
  dbBundles?: Array<{ id: string; name: string; min_btu?: number | null; max_btu?: number | null; items: any[] }>;
  onRemoveBundle: (instanceId: string) => void;
  onSwapBundle: (instanceId: string, newBundle: any) => void;
}

/**
 * Shows auto-attached tier bundles in a zone, with remove controls.
 * Groups bundles by tier (T1: Piping, T2: Drain/Trunking, T3: Electrical).
 */
const ZoneBundleSection = ({ basketItems, onRemoveBundle }: BundleSectionProps) => {
  const bundleItems = basketItems.filter((i) => i.isBundle);
  const acItems = basketItems.filter((i) => i.product.product_category === "Air Conditioning" && !i.isBundle);

  // Check if there are AC units without tier bundles
  const missingTiers = useMemo(() => {
    const missing: string[] = [];
    for (const ac of acItems) {
      const btu = extractBtu(ac.product);
      if (!btu) continue;
      const config = findTierConfigForBtu(btu);
      if (!config) continue;
      const prefix = `tier-${config.capacityLabel}-`;
      const existingTiers = bundleItems.filter((b) => b.bundleId?.startsWith(prefix));
      if (existingTiers.length === 0) {
        missing.push(`${config.capacityLabel} bundles`);
      }
    }
    return [...new Set(missing)];
  }, [acItems, bundleItems]);

  if (bundleItems.length === 0 && missingTiers.length === 0) return null;

  return (
    <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-2 mt-1.5">
      <p className="text-[10px] font-semibold text-primary flex items-center gap-1 mb-1.5">
        <Layers className="h-3 w-3" />
        Installation Bundles
      </p>

      {/* Active bundles grouped by tier */}
      {bundleItems.map((item) => {
        const price = item.bundleUnitPrice || 0;
        // Extract tier number from bundleId like "tier-24K-1"
        const tierMatch = item.bundleId?.match(/tier-\w+-(\d)/);
        const tierNum = tierMatch ? tierMatch[1] : null;
        return (
          <div key={item.instanceId} className="flex items-center justify-between gap-1 py-0.5">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {tierNum && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  T{tierNum}
                </Badge>
              )}
              {!tierNum && (
                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 shrink-0">
                  <Package className="h-2 w-2" />
                </Badge>
              )}
              <span className="text-[10px] font-medium truncate">{item.bundleName || "Bundle"}</span>
              <Badge variant="outline" className="text-[8px] px-0.5 py-0 h-3 shrink-0">
                {item.bundleItems?.length || 0}
              </Badge>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              {price > 0 && (
                <span className="text-[9px] text-muted-foreground tabular-nums">
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

      {/* Missing bundle warnings */}
      {missingTiers.map((label) => (
        <div key={`missing-${label}`} className="flex items-center gap-1 py-0.5 opacity-70">
          <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 border-amber-400/40 text-amber-600">
            Missing
          </Badge>
          <span className="text-[9px] truncate flex-1">{label} not added</span>
        </div>
      ))}
    </div>
  );
};

export default ZoneBundleSection;
