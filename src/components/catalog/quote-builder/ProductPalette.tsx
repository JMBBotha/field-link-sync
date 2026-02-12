import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Search, Snowflake, Droplets, Zap, BatteryCharging, Wrench, Package,
  GripVertical, Star, StarOff,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { PaletteProduct } from "../QuoteBuilderTab";
import { getProductDisplayName } from "./productDisplayUtils";

const LS_FAVORITES_KEY = "quote-builder-favorites";

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_FAVORITES_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveFavorites(ids: Set<string>) {
  localStorage.setItem(LS_FAVORITES_KEY, JSON.stringify([...ids]));
}

const CATEGORIES = [
  { value: "all", label: "All", icon: Package },
  { value: "favorites", label: "★ Favs", icon: Star },
  { value: "Air Conditioning", label: "AC", icon: Snowflake },
  { value: "Water Heaters", label: "Geyser", icon: Droplets },
  { value: "Inverters", label: "Inverter", icon: Zap },
  { value: "Batteries", label: "Battery", icon: BatteryCharging },
  { value: "Consumables", label: "Parts", icon: Wrench },
];

export function getCategoryIcon(category: string, size = "h-5 w-5") {
  switch (category) {
    case "Air Conditioning": return <Snowflake className={`${size} text-primary`} />;
    case "Water Heaters": return <Droplets className={`${size} text-blue-500`} />;
    case "Inverters": return <Zap className={`${size} text-amber-500`} />;
    case "Batteries": return <BatteryCharging className={`${size} text-green-600`} />;
    case "Consumables": return <Wrench className={`${size} text-orange-500`} />;
    default: return <Package className={`${size} text-muted-foreground`} />;
  }
}

export function getCategoryBg(category: string) {
  switch (category) {
    case "Air Conditioning": return "bg-primary/10";
    case "Water Heaters": return "bg-blue-500/10";
    case "Inverters": return "bg-amber-500/10";
    case "Batteries": return "bg-green-600/10";
    case "Consumables": return "bg-orange-500/10";
    default: return "bg-muted";
  }
}

