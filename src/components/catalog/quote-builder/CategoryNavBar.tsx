import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Star, Filter } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PaletteProduct } from "../QuoteBuilderTab";

interface CategoryNavBarProps {
  products: PaletteProduct[];
  favoriteIds: Set<string>;
  currentSupplierName: string;
  onScrollToCategory: (category: string) => void;
  activeCategory?: string;
}

/** Normalize raw product categories into display-friendly groups */
function groupCategory(raw: string): string {
  const lower = (raw || "").toLowerCase().trim();

  // Wall mounted variants
  if (/wall\s*mount|midwall|\bmw\b/.test(lower)) return "Wall Mounted";
  // Cassette
  if (/cassette|cass/.test(lower)) return "Cassette";
  // Ceiling
  if (/ceiling\s*susp/.test(lower)) return "Ceiling Suspended";
  if (/ceiling\s*conc|hide\s*away/.test(lower)) return "Ceiling Concealed";
  if (/under\s*ceil/.test(lower)) return "Under Ceiling";
  // Ducted
  if (/ducted/.test(lower)) return "Ducted";
  // Multi split
  if (/multi\s*split/.test(lower)) return "Multi Split";
  // VRV / VRF
  if (/vrv|vrf/.test(lower)) return "VRV";
  // Floor standing
  if (/floor|standing/.test(lower)) return "Floor Standing";
  // Consumables
  if (/consumable|copper|pipe|gas|brazing|fitting/.test(lower)) return "Consumables";
  // Water heaters
  if (/water\s*heat|geyser/.test(lower)) return "Water Heaters";
  // Inverter variants
  if (/inverter|inv/.test(lower) && /r32|r-32/.test(lower)) return "R32 Inverter";
  if (/inverter|inv/.test(lower) && /r410|r-410/.test(lower)) return "R410 Inverter";
  if (/non.?inv/.test(lower)) return "Non-Inverter";
  // Electrical
  if (/electr|cable|wire|isolat|switch|breaker/.test(lower)) return "Electrical";
  // Batteries / solar
  if (/batter|solar/.test(lower)) return "Batteries & Solar";

  // Use the raw category if short enough, otherwise truncate
  if (raw && raw.length <= 25) return raw;
  if (raw) return raw.substring(0, 22) + "…";
  return "Other";
}

const CategoryNavBar = ({
  products,
  favoriteIds,
  currentSupplierName,
  onScrollToCategory,
  activeCategory,
}: CategoryNavBarProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [starFilterActive, setStarFilterActive] = useState(false);

  // Build category list from products, grouping intelligently
  const categories = useMemo(() => {
    const catMap = new Map<string, { count: number; starredCount: number; products: PaletteProduct[] }>();

    for (const p of products) {
      // Filter to current supplier if name is set
      if (currentSupplierName && p.supplier_name && p.supplier_name !== currentSupplierName) continue;

      const group = groupCategory(p.product_category || p.category || p.description || "");
      const existing = catMap.get(group) || { count: 0, starredCount: 0, products: [] };
      existing.count++;
      if (favoriteIds.has(p.id)) existing.starredCount++;
      existing.products.push(p);
      catMap.set(group, existing);
    }

    // Sort: starred categories first, then by count
    return Array.from(catMap.entries())
      .sort(([, a], [, b]) => {
        if (a.starredCount > 0 && b.starredCount === 0) return -1;
        if (b.starredCount > 0 && a.starredCount === 0) return 1;
        return b.count - a.count;
      })
      .map(([name, data]) => ({
        name,
        count: data.count,
        starredCount: data.starredCount,
      }));
  }, [products, favoriteIds, currentSupplierName]);

  const visibleCategories = useMemo(() => {
    if (!starFilterActive) return categories;
    return categories.filter((c) => c.starredCount > 0);
  }, [categories, starFilterActive]);

  // Auto-scroll to first starred category on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const firstStarred = categories.findIndex((c) => c.starredCount > 0);
    if (firstStarred > 0) {
      const btn = scrollRef.current.children[firstStarred + 1] as HTMLElement; // +1 for filter button
      btn?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [categories]);

  if (categories.length === 0) return null;

  return (
    <div className="absolute bottom-8 left-2 right-2 z-40 pointer-events-none">
      <div className="pointer-events-auto bg-background/80 backdrop-blur-md border rounded-xl shadow-lg px-2 py-1.5 flex items-center gap-1">
        {/* Star filter toggle */}
        <Button
          variant={starFilterActive ? "default" : "ghost"}
          size="icon"
          className={cn(
            "h-7 w-7 shrink-0",
            starFilterActive && "bg-yellow-500 hover:bg-yellow-600 text-white"
          )}
          onClick={() => setStarFilterActive(!starFilterActive)}
          title="Show only starred categories"
        >
          <Star className={cn("h-3.5 w-3.5", starFilterActive && "fill-current")} />
        </Button>

        {/* Scrollable category pills */}
        <div
          ref={scrollRef}
          className="flex items-center gap-1 overflow-x-auto scrollbar-none"
          style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
        >
          {visibleCategories.map((cat) => (
            <button
              key={cat.name}
              className={cn(
                "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors whitespace-nowrap",
                activeCategory === cat.name
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-foreground hover:bg-muted"
              )}
              onClick={() => onScrollToCategory(cat.name)}
            >
              {cat.starredCount > 0 && (
                <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-500 shrink-0" />
              )}
              <span>{cat.name}</span>
              <Badge variant="secondary" className="h-4 text-[8px] px-1 py-0 bg-background/50 shrink-0">
                {cat.count}
              </Badge>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default CategoryNavBar;
