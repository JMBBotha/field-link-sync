import { useState, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  type ProductOption,
  isAcCategory,
  filterProductOptions,
} from "@/hooks/useProductOptions";

interface ProductSearchDropdownProps {
  value: string;
  allOptions: ProductOption[];
  onChange: (value: string) => void;
  onSelect: (option: ProductOption) => void;
  placeholder?: string;
  className?: string;
}

/* ── Highlight helper ── */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query || query.length < 2) return <>{text}</>;
  const words = query.split(/\s+/).filter((w) => w.length >= 2);
  if (words.length === 0) return <>{text}</>;
  const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedWords.join("|")})`, "gi");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        words.some((w) => part.toLowerCase() === w.toLowerCase()) ? (
          <mark key={i} className="bg-yellow-200 dark:bg-yellow-700/60 text-inherit rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

const ProductSearchDropdown = ({
  value,
  allOptions,
  onChange,
  onSelect,
  placeholder = "Item description",
  className,
}: ProductSearchDropdownProps) => {
  const [suggestions, setSuggestions] = useState<ProductOption[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showSuggestions = useCallback(
    (q: string) => {
      setQuery(q);
      setSuggestions(filterProductOptions(allOptions, q));
      setOpen(true);
    },
    [allOptions]
  );

  const starredAc = useMemo(() => suggestions.filter(
    (s) => s.isFavorite && isAcCategory(s.category)
  ), [suggestions]);
  const services = useMemo(() => suggestions.filter((s) => s.source === "template"), [suggestions]);
  const products = useMemo(() => suggestions.filter(
    (s) => s.source === "product" && !(s.isFavorite && isAcCategory(s.category))
  ), [suggestions]);

  const formatPrice = (n: number) =>
    `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const renderRow = (o: ProductOption) => (
    <button
      key={o.id}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(o);
        setOpen(false);
      }}
      className="w-full text-left px-3 py-2.5 hover:bg-accent/60 transition-colors border-b border-border/40 last:border-0 group"
    >
      <div className="flex items-start gap-2.5">
        {/* Left: product info */}
        <div className="flex-1 min-w-0 space-y-0.5">
          {o.productCode && (
            <div className="font-mono text-[11px] font-semibold text-foreground/80">
              <HighlightText text={o.productCode} query={query} />
            </div>
          )}
          <div className="text-sm text-foreground leading-snug">
            <HighlightText text={o.name} query={query} />
            {o.isFavorite && <span className="ml-1">⭐</span>}
          </div>
        </div>
        {/* Right: category + price */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal text-muted-foreground border-border/60">
            {o.category}
          </Badge>
          <span className="text-xs font-semibold text-foreground tabular-nums">
            {formatPrice(o.rate)}
          </span>
        </div>
      </div>
    </button>
  );

  const renderSection = (label: string, items: ProductOption[]) => {
    if (items.length === 0) return null;
    return (
      <>
        <div className="sticky top-0 z-10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50 backdrop-blur-sm border-b border-border/30">
          {label}
        </div>
        {items.map(renderRow)}
      </>
    );
  };

  return (
    <div className="relative">
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          showSuggestions(e.target.value);
        }}
        onFocus={() => showSuggestions(value)}
        onBlur={() => {
          timeoutRef.current = setTimeout(() => setOpen(false), 200);
        }}
        className={cn(
          "w-full bg-transparent border border-transparent rounded px-2 py-1.5 text-sm outline-none transition-colors",
          "hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/30",
          "placeholder:text-muted-foreground/50",
          className
        )}
      />
      {open && suggestions.length > 0 && (
        <div
          className="absolute top-full left-0 z-50 mt-1 bg-popover border border-border rounded-lg shadow-xl max-h-80 overflow-y-auto"
          style={{ width: "min(460px, calc(100vw - 2rem))" }}
        >
          {renderSection("★ Starred AC Units", starredAc)}
          {renderSection("Services", services)}
          {renderSection("Products", products)}
        </div>
      )}
    </div>
  );
};

export default ProductSearchDropdown;