interface ProductPaletteProps {
  products: PaletteProduct[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categoryFilter: string;
  onCategoryChange: (c: string) => void;
  onProductClick?: (product: PaletteProduct) => void;
  isDragging?: boolean;
}

function DraggableProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  onProductClick,
  isDraggingGlobal,
}: {
  product: PaletteProduct;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onProductClick?: (p: PaletteProduct) => void;
  isDraggingGlobal?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${product.id}`,
    data: { product },
  });

  const [ignoreClick, setIgnoreClick] = useState(false);
  const dragAttemptRef = useRef(false);
  const isDownRef = useRef(false);
  const [hoverOpen, setHoverOpen] = useState(false);

  useEffect(() => {
    if (isDragging || isDraggingGlobal) setHoverOpen(false);
  }, [isDragging, isDraggingGlobal]);

  const customListeners = useMemo(() => {
    if (!listeners) return {};
    return {
      ...listeners,
      onPointerDown: (e: React.PointerEvent) => {
        isDownRef.current = true;
        dragAttemptRef.current = false;
        if ((listeners as any).onPointerDown) (listeners as any).onPointerDown(e);
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (isDownRef.current) dragAttemptRef.current = true;
        if ((listeners as any).onPointerMove) (listeners as any).onPointerMove(e);
      },
      onPointerUp: (e: React.PointerEvent) => {
        if ((listeners as any).onPointerUp) (listeners as any).onPointerUp(e);
        if (isDownRef.current && dragAttemptRef.current) {
          setIgnoreClick(true);
          setTimeout(() => setIgnoreClick(false), 0);
        }
        isDownRef.current = false;
      },
    };
  }, [listeners]);

  const handleClick = useCallback(() => {
    if (ignoreClick || isDraggingGlobal) return;
    onProductClick?.(product);
  }, [ignoreClick, isDraggingGlobal, onProductClick, product]);

  const price = product.selling_price || product.cost_incl_vat || 0;
  const catBg = getCategoryBg(product.product_category);

  return (
    <HoverCard openDelay={400} closeDelay={100} open={isDraggingGlobal ? false : hoverOpen} onOpenChange={setHoverOpen}>
      <HoverCardTrigger asChild>
        <div
          ref={setNodeRef}
          {...attributes}
          {...customListeners}
          onClick={handleClick}
          style={{ touchAction: 'none', pointerEvents: isDraggingGlobal && !isDragging ? 'none' : 'auto' }}
          className={`group relative flex items-start gap-2.5 rounded-lg border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/20 ${
            isDragging ? "opacity-40 shadow-lg scale-95" : ""
          } ${product.is_pinned ? "border-primary/30" : ""}`}
        >
          <div className={`shrink-0 rounded-md p-1.5 ${catBg}`}>
            {getCategoryIcon(product.product_category, "h-4 w-4")}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate leading-tight text-foreground">
              {getProductDisplayName(product)}
            </p>
            <p className="text-[10px] font-mono font-medium truncate mt-0.5 text-primary/80">
              {product.product_code}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-xs font-bold text-foreground">
                {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
              </span>
              {product.supplier_name && (
                <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                  {product.supplier_name}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center gap-1 shrink-0">
            <div className="p-0.5 rounded">
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
            </div>
            <button
              type="button"
              className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded hover:bg-muted"
              onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
              onMouseDown={(e) => { e.stopPropagation(); }}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleFavorite(); }}
            >
              {isFavorite ? (
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
              ) : (
                <StarOff className="h-3 w-3 text-muted-foreground" />
              )}
            </button>
          </div>
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="right" className="w-64 text-xs space-y-1.5">
        <div className="flex items-center gap-2">
          <div className={`rounded-md p-1 ${catBg}`}>
            {getCategoryIcon(product.product_category, "h-3.5 w-3.5")}
          </div>
          <p className="font-semibold">{getProductDisplayName(product)}</p>
        </div>
        <p className="font-mono font-medium text-primary/80">{product.product_code}</p>
        <div className="flex justify-between">
          <span>Cost excl.</span>
          <span className="font-medium">R{(product.cost_excl_vat || 0).toLocaleString("en-ZA")}</span>
        </div>
        <div className="flex justify-between">
          <span>Cost incl.</span>
          <span className="font-medium">R{(product.cost_incl_vat || 0).toLocaleString("en-ZA")}</span>
        </div>
        <div className="flex justify-between">
          <span>Selling</span>
          <span className="font-bold">R{(product.selling_price || 0).toLocaleString("en-ZA")}</span>
        </div>
        <p className="text-[10px] text-muted-foreground line-clamp-3">{product.description}</p>
        <Badge variant="outline" className="text-[10px]">{product.supplier_name}</Badge>
      </HoverCardContent>
    </HoverCard>
  );
}

const ProductPalette = ({
  products,
  isLoading,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  onProductClick,
  isDragging: isDraggingGlobal,
}: ProductPaletteProps) => {
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);

  useEffect(() => {
    saveFavorites(favorites);
  }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Filter by favorites if selected
  const filteredProducts = useMemo(() => {
    if (categoryFilter === "favorites") {
      return products.filter((p) => favorites.has(p.id));
    }
    return products;
  }, [products, categoryFilter, favorites]);

  // Group products by category, favorites first
  const grouped = useMemo(() => {
    const favProds: PaletteProduct[] = [];
    const rest: PaletteProduct[] = [];
    filteredProducts.forEach((p) => {
      if (favorites.has(p.id)) favProds.push(p);
      else rest.push(p);
    });
    const sorted = [...favProds, ...rest];
    return sorted.reduce<Record<string, PaletteProduct[]>>((acc, p) => {
      const key = p.product_category || "Other";
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});
  }, [filteredProducts, favorites]);

  return (
    <div className="flex flex-col rounded-lg border bg-card overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Product Palette</h3>
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = categoryFilter === cat.value;
            return (
              <Badge
                key={cat.value}
                variant={isActive ? "default" : "outline"}
                className={`cursor-pointer text-[10px] gap-0.5 px-1.5 py-0.5 ${
                  cat.value === "favorites" && favorites.size > 0 ? "border-amber-400/50" : ""
                }`}
                onClick={() => onCategoryChange(cat.value)}
              >
                <Icon className="h-2.5 w-2.5" />
                {cat.label}
                {cat.value === "favorites" && favorites.size > 0 && (
                  <span className="ml-0.5">({favorites.size})</span>
                )}
              </Badge>
            );
          })}
        </div>
      </div>

      {/* Product list */}
      <ScrollArea className="flex-1" style={{ maxHeight: "calc(100vh - 280px)" }}>
        <div className="p-2 space-y-3">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : filteredProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {categoryFilter === "favorites" ? "No favorites yet — star products to add them" : "No products found"}
            </p>
          ) : (
            Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  {category} ({items.length})
                </p>
                <div className="space-y-1.5">
                  {items.map((product) => (
                    <DraggableProductCard
                      key={product.id}
                      product={product}
                      isFavorite={favorites.has(product.id)}
                      onToggleFavorite={() => toggleFavorite(product.id)}
                      onProductClick={onProductClick}
                      isDraggingGlobal={isDraggingGlobal}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default ProductPalette;
