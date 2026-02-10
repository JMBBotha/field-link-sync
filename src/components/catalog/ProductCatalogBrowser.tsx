import { useState, useMemo, useEffect, useCallback } from "react";
import Fuse from "fuse.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { offlineDb } from "@/lib/offlineDb";
import ProductDetailModal from "./ProductDetailModal";
import CatalogFilterBar, { CatalogFilters, DEFAULT_FILTERS, FilterCounts } from "./CatalogFilterBar";
import CatalogSearchSuggestions from "./CatalogSearchSuggestions";
import {
  Search,
  Package,
  TrendingUp,
  Plus,
  ArrowUpDown,
  Loader2,
  WifiOff,
  Star,
} from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface SupplierProduct {
  id: string;
  supplier_id: string;
  supplier_name: string;
  product_code: string;
  description: string;
  category: string;
  subcategory: string | null;
  pipe_size: string | null;
  cost_price: number;
  default_markup_percent: number;
  selling_price: number;
  is_price_on_request: boolean;
  btu_rating: number | null;
  refrigerant_type: string | null;
  image_url: string | null;
  quote_usage_count: number;
  last_quoted_at: string | null;
  search_rank: number;
  short_name?: string | null;
  is_pinned?: boolean;
  pin_order?: number;
  rrp?: number | null;
  cost_excl_vat?: number | null;
  cost_incl_vat?: number | null;
}

interface ProductCatalogBrowserProps {
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
  supplierId?: string | null;
}

// ── Derived filter helpers ──────────────────────────────
function deriveSpeedType(p: SupplierProduct): string {
  const text = `${p.category} ${p.description} ${p.short_name || ""}`.toLowerCase();
  if (text.includes("inverter") || text.includes("inv ")) return "Inverter";
  if (text.includes("fixed speed") || text.includes("fs ")) return "Fixed Speed";
  return "";
}

function deriveUnitType(p: SupplierProduct): string {
  const text = `${p.category} ${p.description} ${p.short_name || ""}`.toLowerCase();
  const map: [string, string][] = [
    ["midwall", "Midwall"], ["cassette", "Cassette"], ["ducted", "Ducted"],
    ["under ceiling", "Under Ceiling"], ["floor standing", "Floor Standing"],
    ["window wall", "Window Wall"], ["portable", "Portable"],
    ["rooftop", "Rooftop Package"], ["chiller", "Air Cooled Chiller"],
    ["accessor", "Accessories"], ["large ducted", "Large Ducted"],
  ];
  for (const [kw, label] of map) {
    if (text.includes(kw)) return label;
  }
  return "";
}

function derivePhase(p: SupplierProduct): string {
  const text = `${p.product_code} ${p.description}`.toLowerCase();
  if (text.includes("3ph") || text.includes("three phase") || text.includes("3-phase")) return "3Ph";
  if (text.includes("1ph") || text.includes("single phase") || text.includes("1-phase")) return "1Ph";
  return "";
}

function deriveBrand(p: SupplierProduct): string {
  const code = (p.product_code || "").toUpperCase();
  const desc = (p.description || "").toLowerCase();
  if (code.startsWith("FOUR") || desc.includes("alliance")) return "Alliance";
  return "Midea";
}

function derivePipeSize(p: SupplierProduct): string {
  return (p.pipe_size || "").trim();
}

/** Build a synthetic search string with BTU variants and normalized brand for better Fuse.js matching */
function buildSearchBlob(p: SupplierProduct): string {
  const parts = [p.product_code, p.short_name || "", p.description, p.category, p.subcategory || "", p.supplier_name, p.refrigerant_type || "", p.pipe_size || ""];
  const brand = deriveBrand(p);
  parts.push(brand);
  if (p.btu_rating) {
    const k = Math.round(p.btu_rating / 1000);
    parts.push(`${k}K`, `${p.btu_rating}`);
  }
  return parts.join(" ");
}

function deriveBtuBucket(p: SupplierProduct): string {
  const btu = p.btu_rating;
  if (!btu) return "";
  const k = btu / 1000;
  if (k >= 76) return "76K+";
  const buckets = [9, 12, 18, 24, 34, 36, 48, 60];
  const closest = buckets.reduce((prev, curr) => Math.abs(curr - k) < Math.abs(prev - k) ? curr : prev);
  return `${closest}K`;
}

