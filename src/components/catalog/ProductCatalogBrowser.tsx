import { useState, useMemo, useEffect } from "react";
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
import {
  Search,
  Package,
  TrendingUp,
  Plus,
  ArrowUpDown,
  Filter,
  Loader2,
  WifiOff,
  Star,
} from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const HVAC_CATEGORIES = [
  "Midwall Inverter",
  "Midwall Fixed Speed",
  "Ducted Inverter",
  "Ducted Fixed Speed",
  "Cassette",
  "Under Ceiling",
  "Window Wall",
  "Portable",
  "Floor Standing",
  "Multi Split",
  "VRF",
];

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

/** Fuse.js multi-token fuzzy search: ALL tokens must match across ANY fields */
function fuseMultiTokenSearch(items: SupplierProduct[], fuse: Fuse<SupplierProduct>, query: string): SupplierProduct[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // For each token, get Fuse results (fuzzy matched items)
  const tokenResults = tokens.map((token) => {
    const results = fuse.search(token);
    return new Map(results.map((r) => [r.item.id, r.score ?? 1]));
  });

  // Find items that appear in ALL token result sets (AND logic)
  const firstSet = tokenResults[0];
  const matchedIds: { id: string; combinedScore: number }[] = [];

  firstSet.forEach((score, id) => {
    let totalScore = score;
    let matchAll = true;
    for (let i = 1; i < tokenResults.length; i++) {
      const s = tokenResults[i].get(id);
      if (s === undefined) {
        matchAll = false;
        break;
      }
      totalScore += s;
    }
    if (matchAll) {
      matchedIds.push({ id, combinedScore: totalScore });
    }
  });

  // Sort by combined score (lower = better match)
  matchedIds.sort((a, b) => a.combinedScore - b.combinedScore);

  const itemMap = new Map(items.map((p) => [p.id, p]));
  return matchedIds.map((m) => itemMap.get(m.id)!).filter(Boolean);
}

