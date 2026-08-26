import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { computePricing, resolveSupplierCode } from "@/lib/pricing";
import { useDraggable } from "@dnd-kit/core";
import {
  Search,
  Snowflake,
  Droplets,
  Zap,
  BatteryCharging,
  Wrench,
  Package,
  GripVertical,
  Star,
  StarOff,
  Ruler,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Image,
  ExternalLink,
  MapPin,
  CheckCircle2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";
import { getProductDisplayName, getProductBriefDescription } from "./productDisplayUtils";
import { allTermsMatchBlob } from "../searchSynonyms";
import BundleItemsPopover, { computeBundlePricing, type BundleSubItem } from "./BundleItemsPopover";

function HighlightText({ text, searchTerm }: { text: string; searchTerm: string }) {
  if (!searchTerm || !text) return <>{text}</>;
  const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <span key={i} className="bg-amber-400/40 rounded px-0.5">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

import { Clock } from "lucide-react";

const RECENT_KEY = "recent-products";
function getRecentProductIds(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; }
}
export function pushRecentProduct(productId: string) {
  const list = getRecentProductIds().filter(id => id !== productId);
  list.unshift(productId);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 15)));
}

const CATEGORIES = [
  { value: "all", label: "All", icon: Package },
  { value: "favorites", label: "★ Favs", icon: Star },
  { value: "recent", label: "Recent", icon: Clock },
  { value: "Air Conditioning", label: "AC", icon: Snowflake },
  { value: "Water Heaters", label: "Geyser", icon: Droplets },
  { value: "Inverters", label: "Inverter", icon: Zap },
  { value: "Batteries", label: "Battery", icon: BatteryCharging },
  { value: "Consumables", label: "Parts", icon: Wrench },
];

export function getCategoryIcon(category: string, size = "h-5 w-5") {
  switch (category) {
    case "Air Conditioning":
      return <Snowflake className={`${size} text-primary`} />;
    case "Water Heaters":
      return <Droplets className={`${size} text-blue-500`} />;
    case "Inverters":
      return <Zap className={`${size} text-amber-500`} />;
    case "Batteries":
      return <BatteryCharging className={`${size} text-green-600`} />;
    case "Consumables":
      return <Wrench className={`${size} text-orange-500`} />;
    default:
      return <Package className={`${size} text-muted-foreground`} />;
  }
}