function matchesFilters(p: SupplierProduct, f: CatalogFilters): boolean {
  if (f.speedType !== "__all__" && deriveSpeedType(p) !== f.speedType) return false;
  if (f.unitType !== "__all__" && deriveUnitType(p) !== f.unitType) return false;
  if (f.btu !== "__all__" && deriveBtuBucket(p) !== f.btu) return false;
  if (f.refrigerant !== "__all__" && (p.refrigerant_type || "").toUpperCase() !== f.refrigerant.toUpperCase()) return false;
  if (f.phase !== "__all__" && derivePhase(p) !== f.phase) return false;
  if (f.brand !== "__all__" && deriveBrand(p) !== f.brand) return false;
  if (f.pipeSize !== "__all__" && derivePipeSize(p) !== f.pipeSize) return false;
  if (f.priceMin && p.selling_price < parseFloat(f.priceMin)) return false;
  if (f.priceMax && p.selling_price > parseFloat(f.priceMax)) return false;
  return true;
}

// ── Fuse.js multi-token AND search ──────────────────────
function fuseMultiTokenSearch(items: SupplierProduct[], fuse: Fuse<SupplierProduct>, query: string): SupplierProduct[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const tokenResults = tokens.map((token) => {
    const results = fuse.search(token);
    return new Map(results.map((r) => [r.item.id, r.score ?? 1]));
  });

  const firstSet = tokenResults[0];
  const matchedIds: { id: string; combinedScore: number }[] = [];

  firstSet.forEach((score, id) => {
    let totalScore = score;
    let matchAll = true;
    for (let i = 1; i < tokenResults.length; i++) {
      const s = tokenResults[i].get(id);
      if (s === undefined) { matchAll = false; break; }
      totalScore += s;
    }
    if (matchAll) matchedIds.push({ id, combinedScore: totalScore });
  });

  matchedIds.sort((a, b) => a.combinedScore - b.combinedScore);
  const itemMap = new Map(items.map((p) => [p.id, p]));
  return matchedIds.map((m) => itemMap.get(m.id)!).filter(Boolean);
}