const ProductCatalogBrowser = ({ onAddToQuote, supplierId }: ProductCatalogBrowserProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("__all__");
  const [sortBy, setSortBy] = useState<"pinned" | "usage" | "price_asc" | "price_desc" | "name">("pinned");
  const [showArchived, setShowArchived] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = () => setIsOffline(!navigator.onLine);
    window.addEventListener("online", handler);
    window.addEventListener("offline", handler);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener("online", handler);
      window.removeEventListener("offline", handler);
    };
  }, []);

  // Fetch ALL products (no search filter — searching is done client-side with Fuse.js)
  const { data: allProducts = [], isLoading } = useQuery({
    queryKey: ["supplier-products-all", supplierId, showArchived],
    queryFn: async () => {
      try {
        const { data, error } = await supabase.rpc("search_supplier_products", {
          p_query: null,
          p_category: null,
          p_supplier_id: supplierId || null,
          p_limit: 2000,
          p_include_archived: showArchived,
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

  // Build Fuse index over all products
  const fuse = useMemo(
    () =>
      new Fuse(allProducts, {
        keys: [
          { name: "product_code", weight: 2 },
          { name: "short_name", weight: 2 },
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
    [allProducts]
  );

  // Apply client-side fuzzy search + category filter
  const filtered = useMemo(() => {
    let results: SupplierProduct[];

    if (searchQuery.trim().length > 0) {
      results = fuseMultiTokenSearch(allProducts, fuse, searchQuery);
    } else {
      results = allProducts;
    }

    // Category filter
    if (selectedCategory !== "__all__") {
      results = results.filter((p) => p.category === selectedCategory);
    }

    return results;
  }, [allProducts, fuse, searchQuery, selectedCategory]);

  const { data: categories = [] } = useQuery({
    queryKey: ["product-categories", showArchived],
    queryFn: async () => {
      let query = supabase
        .from("supplier_products" as any)
        .select("category")
        .eq("is_active", true)
        .order("category");
      if (!showArchived) {
        query = query.eq("archived", false);
      }
      const { data, error } = await query;
      if (error) throw error;
      const dbCategories = [...new Set((data || []).map((d: any) => d.category))].filter(Boolean) as string[];
      const allCategories = [...new Set([...HVAC_CATEGORIES, ...dbCategories])];
      return allCategories.sort();
    },
  });

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const pinnedSort = (a: SupplierProduct, b: SupplierProduct) => {
      const aPinned = (a as any).is_pinned ? 1 : 0;
      const bPinned = (b as any).is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      if (aPinned && bPinned) return ((a as any).pin_order || 0) - ((b as any).pin_order || 0);
      return 0;
    };

    // If there's a search query, preserve fuzzy relevance order (just pin pinned to top)
    if (searchQuery.trim().length > 0) {
      return arr.sort(pinnedSort);
    }

    switch (sortBy) {
      case "price_asc": return arr.sort((a, b) => pinnedSort(a, b) || a.cost_price - b.cost_price);
      case "price_desc": return arr.sort((a, b) => pinnedSort(a, b) || b.cost_price - a.cost_price);
      case "name": return arr.sort((a, b) => pinnedSort(a, b) || a.description.localeCompare(b.description));
      case "usage": return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
      case "pinned":
      default: return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
    }
  }, [filtered, sortBy, searchQuery]);

  const pinnedCount = useMemo(() => filtered.filter(p => (p as any).is_pinned).length, [filtered]);

  const unarchiveMutation = useMutation({
    mutationFn: async (productId: string) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ archived: false, archived_at: null } as any).eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
      toast({ title: "Product unarchived" });
    },
  });

  const togglePinMutation = useMutation({
    mutationFn: async ({ productId, isPinned }: { productId: string; isPinned: boolean }) => {
      const { error } = await supabase.from("supplier_products" as any)
        .update({ is_pinned: !isPinned, pin_order: isPinned ? 0 : Date.now() } as any)
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
    },
  });

  const incrementUsageMutation = useMutation({
    mutationFn: async (productId: string) => {
      await supabase.rpc("increment_product_usage", { p_product_id: productId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
  });

  const handleAddToQuote = (product: SupplierProduct) => {
    if (onAddToQuote) {
      onAddToQuote({
        description: `${product.product_code} - ${product.description}`,
        quantity: 1,
        unit_price: product.selling_price,
      });
      incrementUsageMutation.mutate(product.id);
      toast({ title: "Added to quote", description: product.product_code });
    }
  };

  return (
    <div className="space-y-4">
      {isOffline && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg px-3 py-2 text-xs">
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          Browsing offline cache
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products, codes, brands... (fuzzy)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className={isMobile ? "flex-1" : "w-48"}>
              <Filter className="h-3 w-3 mr-1" />
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            const isPinned = !!(product as any).is_pinned;
            return (
              <Card
                key={product.id}
                className={`hover:shadow-md transition-shadow active:scale-[0.99] cursor-pointer ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""}`}
                onClick={() => setSelectedProduct(product)}
              >
                <CardContent className={isMobile ? "p-3" : "p-4"}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex-1 min-w-0">
                      {(product as any).short_name && (
                        <p className={`font-bold text-primary ${isMobile ? "text-sm" : "text-base"} ${(product as any).archived ? "line-through" : ""}`}>
                          {(product as any).short_name}
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
                          <TrendingUp className="h-3 w-3 mr-0.5" />
                          {product.quote_usage_count}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mb-2">
                    {(product as any).archived && (
                      <Badge variant="destructive" className="text-[10px]">Archived</Badge>
                    )}
                    <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                    {product.btu_rating && (
                      <Badge variant="outline" className="text-[10px]">{(product.btu_rating / 1000).toFixed(0)}K BTU</Badge>
                    )}
                    {product.refrigerant_type && (
                      <Badge variant="outline" className="text-[10px]">{product.refrigerant_type}</Badge>
                    )}
                    {product.pipe_size && (
                      <Badge variant="outline" className="text-[10px]">⌀ {product.pipe_size}</Badge>
                    )}
                  </div>

                  <Separator className="mb-2" />

                  <div className="flex items-end justify-between">
                    <div>
                      {product.is_price_on_request ? (
                        <p className="text-sm font-semibold text-muted-foreground">POR</p>
                      ) : (
                        <>
                          <p className="text-[10px] text-muted-foreground">Cost: {formatZAR(product.cost_price)}</p>
                          {(product as any).rrp && (product as any).rrp > product.selling_price && (
                            <p className="text-[10px] text-muted-foreground line-through">{formatZAR((product as any).rrp)}</p>
                          )}
                          <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`h-7 w-7 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                        onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                      >
                        <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
                      </Button>
                      {(product as any).archived ? (
                        <Button
                          size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); unarchiveMutation.mutate(product.id); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >
                          Unarchive
                        </Button>
                      ) : onAddToQuote && !product.is_price_on_request ? (
                        <Button
                          size="sm"
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
