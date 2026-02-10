import { useMemo, useRef, useEffect, useState } from "react";
import { Filter, Package, Zap, Wind, Thermometer, Gauge } from "lucide-react";

interface Product {
  id: string;
  short_name?: string | null;
  description: string;
  product_code: string;
  category: string;
  [key: string]: any;
}

interface Suggestion {
  type: "filter" | "product";
  label: string;
  action: string;
  icon: "filter" | "product";
}

// Multi-word aware filter detection
const FILTER_MATCHERS: { pattern: RegExp; label: string; action: string }[] = [
  { pattern: /\binvert(?:e?r)?\b/i, label: "Filter to Inverter", action: "speedType:Inverter" },
  { pattern: /\bfixed\b/i, label: "Filter to Fixed Speed", action: "speedType:Fixed Speed" },
  { pattern: /\bmidwall\b/i, label: "Filter to Midwall type", action: "unitType:Midwall" },
  { pattern: /\bcass?ett?e\b/i, label: "Filter to Cassette type", action: "unitType:Cassette" },
  { pattern: /\bducted\b/i, label: "Filter to Ducted type", action: "unitType:Ducted" },
  { pattern: /\bportable\b/i, label: "Filter to Portable type", action: "unitType:Portable" },
  { pattern: /\bfloor\b/i, label: "Filter to Floor Standing", action: "unitType:Floor Standing" },
  { pattern: /\br32\b/i, label: "Filter to R32 refrigerant", action: "refrigerant:R32" },
  { pattern: /\br410a?\b/i, label: "Filter to R410A refrigerant", action: "refrigerant:R410A" },
  { pattern: /\b9k\b/i, label: "Show 9K BTU units", action: "btu:9K" },
  { pattern: /\b12k?\b/i, label: "Show 12K BTU units", action: "btu:12K" },
  { pattern: /\b18k?\b/i, label: "Show 18K BTU units", action: "btu:18K" },
  { pattern: /\b24k?\b/i, label: "Show 24K BTU units", action: "btu:24K" },
  { pattern: /\b34k?\b/i, label: "Show 34K BTU units", action: "btu:34K" },
  { pattern: /\b36k?\b/i, label: "Show 36K BTU units", action: "btu:36K" },
  { pattern: /\b48k?\b/i, label: "Show 48K BTU units", action: "btu:48K" },
  { pattern: /\b60k?\b/i, label: "Show 60K BTU units", action: "btu:60K" },
  { pattern: /\b3ph\b/i, label: "Filter to Three Phase", action: "phase:3Ph" },
  { pattern: /\b1ph\b/i, label: "Filter to Single Phase", action: "phase:1Ph" },
];

interface Props {
  query: string;
  products: Product[];
  visible: boolean;
  onSelectFilter: (action: string) => void;
  onSelectProduct: (productId: string) => void;
  onClose: () => void;
}

const CatalogSearchSuggestions = ({ query, products, visible, onSelectFilter, onSelectProduct, onClose }: Props) => {
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(-1);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const suggestions = useMemo<Suggestion[]>(() => {
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
  }, [query, products, visible]);

  if (!visible || suggestions.length === 0) return null;

  const filterSuggestions = suggestions.filter(s => s.type === "filter");
  const productSuggestions = suggestions.filter(s => s.type === "product");

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden"
    >
      {filterSuggestions.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            Quick Filters
          </div>
          {filterSuggestions.map((s, i) => (
            <button
              key={`filter-${s.action}`}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/50 transition-colors"
              onClick={() => { onSelectFilter(s.action); onClose(); }}
            >
              <Filter className="h-3 w-3 text-primary shrink-0" />
              <span className="text-primary font-medium">{s.label}</span>
            </button>
          ))}
        </>
      )}
      {productSuggestions.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
            Products
          </div>
          {productSuggestions.map((s) => (
            <button
              key={`product-${s.action}`}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-accent/50 transition-colors"
              onClick={() => { onSelectProduct(s.action); onClose(); }}
            >
              <Package className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-foreground">{s.label}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
};

export default CatalogSearchSuggestions;