// ── Component ───────────────────────────────────────────
const ProductCatalogBrowser = ({ onAddToQuote, supplierId }: ProductCatalogBrowserProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"pinned" | "usage" | "price_asc" | "price_desc" | "name">("pinned");
  const [showArchived, setShowArchived] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null);
  const [filters, setFilters] = useState<CatalogFilters>({ ...DEFAULT_FILTERS });
  const [showSuggestions, setShowSuggestions] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    setIsOffline(!navigator.onLine);
    return () => { window.removeEventListener("online", handler); window.removeEventListener("offline", handler); };
  }, []);

  const { data: allProducts = [], isLoading } = useQuery({
    queryKey: ["supplier-products-all", supplierId, showArchived],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc("search_supplier_products", {
          p_query: null, p_category: null, p_supplier_id: supplierId || null, p_limit: 2000, p_include_archived: showArchived,
        });
        if (error) throw error;
        const results = (data || []) as SupplierProduct[];
        if (results.length > 0) {
          offlineDb.cacheCatalogProducts(results.map(p => ({
            id: p.id, supplier_id: p.supplier_id, supplier_name: p.supplier_name,
            product_code: p.product_code, description: p.description, category: p.category,
            pipe_size: p.pipe_size, cost_price: p.cost_price, selling_price: p.selling_price,
            is_price_on_request: p.is_price_on_request, btu_rating: p.btu_rating,
            refrigerant_type: p.refrigerant_type, quote_usage_count: p.quote_usage_count,
            default_markup_percent: p.default_markup_percent,
          }))).catch(() => {});
        }
        return results;
      } catch {
        const cached = await offlineDb.getCachedCatalogProducts();
        if (cached.length > 0) {
          setIsOffline(true);
          return cached.map(c => ({ ...c, subcategory: null, image_url: null, last_quoted_at: null, search_rank: 0 })) as SupplierProduct[];
        }
        return [];
      }
    },
    staleTime: 60000,
  });

  // Derive available brands from data
  const availableBrands = useMemo(() => {
    const brands = new Set<string>();
    allProducts.forEach((p) => {
      const b = deriveBrand(p);
      if (b) brands.add(b);
    });
    return [...brands];
  }, [allProducts]);

  // Derive available pipe sizes
  const availablePipeSizes = useMemo(() => {
    const sizes = new Set<string>();
    allProducts.forEach((p) => {
      const ps = derivePipeSize(p);
      if (ps) sizes.add(ps);
    });
    return [...sizes].sort();
  }, [allProducts]);

  // Build enriched items for Fuse with a searchBlob field
  const enrichedProducts = useMemo(() =>
    allProducts.map(p => ({ ...p, _searchBlob: buildSearchBlob(p) })),
    [allProducts]
  );

  const fuse = useMemo(
    () => new Fuse(enrichedProducts, {
      keys: [
        { name: "product_code", weight: 2 },
        { name: "short_name", weight: 2 },
        { name: "_searchBlob", weight: 1.5 },
        { name: "description", weight: 1.5 },
        { name: "category", weight: 1 },
        { name: "supplier_name", weight: 1 },
        { name: "subcategory", weight: 0.8 },
        { name: "pipe_size", weight: 0.5 },
        { name: "refrigerant_type", weight: 0.5 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    }),
    [enrichedProducts]
  );

  // Apply search + structured filters with AND logic
  const filtered = useMemo(() => {
    let results: SupplierProduct[];
    if (searchQuery.trim().length > 0) {
      results = fuseMultiTokenSearch(enrichedProducts, fuse, searchQuery);
    } else {
      results = [...allProducts];
    }
    // Apply structured filters
    results = results.filter((p) => matchesFilters(p, filters));
    return results;
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters]);

  // Compute dynamic filter counts: for each filter dimension, count products matching ALL OTHER active filters
  const filterCounts = useMemo<FilterCounts>(() => {
    // Base set: search-filtered products (before structured filters)
    let baseResults: SupplierProduct[];
    if (searchQuery.trim().length > 0) {
      baseResults = fuseMultiTokenSearch(enrichedProducts, fuse, searchQuery);
    } else {
      baseResults = allProducts;
    }

    const countFor = (dimension: keyof CatalogFilters) => {
      const otherFilters = { ...filters, [dimension]: "__all__" };
      // Also reset price filters if checking price dimension
      const pool = baseResults.filter(p => matchesFilters(p, otherFilters));
      const counts: Record<string, number> = {};
      for (const p of pool) {
        let val = "";
        switch (dimension) {
          case "speedType": val = deriveSpeedType(p); break;
          case "unitType": val = deriveUnitType(p); break;
          case "btu": val = deriveBtuBucket(p); break;
          case "refrigerant": val = (p.refrigerant_type || "").toUpperCase(); break;
          case "phase": val = derivePhase(p); break;
          case "brand": val = deriveBrand(p); break;
          case "pipeSize": val = derivePipeSize(p); break;
        }
        if (val) counts[val] = (counts[val] || 0) + 1;
      }
      return counts;
    };

    return {
      speedType: countFor("speedType"),
      unitType: countFor("unitType"),
      btu: countFor("btu"),
      refrigerant: countFor("refrigerant"),
      phase: countFor("phase"),
      brand: countFor("brand"),
      pipeSize: countFor("pipeSize"),
    };
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const pinnedSort = (a: SupplierProduct, b: SupplierProduct) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      if (aPinned && bPinned) return ((a.pin_order || 0) - (b.pin_order || 0));
      return 0;
    };
    if (searchQuery.trim().length > 0) return arr.sort(pinnedSort);
    switch (sortBy) {
      case "price_asc": return arr.sort((a, b) => pinnedSort(a, b) || a.cost_price - b.cost_price);
      case "price_desc": return arr.sort((a, b) => pinnedSort(a, b) || b.cost_price - a.cost_price);
      case "name": return arr.sort((a, b) => pinnedSort(a, b) || a.description.localeCompare(b.description));
      case "usage": return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
      case "pinned":
      default: return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
    }
  }, [filtered, sortBy, searchQuery]);

  const pinnedCount = useMemo(() => filtered.filter(p => p.is_pinned).length, [filtered]);

  const unarchiveMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ archived: false, archived_at: null } as any).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }); toast({ title: "Product unarchived" }); },
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ productId, isPinned }: { productId: string; isPinned: boolean }) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ is_pinned: !isPinned, pin_order: isPinned ? 0 : Date.now() } as any).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
  });

  const incrementUsageMutation = useMutation({
    mutationFn: async (productId: string) => { await supabase.rpc("increment_product_usage", { p_product_id: productId }); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
  });

  const handleAddToQuote = (product: SupplierProduct) => {
    if (onAddToQuote) {
      onAddToQuote({ description: `${product.product_code} - ${product.description}`, quantity: 1, unit_price: product.selling_price });
      incrementUsageMutation.mutate(product.id);
      toast({ title: "Added to quote", description: product.product_code });
    }
  };

  const handleSuggestionFilter = useCallback((action: string) => {
    const [key, value] = action.split(":");
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSearchQuery("");
  }, []);

  return (
    <div className="space-y-3">
      {isOffline && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg px-3 py-2 text-xs">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> Browsing offline cache
        </div>
      )}

      {/* Search bar */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products, codes, brands... (fuzzy)"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            className="pl-9"
          />
          <CatalogSearchSuggestions
            query={searchQuery}
            products={sorted}
            visible={showSuggestions && searchQuery.trim().length > 0}
            onSelectFilter={handleSuggestionFilter}
            onSelectProduct={(id) => { const p = allProducts.find(x => x.id === id); if (p) setSelectedProduct(p); setShowSuggestions(false); }}
            onClose={() => setShowSuggestions(false)}
          />
        </div>
        <div className="flex gap-2">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className={isMobile ? "flex-1" : "w-40"}>
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pinned">Pinned First</SelectItem>
              <SelectItem value="usage">Most Quoted</SelectItem>
              <SelectItem value="price_asc">Price: Low→High</SelectItem>
              <SelectItem value="price_desc">Price: High→Low</SelectItem>
              <SelectItem value="name">Name A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm pb-2 -mx-1 px-1">
        <CatalogFilterBar
          filters={filters}
          onChange={setFilters}
          availableBrands={availableBrands}
          availablePipeSizes={availablePipeSizes}
          totalCount={allProducts.length}
          filteredCount={sorted.length}
          counts={filterCounts}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isLoading ? "Loading products..." : `${sorted.length} products found`}
          {pinnedCount > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" /> {pinnedCount} pinned
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Show Archived</Label>
          <Switch checked={showArchived} onCheckedChange={setShowArchived} />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {searchQuery.trim() ? `No products match "${searchQuery}". Try fewer keywords or check spelling.` : "No products found. Import a price list to get started."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((product) => {
            const isPinned = !!product.is_pinned;
            return (
              <Card
                key={product.id}
                className={`hover:shadow-md transition-shadow active:scale-[0.99] cursor-pointer ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""}`}
                onClick={() => setSelectedProduct(product)}
              >
                <CardContent className={isMobile ? "p-3" : "p-4"}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      {product.short_name && (
                        <p className={`font-bold text-primary ${isMobile ? "text-sm" : "text-base"} ${(product as any).archived ? "line-through" : ""}`}>
                          {product.short_name}
                        </p>
                      )}
                      <p className={`text-xs font-mono text-muted-foreground ${(product as any).archived ? "line-through" : ""}`}>{product.product_code}</p>
                      <p className={`mt-0.5 line-clamp-2 text-muted-foreground ${isMobile ? "text-[11px]" : "text-xs"} ${(product as any).archived ? "line-through" : ""}`}>{product.description}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isPinned && (
                        <Badge variant="secondary" className="text-[10px] px-1">
                          <Star className="h-2.5 w-2.5 fill-current text-amber-500" />
                        </Badge>
                      )}
                      {product.quote_usage_count > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          <TrendingUp className="h-3 w-3 mr-0.5" />{product.quote_usage_count}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-2">
                    {(product as any).archived && <Badge variant="destructive" className="text-[10px]">Archived</Badge>}
                    <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                    {product.btu_rating && <Badge variant="outline" className="text-[10px]">{(product.btu_rating / 1000).toFixed(0)}K BTU</Badge>}
                    {product.refrigerant_type && <Badge variant="outline" className="text-[10px]">{product.refrigerant_type}</Badge>}
                    {product.pipe_size && <Badge variant="outline" className="text-[10px]">⌀ {product.pipe_size}</Badge>}
                  </div>

                  <Separator className="mb-2" />

                  <div className="flex items-end justify-between">
                    <div>
                      {product.is_price_on_request ? (
                        <p className="text-sm font-semibold text-muted-foreground">POR</p>
                      ) : (
                        <>
                          <p className="text-[10px] text-muted-foreground">Cost: {formatZAR(product.cost_price)}</p>
                          {product.rrp && product.rrp > product.selling_price && (
                            <p className="text-[10px] text-muted-foreground line-through">{formatZAR(product.rrp)}</p>
                          )}
                          <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon" variant="ghost"
                        className={`h-7 w-7 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                        onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                      >
                        <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
                      </Button>
                      {(product as any).archived ? (
                        <Button size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); unarchiveMutation.mutate(product.id); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >Unarchive</Button>
                      ) : onAddToQuote && !product.is_price_on_request ? (
                        <Button size="sm"
                          onClick={(e) => { e.stopPropagation(); handleAddToQuote(product); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >
                          <Plus className="h-3 w-3 mr-1" /> Add
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProductDetailModal
        product={selectedProduct}
        open={!!selectedProduct}
        onOpenChange={(o) => !o && setSelectedProduct(null)}
        onAddToQuote={onAddToQuote ? (item) => {
          onAddToQuote(item);
          if (selectedProduct) incrementUsageMutation.mutate(selectedProduct.id);
          toast({ title: "Added to quote" });
          setSelectedProduct(null);
        } : undefined}
      />
    </div>
  );
};

export default ProductCatalogBrowser;
