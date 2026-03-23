import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const showSuggestions = useCallback(
    (query: string) => {
      setSuggestions(filterProductOptions(allOptions, query));
      setOpen(true);
    },
    [allOptions]
  );

  const starredAc = suggestions.filter(
    (s) => s.isFavorite && isAcCategory(s.category)
  );
  const services = suggestions.filter((s) => s.source === "template");
  const products = suggestions.filter(
    (s) => s.source === "product" && !(s.isFavorite && isAcCategory(s.category))
  );

  const renderRow = (o: ProductOption) => (
    <button
      key={o.id}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(o);
        setOpen(false);
      }}
      className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors"
    >
      <div className="flex justify-between items-center gap-2">
        <span className="flex-1 min-w-0 truncate">
          {o.productCode && (
            <span className="text-[10px] font-mono text-muted-foreground mr-1.5">[{o.productCode}]</span>
          )}
          {o.name} {o.isFavorite ? "⭐" : ""}
        </span>
        <span className="text-[10px] text-muted-foreground shrink-0">{o.category}</span>
        <span className="text-xs font-medium shrink-0">R {o.rate.toFixed(2)}</span>
      </div>
    </button>
  );

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
        <div className="absolute top-full left-0 z-50 w-80 mt-1 bg-popover border rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {starredAc.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                ★ Starred AC Units
              </div>
              {starredAc.map(renderRow)}
            </>
          )}
          {services.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                Services
              </div>
              {services.map(renderRow)}
            </>
          )}
          {products.length > 0 && (
            <>
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">
                Products
              </div>
              {products.map(renderRow)}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ProductSearchDropdown;
