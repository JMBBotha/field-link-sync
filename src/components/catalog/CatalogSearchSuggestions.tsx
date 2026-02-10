import { useMemo, useRef, useEffect, useState } from "react";
import { Search, Filter, Package } from "lucide-react";

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

const FILTER_KEYWORDS: { keyword: string; filterLabel: string; action: string }[] = [
  { keyword: "inverter", filterLabel: "Filter to Inverter only", action: "speedType:Inverter" },
  { keyword: "fixed", filterLabel: "Filter to Fixed Speed only", action: "speedType:Fixed Speed" },
  { keyword: "midwall", filterLabel: "Filter to Midwall type", action: "unitType:Midwall" },
  { keyword: "cassette", filterLabel: "Filter to Cassette type", action: "unitType:Cassette" },
  { keyword: "ducted", filterLabel: "Filter to Ducted type", action: "unitType:Ducted" },
  { keyword: "r32", filterLabel: "Filter to R32 refrigerant", action: "refrigerant:R32" },
  { keyword: "r410", filterLabel: "Filter to R410A refrigerant", action: "refrigerant:R410A" },
  { keyword: "portable", filterLabel: "Filter to Portable type", action: "unitType:Portable" },
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
    const q = query.toLowerCase();
    const result: Suggestion[] = [];

    // Filter suggestions
    for (const fk of FILTER_KEYWORDS) {
      if (fk.keyword.includes(q) || q.includes(fk.keyword)) {
        result.push({ type: "filter", label: fk.filterLabel, action: fk.action, icon: "filter" });
      }
    }

    // Top product matches (just first 5 from already-filtered list)
    const topProducts = products.slice(0, 5);
    for (const p of topProducts) {
      result.push({
        type: "product",
        label: p.short_name || p.product_code,
        action: p.id,
        icon: "product",
      });
    }

    return result.slice(0, 8);
  }, [query, products, visible]);

  if (!visible || suggestions.length === 0) return null;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-popover shadow-lg overflow-hidden"
    >
      {suggestions.map((s, i) => (
        <button
          key={`${s.type}-${s.action}`}
          className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent/50 transition-colors ${
            i === focusIndex ? "bg-accent/50" : ""
          }`}
          onClick={() => {
            if (s.type === "filter") onSelectFilter(s.action);
            else onSelectProduct(s.action);
            onClose();
          }}
        >
          {s.type === "filter" ? (
            <Filter className="h-3 w-3 text-primary shrink-0" />
          ) : (
            <Package className="h-3 w-3 text-muted-foreground shrink-0" />
          )}
          <span className={s.type === "filter" ? "text-primary font-medium" : "text-foreground"}>
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
};

export default CatalogSearchSuggestions;