export function getCategoryBg(category: string) {
  switch (category) {
    case "Air Conditioning":
      return "bg-primary/10";
    case "Water Heaters":
      return "bg-blue-500/10";
    case "Inverters":
      return "bg-amber-500/10";
    case "Batteries":
      return "bg-green-600/10";
    case "Consumables":
      return "bg-orange-500/10";
    default:
      return "bg-muted";
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

function BundlePaletteButton({
  bundle,
  searchTerm,
  isDraggingGlobal,
  baskets,
  onAddBundleToBasket,
}: {
  bundle: PaletteBundle;
  searchTerm: string;
  isDraggingGlobal?: boolean;
  baskets?: Basket[];
  onAddBundleToBasket?: (basketId: string, bundle: PaletteBundle) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `bundle-${bundle.id}`,
    data: { bundle, type: "bundle" },
  });

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

  const handleClick = useCallback(() => {
    if (baskets && baskets.length > 0 && onAddBundleToBasket) {
      onAddBundleToBasket(baskets[0].id, bundle);
    }
  }, [baskets, onAddBundleToBasket, bundle]);

  return (
    <BundleItemsPopover bundleName={bundle.name} items={subItems} side="right">
      <div
        ref={setNodeRef}
        {...attributes}
        {...listeners}
        onClick={handleClick}
        style={{ touchAction: "none" }}
        className={`group flex items-center gap-2 rounded-md border-2 border-primary/50 bg-card px-2.5 py-1.5 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary hover:bg-accent/40 ${
          isDragging ? "opacity-50 scale-95" : ""
        }`}
      >
        <Package className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-medium truncate flex-1">
          <HighlightText text={bundle.name} searchTerm={searchTerm} />
        </span>
        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 shrink-0">
          {subItems.length}
        </Badge>
        <span className="text-[10px] font-bold shrink-0">
          R{unitPrice.toFixed(0)}/{pricingType === "p/meter" ? "m" : "ea"}
        </span>
      </div>
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
  onAddBundleToBasket?: (basketId: string, bundle: PaletteBundle) => void;
  onOpenVisualPanel?: () => void;
  pdfSelection?: PdfSelectionHandlers;
  onPopOutSelected?: () => void;
}

function DraggableProductCard({
  product,
  isFavorite,
  onToggleFavorite,
  isDraggingGlobal,
  searchTerm,
  usageCount,
  baskets,
  onAddProductToBasket,
}: {
  product: PaletteProduct;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  isDraggingGlobal?: boolean;
  searchTerm: string;
  usageCount: number;
  baskets?: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette-${product.id}`,
    data: { product },
  });

  const [hoverOpen, setHoverOpen] = useState(false);
  const [confirmUnfav, setConfirmUnfav] = useState(false);
  const [zonePickerOpen, setZonePickerOpen] = useState(false);
  const dragStarted = useRef(false);

  useEffect(() => {
    if (isDragging) {
      dragStarted.current = true;
      setHoverOpen(false);
      setZonePickerOpen(false);
    }
    if (isDraggingGlobal) {
      setHoverOpen(false);
      setZonePickerOpen(false);
    }
  }, [isDragging, isDraggingGlobal]);

  // On drag end, reset flag after a tick so the click handler can check it
  useEffect(() => {
    if (!isDragging && dragStarted.current) {
      setTimeout(() => { dragStarted.current = false; }, 100);
    }
  }, [isDragging]);

  const listPrice = product.cost_excl_vat || 0;
  const markupPct = product.default_markup_percent ?? product.markup_percent ?? 35;
  const supplierCode = resolveSupplierCode(product.supplier_name);
  const computed = computePricing(supplierCode, listPrice, markupPct, product.cost_price || null);
  const price = computed.sellExVat;
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

  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // Don't open zone picker if we just finished dragging or if star/other button was clicked
    if (dragStarted.current || e.defaultPrevented) return;
    if (!baskets || baskets.length === 0 || !onAddProductToBasket) return;
    // If only one zone, add directly
    if (baskets.length === 1) {
      onAddProductToBasket(baskets[0].id, product);
      return;
    }
    setZonePickerOpen(true);
  }, [baskets, onAddProductToBasket, product]);

  return (
    <>
      <Popover open={zonePickerOpen} onOpenChange={setZonePickerOpen}>
        <PopoverTrigger asChild>
          <div>
            <HoverCard
              openDelay={400}
              closeDelay={100}
              open={isDraggingGlobal || zonePickerOpen ? false : hoverOpen}
              onOpenChange={setHoverOpen}
            >
              <HoverCardTrigger asChild>
                <div
                  ref={setNodeRef}
                  onClick={handleCardClick}
                  style={{ pointerEvents: isDraggingGlobal && !isDragging ? "none" : "auto" }}
                  className={`group relative flex items-start gap-2.5 rounded-lg border bg-card p-2.5 cursor-pointer transition-all hover:shadow-md hover:border-primary/20 ${
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
                    {(() => {
                      const brief = getProductBriefDescription(product);
                      return brief ? (
                        <p className="text-[9px] text-muted-foreground truncate mt-0.5 leading-tight">
                          {brief}
                        </p>
                      ) : null;
                    })()}
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <div className="flex flex-col">
                        <span className="text-xs font-bold text-foreground">
                          {price > 0 ? `R${price.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "POR"}
                        </span>
                        {price > 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            R{computed.sellInclVat.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} incl
                          </span>
                        )}
                      </div>
                      {product.sold_in_length && product.price_per_metre && (
                        <Badge
                          variant="outline"
                          className="text-[8px] px-1 py-0 h-3.5 gap-0.5 border-orange-400/40 text-orange-600"
                        >
                          <Ruler className="h-2 w-2" />R{product.price_per_metre.toFixed(2)}/m
                        </Badge>
                      )}
                      {product.supplier_name &&
                        product.supplier_name.toLowerCase() !== (product.brand || "").toLowerCase() && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                            {product.supplier_name}
                          </Badge>
                        )}
                      {usageCount > 5 && (
                        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5">
                          Used {usageCount}x
                        </Badge>
                      )}
                      {markupPct > 0 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 text-primary">
                          {markupPct.toFixed(0)}% M/Up
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div
                      {...attributes}
                      {...listeners}
                      style={{ touchAction: "none" }}
                      onClick={(e) => e.stopPropagation()}
                      title="Drag to add"
                      className="p-1 -m-0.5 rounded cursor-grab active:cursor-grabbing"
                    >
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
              <HoverCardContent side="right" className="w-72 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className={`rounded-md p-1 ${catBg}`}>{getCategoryIcon(product.product_category, "h-3.5 w-3.5")}</div>
                  <p className="font-semibold">{getProductDisplayName(product)}</p>
                </div>
                <p className="font-mono font-medium text-primary/80">{product.product_code}</p>
                {(() => {
                  const cp = computed.costExVat;
                  const sp = computed.sellExVat;
                  const spInclVat = computed.sellInclVat;
                  const bakedMarkup = computed.markupPercent;
                  return (
                    <>
                      {computed.discountPercent > 0 && (
                        <div className="flex justify-between text-muted-foreground">
                          <span>List Price (excl VAT)</span>
                          <span className="line-through">R{listPrice.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Cost (excl VAT){computed.discountPercent > 0 ? ` (-${computed.discountPercent}%)` : ""}</span>
                        <span className="font-medium">R{cp.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Selling (excl VAT)</span>
                        <span className="font-bold">R{sp.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Selling (incl VAT)</span>
                        <span className="font-semibold text-muted-foreground">R{spInclVat.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t">
                        <span className="text-muted-foreground">Markup</span>
                        <span className="font-mono font-bold text-primary">
                          {bakedMarkup.toFixed(1)}%
                        </span>
                      </div>
                    </>
                  );
                })()}
                <p className="text-[10px] text-muted-foreground line-clamp-3">{product.description}</p>
                <Badge variant="outline" className="text-[10px]">
                  {product.supplier_name}
                </Badge>
              </HoverCardContent>
            </HoverCard>
          </div>
        </PopoverTrigger>
        <PopoverContent side="right" align="start" className="w-48 p-2" data-no-dnd="true">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
            <MapPin className="h-3 w-3 inline mr-1" />Add to Zone
          </p>
          <div className="space-y-1">
            {(baskets || []).map((basket) => (
              <Button
                key={basket.id}
                variant="outline"
                size="sm"
                className="w-full justify-start text-xs h-7 gap-1.5"
                onClick={() => {
                  onAddProductToBasket?.(basket.id, product);
                  setZonePickerOpen(false);
                }}
              >
                <Package className="h-3 w-3 text-primary shrink-0" />
                <span className="truncate">{basket.name}</span>
                <Badge variant="secondary" className="text-[8px] px-1 py-0 ml-auto shrink-0">
                  {basket.items.length}
                </Badge>
              </Button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

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

/** Convert a PdfSelectedProduct into a PaletteProduct for drag-and-drop */
function pdfItemToPaletteProduct(item: import("@/types/pdfSelection").PdfSelectedProduct): PaletteProduct {
  const price = parseFloat(item.price) || 0;
  return {
    id: `pdf-${item.code}`,
    product_code: item.code,
    short_name: item.description || item.code,
    brand: "",
    product_category: "",
    category: "",
    cost_excl_vat: item.costPrice ?? price,
    cost_incl_vat: price,
    cost_price: item.costPrice ?? price,
    selling_price: price,
    default_markup_percent: item.markupPercent ?? 0.35,
    description: item.description || item.code,
    is_pinned: false,
    pin_order: null,
    supplier_name: "",
    supplier_type: "",
    price_per_metre: null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: null,
    markup_percent: item.markupPercent ?? 0.35,
  };
}

function DraggableSelectedItem({
  item,
  pdfSelection,
  baskets,
  onAddProductToBasket,
}: {
  item: import("@/types/pdfSelection").PdfSelectedProduct;
  pdfSelection: PdfSelectionHandlers;
  baskets?: Basket[];
  onAddProductToBasket?: (basketId: string, product: PaletteProduct) => void;
}) {
  const product = useMemo(() => pdfItemToPaletteProduct(item), [item]);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `selected-pdf-${item.code}`,
    data: { product },
  });

  const handleClick = useCallback(() => {
    if (!baskets || baskets.length === 0 || !onAddProductToBasket) return;
    onAddProductToBasket(baskets[0].id, product);
  }, [baskets, onAddProductToBasket, product]);

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ touchAction: "none" }}
      className={`bg-muted/50 p-2 rounded-md space-y-1 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:border-primary/20 border border-transparent ${
        isDragging ? "opacity-40 scale-95 shadow-lg" : ""
      }`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1.5">
        <GripVertical className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        <button
          onClick={(e) => { e.stopPropagation(); pdfSelection.handleSelectProduct(item); }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="shrink-0 flex items-center justify-center rounded-full transition-colors hover:scale-110"
          title="Unselect item"
        >
          <CheckCircle2 className="h-4 w-4" style={{ color: "hsl(var(--success))" }} />
        </button>
        <p className="text-[11px] font-medium text-foreground truncate flex-1">{item.code}</p>
      </div>
      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
      {(item.costPrice != null || item.markupPercent != null) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {item.costPrice != null && (
            <span>Cost: <span className="font-mono font-medium text-foreground">R{Number(item.costPrice).toFixed(2)}</span></span>
          )}
          {item.markupPercent != null && item.costPrice != null && (
            <div className="flex items-center gap-0.5">
              <span>M/Up:</span>
              <button
                className="h-4 w-4 rounded border border-input flex items-center justify-center hover:bg-accent"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const cost = Number(item.costPrice);
                  const newMu = Math.max(0, (item.markupPercent || 0) - 5);
                  const newP = Math.round(cost * (1 + newMu / 100) * 100) / 100;
                  pdfSelection.updateSelectedItem(item.code, { markupPercent: newMu, price: String(newP) });
                }}
              >
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              <span className="font-mono font-semibold text-primary min-w-[28px] text-center">{Number(item.markupPercent).toFixed(0)}%</span>
              <button
                className="h-4 w-4 rounded border border-input flex items-center justify-center hover:bg-accent"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  const cost = Number(item.costPrice);
                  const newMu = (item.markupPercent || 0) + 5;
                  const newP = Math.round(cost * (1 + newMu / 100) * 100) / 100;
                  pdfSelection.updateSelectedItem(item.code, { markupPercent: newMu, price: String(newP) });
                }}
              >
                <ChevronUp className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <select
          value={item.unitType}
          onChange={(e) => pdfSelection.updateSelectedItem(item.code, { unitType: e.target.value })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="h-6 text-[10px] rounded border border-input bg-background px-1"
        >
          <option value="units">Units</option>
          <option value="meters">Meters</option>
        </select>
        <Input
          type="number"
          min={0.1}
          step={0.1}
          value={item.quantity}
          onChange={(e) => pdfSelection.updateSelectedItem(item.code, { quantity: Math.max(0.1, Number(e.target.value)) })}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="h-6 w-16 text-[10px] px-1"
        />
        <span className="text-[10px] font-medium text-foreground ml-auto">
          R{((parseFloat(item.price) || 0) * item.quantity).toFixed(2)}
        </span>
      </div>
    </div>
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
  onAddBundleToBasket,
  onOpenVisualPanel,
  pdfSelection,
  onPopOutSelected,
}: ProductPaletteProps) => {
  const [selectedCollapsed, setSelectedCollapsed] = useState(false);
  const recentIds = useMemo(() => getRecentProductIds(), [products]);
  const filteredProducts = useMemo(() => {
    let result = products;
    if (categoryFilter === "favorites") {
      result = result.filter((p) => favorites.has(p.id));
    } else if (categoryFilter === "recent") {
      const idSet = new Set(recentIds);
      result = result
        .filter((p) => idSet.has(p.id))
        .sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
    }
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
      result = result.filter((p) => {
        const blob = [
          p.product_code,
          p.short_name,
          p.brand,
          p.description,
          p.category,
          p.product_category,
          p.supplier_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return allTermsMatchBlob(terms, blob);
      });
    }
    return result;
  }, [products, categoryFilter, favorites, recentIds, searchQuery]);

  // Sort: favorites first, then by usage count DESC, then alphabetical
  const sortedProducts = useMemo(() => {
    return [...filteredProducts].sort((a, b) => {
      const aFav = favorites.has(a.id) ? 1 : 0;
      const bFav = favorites.has(b.id) ? 1 : 0;
      if (aFav !== bFav) return bFav - aFav;
      const aUsage = usageMap[a.id] || 0;
      const bUsage = usageMap[b.id] || 0;
      if (aUsage !== bUsage) return bUsage - aUsage;
      return getProductDisplayName(a).localeCompare(getProductDisplayName(b));
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

  // Filter bundles by search and category (show in All, Favs, AC)
  const filteredBundles = useMemo(() => {
    // Show bundles in all, favorites, and AC tabs
    const allowedTabs = ["all", "favorites", "Air Conditioning"];
    if (!allowedTabs.includes(categoryFilter)) return [];
    
    let filtered = bundles;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = bundles.filter((b) => {
        if (b.name.toLowerCase().includes(q)) return true;
        return b.items.some((item) => {
          if (!item.product) return false;
          const blob = [item.product.product_code, item.product.short_name, item.product.description]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return blob.includes(q);
        });
      });
    }
    
    // For AC tab, only show bundles with AC-related items
    if (categoryFilter === "Air Conditioning") {
      filtered = filtered.filter((b) =>
        b.items.some((item) => item.product?.product_category === "Air Conditioning")
      );
    }
    
    return filtered;
  }, [bundles, searchQuery, categoryFilter]);

  return (
    <div
      className="flex flex-col rounded-lg border bg-card overflow-hidden h-full min-h-0"
    >
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

        {
          <>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                className="pl-8 pr-8 h-8 text-xs"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => onSearchChange("")}
                  className="absolute right-2 top-1.5 p-0.5 rounded hover:bg-muted text-muted-foreground"
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
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
        }
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="p-2 space-y-3">
          {/* Bundles as compact buttons */}
          {filteredBundles.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
                📦 Bundles ({filteredBundles.length})
              </p>
              <div className="space-y-1">
                {filteredBundles.map((bundle) => (
                  <BundlePaletteButton
                    key={bundle.id}
                    bundle={bundle}
                    searchTerm={searchQuery}
                    isDraggingGlobal={isDraggingGlobal}
                    baskets={baskets}
                    onAddBundleToBasket={onAddBundleToBasket}
                  />
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)
          ) : sortedProducts.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {searchQuery.trim()
                ? "No products match your search"
                : categoryFilter === "favorites"
                ? "No favorites yet — star products to add them"
                : categoryFilter === "recent"
                ? "No recently used products"
                : "No products found"}
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
                      baskets={baskets}
                      onAddProductToBasket={onAddProductToBasket}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Selected Items from PDF — collapsible + pop-out */}
      {pdfSelection && (
        <div className="border-t mt-2 pt-2 px-2 pb-2">
          <div className="flex items-center gap-1.5 mb-2">
            <button
              onClick={() => setSelectedCollapsed(!selectedCollapsed)}
              className="text-xs font-semibold text-foreground hover:text-primary flex items-center gap-1"
              title={selectedCollapsed ? "Expand selected PDF items" : "Collapse selected PDF items"}
            >
              {selectedCollapsed ? (
                <ChevronRight className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronDown className="h-3 w-3 shrink-0" />
              )}
              Selected Items
            </button>
            <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
              {pdfSelection.selectedFromPdf.length}
            </Badge>
            {pdfSelection.selectedFromPdf.length > 0 && (
              <button
                onClick={() => pdfSelection.setSelectedFromPdf([])}
                className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
                title="Clear all selected items"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => onPopOutSelected?.()}
              className="ml-auto text-muted-foreground hover:text-primary"
              title="Pop out as floating panel"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </div>
          {!selectedCollapsed && (
            <>
              {pdfSelection.selectedFromPdf.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic text-center py-3">
                  Select products from the Visual PDF view
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-1.5">
                   {pdfSelection.selectedFromPdf.map((item) => (
                    <DraggableSelectedItem
                      key={item.code}
                      item={item}
                      pdfSelection={pdfSelection}
                      baskets={baskets}
                      onAddProductToBasket={onAddProductToBasket}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
export { type PaletteBundle };
export default ProductPalette;
