import { useState, useMemo, useCallback, useEffect } from "react";
import { useDraggable } from "@dnd-kit/core";
import {
  Search, Snowflake, Droplets, Zap, BatteryCharging, Wrench, Package,
  GripVertical, Star, StarOff, Ruler, ChevronDown, ChevronRight, Image,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import { getProductDisplayName } from "./productDisplayUtils";
import BundleItemsPopover, { computeBundlePricing, type BundleSubItem } from "./BundleItemsPopover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import { getProductDisplayName } from "./productDisplayUtils";

function HighlightText({ text, searchTerm }: { text: string; searchTerm: string }) {
  if (!searchTerm || !text) return <>{text}</>;
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return <>{parts.map((part, i) => regex.test(part) ? <span key={i} className="bg-amber-400/40 rounded px-0.5">{part}</span> : part)}</>;
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

// ── Bundle card in palette ──
interface PaletteBundle {
  id: string;
  name: string;
  description: string | null;
  bundle_type: string | null;
  items: Array<{
    id: string;
    supplier_product_id: string;
    quantity: number;
    length_metres: number | null;
    is_length_item: boolean;
    is_optional: boolean;
    product: PaletteProduct | null;
  }>;
}

function BundlePaletteCard({
  bundle,
  searchTerm,
  isDraggingGlobal,
}: {
  bundle: PaletteBundle;
  searchTerm: string;
  isDraggingGlobal?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bundle-${bundle.id}`,
    data: { bundle, type: "bundle" },
  });

  // Build sub-items for pricing and popup
  const subItems: BundleSubItem[] = useMemo(() => {
    return bundle.items
      .filter((item) => item.product)
      .map((item) => ({
        product: item.product as PaletteProduct,
        quantity: item.quantity,
        isLengthItem: item.is_length_item,
        isOptional: item.is_optional,
        ...(item.is_length_item ? { length: item.length_metres || 1 } : {}),
      }));
  }, [bundle.items]);

  const { pricingType, unitPrice } = useMemo(() => computeBundlePricing(subItems), [subItems]);

  const totalPrice = useMemo(() => {
    return subItems
      .filter((i) => !i.isOptional)
      .reduce((sum, i) => {
        if (i.isLengthItem && i.product.price_per_metre) {
          return sum + i.product.price_per_metre * (i.length || 1);
        }
        const price = i.product.selling_price || i.product.cost_incl_vat || 0;
        return sum + price * i.quantity;
      }, 0);
  }, [subItems]);

  const cardContent = (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ touchAction: "none", pointerEvents: isDraggingGlobal && !isDragging ? "none" : "auto" }}
      className={`group rounded-lg border bg-card p-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/20 ${
        isDragging ? "opacity-40 scale-95" : ""
      } border-primary/20 bg-primary/5`}
    >
      <div className="flex items-center gap-2">
        <Package className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate text-foreground">
            <HighlightText text={bundle.name} searchTerm={searchTerm} />
          </p>
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
              {bundle.items.length} items
            </Badge>
            <Badge
              variant="outline"
              className={`text-[8px] px-1 py-0 h-3.5 ${
                pricingType === "p/meter"
                  ? "border-orange-400/40 text-orange-600"
                  : "border-blue-400/40 text-blue-600"
              }`}
            >
              {pricingType}
            </Badge>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="text-xs font-bold text-foreground">
            R{totalPrice.toLocaleString("en-ZA", { maximumFractionDigits: 0 })}
          </span>
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
        </div>
      </div>
    </div>
  );

  return (
    <BundleItemsPopover bundleName={bundle.name} items={subItems} side="right">
      {cardContent}
    </BundleItemsPopover>
  );
}

interface ProductPaletteProps {
  products: PaletteProduct[];
  isLoading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  categoryFilter: string;
  onCategoryChange: (c: string) => void;
  isDragging?: boolean;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  usageMap: Record<string, number>;
  bundles?: PaletteBundle[];
  bundlesLoading?: boolean;
  baskets?: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
  onOpenVisualPanel?: () => void;
}

function DraggableProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  isDraggingGlobal,
  searchTerm,
  usageCount,
}: {
  product: PaletteProduct;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isDraggingGlobal?: boolean;
  searchTerm: string;
  usageCount: number;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${product.id}`,
    data: { product },
  });

  const [hoverOpen, setHoverOpen] = useState(false);
  const [confirmUnfav, setConfirmUnfav] = useState(false);

  useEffect(() => {
    if (isDragging || isDraggingGlobal) setHoverOpen(false);
  }, [isDragging, isDraggingGlobal]);

  const price = product.selling_price || product.cost_incl_vat || 0;
  const catBg = getCategoryBg(product.product_category);

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isFavorite) {
      setConfirmUnfav(true);
    } else {
      onToggleFavorite();
    }
  };

  return (
    <>
      <HoverCard openDelay={400} closeDelay={100} open={isDraggingGlobal ? false : hoverOpen} onOpenChange={setHoverOpen}>
        <HoverCardTrigger asChild>
          <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            style={{ touchAction: 'none', pointerEvents: isDraggingGlobal && !isDragging ? 'none' : 'auto' }}
            className={`group relative flex items-start gap-2.5 rounded-lg border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/20 ${
              isDragging ? "opacity-40 shadow-lg scale-95" : ""
            } ${product.is_pinned ? "border-primary/30" : ""} ${
              isFavorite ? "border-l-2 border-l-yellow-400 bg-yellow-50/50 dark:bg-yellow-950/20" : ""
            }`}
          >
            <div className={`shrink-0 rounded-md p-1.5 ${catBg}`}>
              {getCategoryIcon(product.product_category, "h-4 w-4")}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate leading-tight text-foreground">
                <HighlightText text={getProductDisplayName(product)} searchTerm={searchTerm} />
              </p>
              <p className="text-[10px] font-mono font-medium truncate mt-0.5 text-primary/80">
                <HighlightText text={product.product_code} searchTerm={searchTerm} />
              </p>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-xs font-bold text-foreground">
                  {price > 0 ? `R${price.toLocaleString("en-ZA")}` : "POR"}
                </span>
                {product.sold_in_length && product.price_per_metre && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 gap-0.5 border-orange-400/40 text-orange-600">
                    <Ruler className="h-2 w-2" />
                    R{product.price_per_metre.toFixed(2)}/m
                  </Badge>
                )}
                {product.supplier_name && product.supplier_name.toLowerCase() !== (product.brand || "").toLowerCase() && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                    {product.supplier_name}
                  </Badge>
                )}
                {usageCount > 5 && (
                  <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5">
                    Used {usageCount}x
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
                data-no-dnd="true"
                className={`h-5 w-5 flex items-center justify-center transition-opacity rounded hover:bg-muted ${
                  isFavorite ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  e.nativeEvent.stopImmediatePropagation();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.nativeEvent.stopImmediatePropagation();
                }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  (e.nativeEvent as any).stopImmediatePropagation?.();
                }}
                onClick={handleStarClick}
              >
                {isFavorite ? (
                  <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-500" />
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

      <AlertDialog open={confirmUnfav} onOpenChange={setConfirmUnfav}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from favorites?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{getProductDisplayName(product)}</strong> from your favorites?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onToggleFavorite()}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const ProductPalette = ({
  products,
  isLoading,
  searchQuery,
  onSearchChange,
  categoryFilter,
  onCategoryChange,
  isDragging: isDraggingGlobal,
  favorites,
  onToggleFavorite,
  usageMap,
  bundles = [],
  bundlesLoading = false,
  baskets = [],
  onAddProductToBasket,
  onOpenVisualPanel,
}: ProductPaletteProps) => {
  const filteredProducts = useMemo(() => {
    if (categoryFilter === "favorites") {
      return products.filter((p) => favorites.has(p.id));
    }
    return products;
  }, [products, categoryFilter, favorites]);

  // Sort: favorites first, then by usage count DESC, then alphabetical
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 1 : 0;
      const bFav = favorites.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aUsage = usageMap[a.id] || 0;
      const bUsage = usageMap[b.id] || 0;
      if (aUsage !== bUsage) return bUsage - aUsage;
      return (getProductDisplayName(a)).localeCompare(getProductDisplayName(b));
    });
  }, [filteredProducts, favorites, usageMap]);

  const grouped = useMemo(() => {
    return sortedProducts.reduce<Record<string, PaletteProduct[]>>((acc, p) => {
      const key = p.product_category || "Other";
      if (!acc[key]) acc[key] = [];
      acc[key].push(p);
      return acc;
    }, {});
  }, [sortedProducts]);

  // Filter bundles by search
  const filteredBundles = useMemo(() => {
    if (categoryFilter === "favorites") return [];
    if (!searchQuery.trim()) return bundles;
    const q = searchQuery.toLowerCase();
    return bundles.filter((b) => {
      if (b.name.toLowerCase().includes(q)) return true;
      return b.items.some((item) => {
        if (!item.product) return false;
        const blob = [item.product.product_code, item.product.short_name, item.product.description].filter(Boolean).join(" ").toLowerCase();
        return blob.includes(q);
      });
    });
  }, [bundles, searchQuery, categoryFilter]);

  return (
    <div className="flex flex-col rounded-lg border overflow-hidden h-full min-h-0" style={{ backgroundColor: "#d5d5d5" }}>
      <div className="p-3 border-b space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Product Palette</h3>
          {onOpenVisualPanel && (
            <button
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={onOpenVisualPanel}
            >
              <Image className="h-3 w-3" />
              Visual
            </button>
          )}
        </div>

        {(
          <>
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
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-2 space-y-3">
            {/* Bundles section */}
            {filteredBundles.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                  📦 Bundles ({filteredBundles.length})
                </p>
                <div className="space-y-1.5">
                  {filteredBundles.map((bundle) => (
                    <BundlePaletteCard
                      key={bundle.id}
                      bundle={bundle}
                      searchTerm={searchQuery}
                      isDraggingGlobal={isDraggingGlobal}
                    />
                  ))}
                </div>
              </div>
            )}

            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))
            ) : sortedProducts.length === 0 ? (
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
                        onToggleFavorite={() => onToggleFavorite(product.id)}
                        isDraggingGlobal={isDraggingGlobal}
                        searchTerm={searchQuery}
                        usageCount={usageMap[product.id] || 0}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
    </div>
  );
};

export { type PaletteBundle };
export default ProductPalette;
