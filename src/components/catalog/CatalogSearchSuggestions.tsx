import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import { Filter, Package, Clock, X } from "lucide-react";

interface Product {
  id: string;
  short_name?: string | null;
  description: string;
  product_code: string;
  category: string;
  [key: string]: any;
}

interface Suggestion {
  type: "filter" | "product" | "history";
  label: string;
  action: string;
  icon: "filter" | "product" | "history";
}

// Multi-word aware filter detection
const FILTER_MATCHERS: { pattern: RegExp; label: string; action: string; removePattern: RegExp }[] = [
  { pattern: /\binvert(?:e?r)?\b/i, label: "Filter to Inverter", action: "speedType:Inverter", removePattern: /\binvert(?:e?r)?\s*/gi },
  { pattern: /\bfixed\s*(?:speed)?\b/i, label: "Filter to Fixed Speed", action: "speedType:Fixed Speed", removePattern: /\bfixed\s*(?:speed)?\s*/gi },
  { pattern: /\bmidwall\b/i, label: "Filter to Midwall type", action: "unitType:Midwall", removePattern: /\bmidwall\s*/gi },
  { pattern: /\bcass?ett?e\b/i, label: "Filter to Cassette type", action: "unitType:Cassette", removePattern: /\bcass?ett?e\s*/gi },
  { pattern: /\bducted\b/i, label: "Filter to Ducted type", action: "unitType:Ducted", removePattern: /\bducted\s*/gi },
  { pattern: /\bportable\b/i, label: "Filter to Portable type", action: "unitType:Portable", removePattern: /\bportable\s*/gi },
  { pattern: /\bfloor\b/i, label: "Filter to Floor Standing", action: "unitType:Floor Standing", removePattern: /\bfloor\s*/gi },
  { pattern: /\br32\b/i, label: "Filter to R32 refrigerant", action: "refrigerant:R32", removePattern: /\br32\s*/gi },
  { pattern: /\br410a?\b/i, label: "Filter to R410A refrigerant", action: "refrigerant:R410A", removePattern: /\br410a?\s*/gi },
  { pattern: /\b9k\b/i, label: "Show 9K BTU units", action: "btu:9K", removePattern: /\b9k\s*/gi },
  { pattern: /\b12k?\b/i, label: "Show 12K BTU units", action: "btu:12K", removePattern: /\b12k?\s*/gi },
  { pattern: /\b18k?\b/i, label: "Show 18K BTU units", action: "btu:18K", removePattern: /\b18k?\s*/gi },
  { pattern: /\b24k?\b/i, label: "Show 24K BTU units", action: "btu:24K", removePattern: /\b24k?\s*/gi },
  { pattern: /\b34k?\b/i, label: "Show 34K BTU units", action: "btu:34K", removePattern: /\b34k?\s*/gi },
  { pattern: /\b36k?\b/i, label: "Show 36K BTU units", action: "btu:36K", removePattern: /\b36k?\s*/gi },
  { pattern: /\b48k?\b/i, label: "Show 48K BTU units", action: "btu:48K", removePattern: /\b48k?\s*/gi },
  { pattern: /\b60k?\b/i, label: "Show 60K BTU units", action: "btu:60K", removePattern: /\b60k?\s*/gi },
  { pattern: /\b3ph\b/i, label: "Filter to Three Phase", action: "phase:3Ph", removePattern: /\b3ph\s*/gi },
  { pattern: /\b1ph\b/i, label: "Filter to Single Phase", action: "phase:1Ph", removePattern: /\b1ph\s*/gi },
];

interface Props {
  query: string;
  products: Product[];
  visible: boolean;
  onSelectFilter: (action: string, removePattern: RegExp) => void;
  onSelectProduct: (productId: string) => void;
  onClose: () => void;
  focusIndex: number;
  searchHistory: string[];
  onSelectHistory: (term: string) => void;
  onRemoveHistory: (term: string) => void;
}

const CatalogSearchSuggestions = ({
  query, products, visible, onSelectFilter, onSelectProduct, onClose,
  focusIndex, searchHistory, onSelectHistory, onRemoveHistory,
}: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const suggestions = useMemo<Suggestion[]>(() => {
    // Show history when query is empty
    if (!query.trim() && visible) {
      return searchHistory.slice(0, 8).map(h => ({
        type: "history" as const,
        label: h,
        action: h,
        icon: "history" as const,
      }));
    }
    if (!query.trim() || !visible) return [];
    const result: Suggestion[] = [];

    // Parse each word in the query for filter matches
    const seenActions = new Set<string>();
    for (const matcher of FILTER_MATCHERS) {
      if (matcher.pattern.test(query) && !seenActions.has(matcher.action)) {
        seenActions.add(matcher.action);
        result.push({ type: "filter", label: matcher.label, action: matcher.action, icon: "filter" });
      }
    }

    // Top product matches (from already-filtered/sorted list)
    const topProducts = products.slice(0, 5);
    for (const p of topProducts) {
      result.push({
        type: "product",
        label: p.short_name || p.product_code,
        action: p.id,
        icon: "product",
      });
    }

    return result.slice(0, 10);
  }, [query, products, visible, searchHistory]);

  if (!visible || suggestions.length === 0) return null;

  const historySuggestions = suggestions.filter(s => s.type === "history");
  const filterSuggestions = suggestions.filter(s => s.type === "filter");
  const productSuggestions = suggestions.filter(s => s.type === "product");

  let flatIndex = -1;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden"
    >
      {historySuggestions.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            Recent Searches
          </div>
          {historySuggestions.map((s) => {
            flatIndex++;
            const isActive = flatIndex === focusIndex;
            return (
              <button
                key={`history-${s.action}`}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors group ${
                  isActive ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => { onSelectHistory(s.action); onClose(); }}
              >
                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-foreground flex-1">{s.label}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive p-0.5"
                  onClick={(e) => { e.stopPropagation(); onRemoveHistory(s.action); }}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </button>
            );
          })}
        </>
      )}
      {filterSuggestions.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            Quick Filters
          </div>
          {filterSuggestions.map((s) => {
            flatIndex++;
            const isActive = flatIndex === focusIndex;
            const matcher = FILTER_MATCHERS.find(m => m.action === s.action);
            return (
              <button
                key={`filter-${s.action}`}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  isActive ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => { if (matcher) onSelectFilter(s.action, matcher.removePattern); onClose(); }}
              >
                <Filter className="h-3 w-3 text-primary shrink-0" />
                <span className="text-primary font-medium">{s.label}</span>
              </button>
            );
          })}
        </>
      )}
      {productSuggestions.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            Products
          </div>
          {productSuggestions.map((s) => {
            flatIndex++;
            const isActive = flatIndex === focusIndex;
            return (
              <button
                key={`product-${s.action}`}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                  isActive ? "bg-accent" : "hover:bg-accent/50"
                }`}
                onClick={() => { onSelectProduct(s.action); onClose(); }}
              >
                <Package className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-foreground">{s.label}</span>
              </button>
            );
          })}
        </>
      )}
    </div>
  );
};

export { FILTER_MATCHERS };
export default CatalogSearchSuggestions;
