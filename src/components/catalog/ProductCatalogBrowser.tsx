import { useState, useMemo, useEffect, useCallback, ReactNode, KeyboardEvent } from "react";
import Fuse from "fuse.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { offlineDb } from "@/lib/offlineDb";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import ProductDetailModal from "./ProductDetailModal";
import ProductSlideOverPanel from "./ProductSlideOverPanel";
import ProductCompareTable from "./ProductCompareTable";
import CatalogFilterBar, { CatalogFilters, DEFAULT_FILTERS, DynamicFilterCounts, SortOption } from "./CatalogFilterBar";
import CatalogSearchSuggestions, { FILTER_MATCHERS } from "./CatalogSearchSuggestions";
import BulkActionBar from "../bulk/BulkActionBar";
import {
  deriveSpeedType, deriveUnitType, derivePhase, deriveBrand, derivePipeSize,
  deriveBtuBucket, buildSearchBlob, matchesFilters, preprocessQuery,
  fuseMultiTokenSearch, FUSE_OPTIONS, FUSE_SCORE_THRESHOLD,
  levenshteinDistance, KNOWN_BRANDS, getCategoryPriority, deriveFilterValue,
  type SearchableProduct,
} from "./catalogSearchUtils";
import { getFilterConfig, type ProductCategory } from "./categoryFilterConfig";
import {
  Package,
  TrendingUp,
  Plus,
  Loader2,
  WifiOff,
  Star,
  GitCompareArrows,
  ChevronDown,
  Tags,
  FolderInput,
  ArrowRightLeft,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

/** Highlight matching text segments */
function highlightText(text: string, query: string): ReactNode {
  if (!query.trim() || !text) return text;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const pattern = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const regex = new RegExp(`(${pattern})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} className="bg-accent/40 text-accent-foreground font-medium px-0.5 rounded">{part}</mark>
      : part
  );
}

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
  brand?: string | null;
  product_category?: string | null;
  sold_in_length?: boolean;
  price_per_metre?: number | null;
  unit_length?: number | null;
  discounted_cost?: number | null;
  supplier_discount_percent?: number | null;
}

interface ProductCatalogBrowserProps {
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
  supplierId?: string | null;
  productCategoryFilter?: string;
}

// Derive helpers, preprocessQuery, fuseMultiTokenSearch, buildSearchBlob etc.
// are now imported from ./catalogSearchUtils

// ── Auto-generate short name from product data ──────────
function generateShortName(p: SupplierProduct): string {
  const brand = deriveBrand(p).toUpperCase();
  const btu = p.btu_rating ? `${Math.round(p.btu_rating / 1000)}K` : "";
  const speed = deriveSpeedType(p);
  const speedAbbr = speed === "Inverter" ? "INV" : speed === "Fixed Speed" ? "FS" : "";
  const unit = deriveUnitType(p);
  const unitAbbr = unit ? unit.toUpperCase().slice(0, 3) : "";
  const parts = [brand, btu, speedAbbr, unitAbbr].filter(Boolean);
  return parts.join(" ") || p.product_code;
}

// ── Component ───────────────────────────────────────────
const ProductCatalogBrowser = ({ onAddToQuote, supplierId, productCategoryFilter }: ProductCatalogBrowserProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("pinned");
  const [viewMode, setViewMode] = useState<"grid" | "list" | "grouped">("grid");
  const [showArchived, setShowArchived] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null);
  const [filters, setFilters] = useState<CatalogFilters>({ ...DEFAULT_FILTERS });

  // Reset filters when category changes
  useEffect(() => {
    setFilters({ ...DEFAULT_FILTERS });
  }, [productCategoryFilter]);
  const [panelProductId, setPanelProductId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem("hvacSearchHistory");
      return saved ? JSON.parse(saved).slice(0, 10) : [];
    } catch { return []; }
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // ── Bulk selection state ──
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<"brand" | "category" | "supplier" | "delete" | null>(null);
  const [bulkBrand, setBulkBrand] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkSupplierId, setBulkSupplierId] = useState("");
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const { data: allSuppliers = [] } = useQuery({
    queryKey: ["suppliers-for-move"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const toggleBulkSelect = useCallback((id: string) => {
    setBulkSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // selectAllVisible defined after sorted

  const bulkUpdateMutation = useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Record<string, any> }) => {
      const batchSize = 50;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { error } = await supabase.from("supplier_products" as any)
          .update(updates as any).in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
      queryClient.invalidateQueries({ queryKey: ["product-category-counts"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
      setBulkSelected(new Set());
      setBulkConfirmOpen(false);
      setBulkAction(null);
      toast({ title: "Bulk update complete" });
    },
    onError: (err: any) => toast({ title: "Bulk update failed", description: err.message, variant: "destructive" }),
  });

  const bulkDeleteCountRef = { current: 0 };
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      bulkDeleteCountRef.current = ids.length;
      const batchSize = 50;
      for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const { error } = await supabase.from("supplier_products" as any).delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
      queryClient.invalidateQueries({ queryKey: ["product-category-counts"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      const count = bulkDeleteCountRef.current;
      setBulkSelected(new Set());
      setBulkConfirmOpen(false);
      setBulkAction(null);
      toast({ title: `${count} product${count !== 1 ? "s" : ""} deleted`, description: "The supplier record remains intact." });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const executeBulkAction = () => {
    const ids = [...bulkSelected];
    if (bulkAction === "brand" && bulkBrand) {
      bulkUpdateMutation.mutate({ ids, updates: { brand: bulkBrand } });
    } else if (bulkAction === "category" && bulkCategory) {
      bulkUpdateMutation.mutate({ ids, updates: { product_category: bulkCategory } });
    } else if (bulkAction === "supplier" && bulkSupplierId) {
      bulkUpdateMutation.mutate({ ids, updates: { supplier_id: bulkSupplierId } });
    } else if (bulkAction === "delete") {
      bulkDeleteMutation.mutate(ids);
    }
  };

  const supplierNameForBulk = useMemo(() => {
    if (!supplierId) return "";
    return allSuppliers.find(s => s.id === supplierId)?.name || "";
  }, [supplierId, allSuppliers]);

  const bulkConfirmMessage = bulkAction === "brand"
    ? `Change brand to "${bulkBrand}" for ${bulkSelected.size} products?`
    : bulkAction === "category"
    ? `Change category to "${bulkCategory}" for ${bulkSelected.size} products?`
    : bulkAction === "supplier"
    ? `Move ${bulkSelected.size} products to "${allSuppliers.find(s => s.id === bulkSupplierId)?.name}"?`
    : bulkAction === "delete"
    ? `Delete ${bulkSelected.size} product${bulkSelected.size !== 1 ? "s" : ""}? This will permanently remove these products but keep the supplier${supplierNameForBulk ? ` (${supplierNameForBulk})` : ""} intact.`
    : "";

  const addToHistory = useCallback((term: string) => {
    const t = term.trim();
    if (!t || t.length < 2) return;
    setSearchHistory(prev => {
      const deduped = [t, ...prev.filter(h => h.toLowerCase() !== t.toLowerCase())].slice(0, 10);
      try { localStorage.setItem("hvacSearchHistory", JSON.stringify(deduped)); } catch {}
      return deduped;
    });
  }, []);

  const removeFromHistory = useCallback((term: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h !== term);
      try { localStorage.setItem("hvacSearchHistory", JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

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
        let query = (supabase.from("supplier_products") as any)
          .select("*, suppliers(name)");
        if (supplierId) query = query.eq("supplier_id", supplierId);
        if (!showArchived) query = query.or("archived.is.null,archived.eq.false");
        query = query.limit(2000);
        const { data, error } = await query;
        if (error) throw error;
        const results = ((data || []) as any[]).map((p: any) => ({
          ...p,
          supplier_name: p.suppliers?.name || "",
          product_category: p.product_category || p.category || "",
        })) as SupplierProduct[];
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
      threshold: 0.35,
      ignoreLocation: true,
      includeScore: true,
      minMatchCharLength: 2,
    }),
    [enrichedProducts]
  );

  // Smart preprocessing: extract filter terms from search query
  const preprocessed = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return preprocessQuery(searchQuery, filters);
  }, [searchQuery, filters]);

  // Auto-apply extracted filters (debounced via effect)
  useEffect(() => {
    if (!preprocessed) return;
    const { autoFilters, autoSort } = preprocessed;
    if (Object.keys(autoFilters).length === 0 && !autoSort) return;
    // Only apply once per query change - check if filters differ
    let shouldUpdate = false;
    const newFilters = { ...filters };
    for (const [key, value] of Object.entries(autoFilters)) {
      if (filters[key as keyof CatalogFilters] !== value) {
        (newFilters as any)[key] = value;
        shouldUpdate = true;
      }
    }
    if (shouldUpdate) setFilters(newFilters);
    if (autoSort && sortBy !== autoSort) setSortBy(autoSort);
    // Update the search query to the cleaned version
    if (preprocessed.cleanedQuery !== searchQuery.trim()) {
      setSearchQuery(preprocessed.cleanedQuery);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preprocessed?.cleanedQuery]);

  // Apply search + structured filters with AND→OR logic
  const filtered = useMemo(() => {
    let results: SupplierProduct[];
    const effectiveQuery = searchQuery.trim();
    if (effectiveQuery.length > 0) {
      results = fuseMultiTokenSearch(enrichedProducts, fuse, effectiveQuery);
    } else {
      results = [...allProducts];
    }
    // Apply product category filter
    if (productCategoryFilter) {
      results = results.filter((p) => p.product_category === productCategoryFilter);
    }
    // Apply structured filters
    results = results.filter((p) => matchesFilters(p, filters));
    return results;
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters, productCategoryFilter]);

  // Determine effective category for filter config
  const effectiveCategory: ProductCategory = productCategoryFilter as ProductCategory || "all";
  const filterDimensions = useMemo(() => getFilterConfig(effectiveCategory), [effectiveCategory]);

  // Compute dynamic filter counts: for each filter dimension, count products matching ALL OTHER active filters + search
  const filterCounts = useMemo<DynamicFilterCounts>(() => {
    let baseResults: SupplierProduct[];
    const effectiveQuery = searchQuery.trim();
    if (effectiveQuery.length > 0) {
      baseResults = fuseMultiTokenSearch(enrichedProducts, fuse, effectiveQuery);
    } else {
      baseResults = allProducts;
    }

    // Apply product category filter to base
    let categoryFiltered = baseResults;
    if (productCategoryFilter) {
      categoryFiltered = baseResults.filter((p) => p.product_category === productCategoryFilter);
    }

    const result: DynamicFilterCounts = {};
    for (const dim of filterDimensions) {
      const otherFilters = { ...filters, [dim.key]: "__all__" };
      const pool = categoryFiltered.filter(p => matchesFilters(p, otherFilters));
      const counts: Record<string, number> = {};
      for (const p of pool) {
        const val = deriveFilterValue(p, dim.key);
        if (val) counts[val] = (counts[val] || 0) + 1;
      }
      result[dim.key] = counts;
    }
    return result;
  }, [allProducts, enrichedProducts, fuse, searchQuery, filters, filterDimensions, productCategoryFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const pinnedSort = (a: SupplierProduct, b: SupplierProduct) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      if (aPinned && bPinned) return ((a.pin_order || 0) - (b.pin_order || 0));
      return 0;
    };
    switch (sortBy) {
      case "price_asc": return arr.sort((a, b) => pinnedSort(a, b) || a.selling_price - b.selling_price);
      case "price_desc": return arr.sort((a, b) => pinnedSort(a, b) || b.selling_price - a.selling_price);
      case "btu_asc": return arr.sort((a, b) => pinnedSort(a, b) || (a.btu_rating || 0) - (b.btu_rating || 0));
      case "btu_desc": return arr.sort((a, b) => pinnedSort(a, b) || (b.btu_rating || 0) - (a.btu_rating || 0));
      case "name": return arr.sort((a, b) => pinnedSort(a, b) || a.description.localeCompare(b.description));
      case "pinned":
      default: return arr.sort((a, b) => pinnedSort(a, b) || b.quote_usage_count - a.quote_usage_count);
    }
  }, [filtered, sortBy]);

  const pinnedCount = useMemo(() => filtered.filter(p => p.is_pinned).length, [filtered]);

  const selectAllVisible = useCallback(() => {
    setBulkSelected(new Set(sorted.map(p => p.id)));
  }, [sorted]);

  const preferredBrand = useMemo(() => {
    if (!supplierId) return "";
    const sp = allProducts.find(p => p.supplier_id === supplierId);
    return sp ? deriveBrand(sp) : "";
  }, [supplierId, allProducts]);

  const groupedData = useMemo(() => {
    if (viewMode !== "grouped") return [];
    const brandMap = new Map<string, Map<string, SupplierProduct[]>>();
    for (const p of sorted) {
      const brand = deriveBrand(p);
      const category = p.category || "Uncategorized";
      if (!brandMap.has(brand)) brandMap.set(brand, new Map());
      const catMap = brandMap.get(brand)!;
      if (!catMap.has(category)) catMap.set(category, []);
      catMap.get(category)!.push(p);
    }
    const brandEntries = Array.from(brandMap.entries()).sort((a, b) => {
      if (a[0] === preferredBrand) return -1;
      if (b[0] === preferredBrand) return 1;
      return a[0].localeCompare(b[0]);
    });
    return brandEntries.map(([brand, catMap]) => {
      const cats = Array.from(catMap.entries())
        .sort((a, b) => getCategoryPriority(a[0]) - getCategoryPriority(b[0]) || a[0].localeCompare(b[0]));
      return { brand, categories: cats.map(([cat, products]) => ({ category: cat, products })) };
    });
  }, [sorted, viewMode, preferredBrand]);

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
      const pinOrder = isPinned ? 0 : Math.floor(Date.now() / 1000) % 2000000000;
      const { error } = await supabase.from("supplier_products" as any)
        .update({ is_pinned: !isPinned, pin_order: pinOrder } as any).eq("id", productId);
      if (error) throw error;
    },
    onMutate: async ({ productId, isPinned }) => {
      await queryClient.cancelQueries({ queryKey: ["supplier-products-all"] });
      queryClient.setQueriesData<SupplierProduct[]>(
        { queryKey: ["supplier-products-all"] },
        (old) => old?.map((p) => p.id === productId ? { ...p, is_pinned: !isPinned } : p)
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] }),
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

  // ── Slide-over panel helpers ──
  const panelProduct = useMemo(() => panelProductId ? sorted.find(p => p.id === panelProductId) || null : null, [panelProductId, sorted]);
  const panelIndex = useMemo(() => panelProductId ? sorted.findIndex(p => p.id === panelProductId) : -1, [panelProductId, sorted]);

  const openPanel = useCallback((product: SupplierProduct) => {
    setPanelProductId(product.id);
    setPanelOpen(true);
  }, []);

  const navigatePanel = useCallback((dir: 1 | -1) => {
    const newIdx = panelIndex + dir;
    if (newIdx >= 0 && newIdx < sorted.length) {
      setPanelProductId(sorted[newIdx].id);
    }
  }, [panelIndex, sorted]);

  // ── Compare helpers ──
  const toggleCompare = useCallback((productId: string) => {
    setCompareIds(prev => {
      if (prev.includes(productId)) return prev.filter(id => id !== productId);
      if (prev.length >= 4) { toast({ title: "Compare limit", description: "Maximum 4 products" }); return prev; }
      return [...prev, productId];
    });
  }, [toast]);

  const compareProducts = useMemo(() => compareIds.map(id => allProducts.find(p => p.id === id)).filter(Boolean) as SupplierProduct[], [compareIds, allProducts]);

  // ── Image Enhancement ──
  const [enhancingIds, setEnhancingIds] = useState<Set<string>>(new Set());
  const [bulkEnhancing, setBulkEnhancing] = useState(false);

  const enhanceProductImage = useCallback(async (productId: string, imageUrl: string) => {
    setEnhancingIds(prev => new Set(prev).add(productId));
    try {
      const { data, error } = await supabase.functions.invoke("enhance-image", {
        body: { image_url: imageUrl },
      });
      if (error) throw error;
      if (!data?.enhanced_url) throw new Error("No enhanced URL returned");
      const { error: updateErr } = await (supabase.from("supplier_products") as any)
        .update({ image_url: data.enhanced_url })
        .eq("id", productId);
      if (updateErr) throw updateErr;
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
      toast({ title: "Image enhanced", description: "Product image has been improved." });
    } catch (err: any) {
      console.error("[enhance] Failed:", err);
      toast({ title: "Enhancement failed", description: err.message, variant: "destructive" });
    } finally {
      setEnhancingIds(prev => { const next = new Set(prev); next.delete(productId); return next; });
    }
  }, [queryClient, toast]);

  const handleBulkEnhance = useCallback(async () => {
    const candidates = allProducts.filter(p => p.image_url);
    if (candidates.length === 0) {
      toast({ title: "No images to enhance", description: "Products need images uploaded first." });
      return;
    }
    setBulkEnhancing(true);
    let success = 0, failed = 0;
    for (const p of candidates) {
      try {
        const { data, error } = await supabase.functions.invoke("enhance-image", {
          body: { image_url: p.image_url },
        });
        if (error || !data?.enhanced_url) { failed++; continue; }
        await (supabase.from("supplier_products") as any)
          .update({ image_url: data.enhanced_url })
          .eq("id", p.id);
        success++;
      } catch { failed++; }
    }
    queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
    setBulkEnhancing(false);
    toast({ title: "Bulk enhance complete", description: `${success} enhanced, ${failed} failed out of ${candidates.length}.` });
  }, [allProducts, queryClient, toast]);

  const handleSuggestionFilter = useCallback((action: string, removePattern: RegExp) => {
    const [key, value] = action.split(":");
    setFilters((prev) => ({ ...prev, [key]: value }));
    setSearchQuery(prev => prev.replace(removePattern, "").trim());
    setShowSuggestions(false);
  }, []);

  // Count total suggestions for keyboard nav
  const suggestionCount = useMemo(() => {
    if (!searchQuery.trim() && showSuggestions) return Math.min(searchHistory.length, 8);
    if (!searchQuery.trim() || !showSuggestions) return 0;
    let count = 0;
    const seenActions = new Set<string>();
    for (const m of FILTER_MATCHERS) {
      if (m.pattern.test(searchQuery) && !seenActions.has(m.action)) { seenActions.add(m.action); count++; }
    }
    count += Math.min(sorted.length, 5);
    return Math.min(count, 10);
  }, [searchQuery, showSuggestions, searchHistory.length, sorted.length]);

  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { setShowSuggestions(false); setSuggestionIndex(-1); return; }
    if (!showSuggestions || suggestionCount === 0) {
      if (e.key === "Enter" && searchQuery.trim()) { addToHistory(searchQuery); }
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setSuggestionIndex(prev => (prev + 1) % suggestionCount); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSuggestionIndex(prev => (prev - 1 + suggestionCount) % suggestionCount); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestionIndex < 0) { addToHistory(searchQuery); setShowSuggestions(false); return; }
      // Determine what's at this index
      if (!searchQuery.trim()) {
        // History mode
        const h = searchHistory[suggestionIndex];
        if (h) { setSearchQuery(h); setShowSuggestions(false); setSuggestionIndex(-1); }
        return;
      }
      // Filter + product mode
      let idx = 0;
      const seenActions = new Set<string>();
      for (const m of FILTER_MATCHERS) {
        if (m.pattern.test(searchQuery) && !seenActions.has(m.action)) {
          seenActions.add(m.action);
          if (idx === suggestionIndex) { handleSuggestionFilter(m.action, m.removePattern); setSuggestionIndex(-1); return; }
          idx++;
        }
      }
      const topProducts = sorted.slice(0, 5);
      for (const p of topProducts) {
        if (idx === suggestionIndex) { setSelectedProduct(p); setShowSuggestions(false); setSuggestionIndex(-1); return; }
        idx++;
      }
    }
  }, [showSuggestions, suggestionCount, suggestionIndex, searchQuery, searchHistory, sorted, handleSuggestionFilter, addToHistory]);

  return (
    <div className="space-y-3">
      {isOffline && (
        <div className="flex items-center gap-2 bg-destructive/10 text-destructive border border-destructive/20 rounded-lg px-3 py-2 text-xs">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> Browsing offline cache
        </div>
      )}

      {/* Sticky filter bar with integrated search + sort */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm pb-2 -mx-1 px-1">
        <CatalogFilterBar
          filters={filters}
          onChange={setFilters}
          totalCount={productCategoryFilter ? allProducts.filter(p => p.product_category === productCategoryFilter).length : allProducts.length}
          filteredCount={sorted.length}
          productCategory={effectiveCategory}
          counts={filterCounts}
          searchQuery={searchQuery}
          onSearchChange={(q) => { setSearchQuery(q); setShowSuggestions(true); setSuggestionIndex(-1); }}
          sortBy={sortBy}
          onSortChange={setSortBy}
          onSearchFocus={() => setShowSuggestions(true)}
          onSearchKeyDown={handleSearchKeyDown}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          searchSuggestions={
            <CatalogSearchSuggestions
              query={searchQuery}
              products={sorted}
              visible={showSuggestions && (searchQuery.trim().length > 0 || searchHistory.length > 0)}
              onSelectFilter={handleSuggestionFilter}
              onSelectProduct={(id) => { const p = allProducts.find(x => x.id === id); if (p) setSelectedProduct(p); setShowSuggestions(false); }}
              onClose={() => { setShowSuggestions(false); setSuggestionIndex(-1); }}
              focusIndex={suggestionIndex}
              searchHistory={searchHistory}
              onSelectHistory={(term) => { setSearchQuery(term); setShowSuggestions(false); setSuggestionIndex(-1); }}
              onRemoveHistory={removeFromHistory}
            />
          }
        />
      </div>

      {/* Bulk action bar */}
      {bulkSelected.size > 0 && (
        <div className="sticky top-12 z-20 bg-primary text-primary-foreground px-4 py-2.5 flex items-center gap-3 rounded-lg shadow-lg animate-in slide-in-from-top-2">
          <Checkbox
            checked={bulkSelected.size === sorted.length && sorted.length > 0}
            onCheckedChange={(checked) => checked ? selectAllVisible() : setBulkSelected(new Set())}
            className="border-primary-foreground data-[state=checked]:bg-primary-foreground data-[state=checked]:text-primary"
          />
          <span className="text-sm font-medium">{bulkSelected.size} selected</span>
          <div className="flex-1" />

          {/* Change Brand */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
                <Tags className="h-3 w-3" /> Brand
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-3 space-y-2">
              <p className="text-xs font-medium">Change brand to:</p>
              <Input
                placeholder="Type brand name..."
                value={bulkBrand}
                onChange={(e) => setBulkBrand(e.target.value)}
                className="h-8 text-xs"
              />
              <div className="flex flex-wrap gap-1">
                {availableBrands.map(b => (
                  <Badge key={b} variant="outline" className="cursor-pointer text-[10px]" onClick={() => setBulkBrand(b)}>
                    {b}
                  </Badge>
                ))}
              </div>
              <Button size="sm" className="w-full text-xs" disabled={!bulkBrand}
                onClick={() => { setBulkAction("brand"); setBulkConfirmOpen(true); }}>
                Apply to {bulkSelected.size} products
              </Button>
            </PopoverContent>
          </Popover>

          {/* Change Category */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
                <FolderInput className="h-3 w-3" /> Category
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3 space-y-2">
              <p className="text-xs font-medium">Change category to:</p>
              <Select value={bulkCategory} onValueChange={setBulkCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {["Air Conditioning", "Water Heaters", "Inverters", "Batteries", "Consumables"].map(c => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="w-full text-xs" disabled={!bulkCategory}
                onClick={() => { setBulkAction("category"); setBulkConfirmOpen(true); }}>
                Apply to {bulkSelected.size} products
              </Button>
            </PopoverContent>
          </Popover>

          {/* Move to Supplier */}
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="secondary" className="gap-1.5 text-xs">
                <ArrowRightLeft className="h-3 w-3" /> Move
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-3 space-y-2">
              <p className="text-xs font-medium">Move to supplier:</p>
              <Select value={bulkSupplierId} onValueChange={setBulkSupplierId}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  {allSuppliers.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="w-full text-xs" disabled={!bulkSupplierId}
                onClick={() => { setBulkAction("supplier"); setBulkConfirmOpen(true); }}>
                Move {bulkSelected.size} products
              </Button>
            </PopoverContent>
          </Popover>

          {/* Delete */}
          <Button size="sm" variant="destructive" className="gap-1.5 text-xs"
            onClick={() => { setBulkAction("delete"); setBulkConfirmOpen(true); }}>
            <Trash2 className="h-3 w-3" /> Delete
          </Button>

          <Button size="sm" variant="ghost" onClick={() => setBulkSelected(new Set())}
            className="text-primary-foreground hover:bg-primary-foreground/10 text-xs">
            Clear
          </Button>
        </div>
      )}

      {/* Bulk confirmation dialog */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{bulkAction === "delete" ? `Delete ${bulkSelected.size} products?` : "Confirm Bulk Action"}</AlertDialogTitle>
            <AlertDialogDescription>{bulkConfirmMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeBulkAction}
              className={bulkAction === "delete" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}>
              {bulkUpdateMutation.isPending || bulkDeleteMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {bulkAction === "delete" ? "Confirm Delete" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          {isLoading ? "Loading products..." : `${sorted.length} products found`}
          {pinnedCount > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5">
              <Star className="h-2.5 w-2.5 fill-current" /> {pinnedCount} pinned
            </Badge>
          )}
          {compareIds.length > 0 && (
            <Badge variant="secondary" className="text-[10px] gap-0.5">
              <GitCompareArrows className="h-2.5 w-2.5" /> {compareIds.length} selected
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleBulkEnhance}
            disabled={bulkEnhancing}
          >
            {bulkEnhancing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {bulkEnhancing ? "Enhancing..." : "Enhance All Images"}
          </Button>
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
      ) : viewMode === "list" ? (
        <div className="space-y-1">
          {/* List header */}
          <div className="grid grid-cols-[24px_1fr_2fr_80px_60px_80px_100px_40px] gap-2 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b">
            <Checkbox
              checked={bulkSelected.size === sorted.length && sorted.length > 0}
              onCheckedChange={(checked) => checked ? selectAllVisible() : setBulkSelected(new Set())}
              className="h-3.5 w-3.5"
            />
            <span>Model</span><span>Description</span><span>BTU</span><span>Refrig.</span><span>Pipe</span><span className="text-right">Price</span><span></span>
          </div>
          {sorted.map((product) => {
            const isPinned = !!product.is_pinned;
            const isBulkSelected = bulkSelected.has(product.id);
            return (
              <div
                key={product.id}
                className={`grid grid-cols-[24px_1fr_2fr_80px_60px_80px_100px_40px] gap-2 items-center px-3 py-2 rounded-md border cursor-pointer hover:bg-accent/30 transition-colors ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""} ${isBulkSelected ? "ring-1 ring-accent bg-accent/10" : ""}`}
                onClick={() => openPanel(product)}
              >
                <div onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={isBulkSelected} onCheckedChange={() => toggleBulkSelect(product.id)} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-mono font-medium truncate">{highlightText(product.product_code, searchQuery)}</p>
                  <p className="text-[10px] text-primary font-semibold truncate">{highlightText(product.short_name || generateShortName(product), searchQuery)}</p>
                </div>
                <p className="text-xs text-muted-foreground truncate">{highlightText(product.description, searchQuery)}</p>
                <span className="text-xs text-muted-foreground">{product.btu_rating ? `${(product.btu_rating / 1000).toFixed(0)}K` : "—"}</span>
                <span className="text-xs text-muted-foreground">{product.refrigerant_type || "—"}</span>
                <span className="text-xs text-muted-foreground">{product.pipe_size || "—"}</span>
                <div className="text-right">
                  <span className="text-xs font-bold">
                    {product.is_price_on_request || (!product.selling_price && !product.cost_price)
                      ? <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600 bg-amber-500/10 font-semibold px-1">POR</Badge>
                      : <span className="text-primary">{formatZAR(product.selling_price)}</span>}
                  </span>
                  {product.sold_in_length && product.price_per_metre && (
                    <p className="text-[9px] text-green-700">📏 R{product.price_per_metre.toFixed(2)}/m</p>
                  )}
                </div>
                <div className="flex items-center justify-end">
                  <Button
                    size="icon" variant="ghost"
                    className={`h-6 w-6 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                    onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                  >
                    <Star className={`h-3 w-3 ${isPinned ? "fill-amber-400 text-amber-400" : ""}`} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : viewMode === "grouped" ? (
        <div className="space-y-4">
          {groupedData.map(({ brand, categories }) => (
            <Collapsible key={brand} defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors group">
                <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
                <span className="text-base font-bold">{brand}</span>
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  {categories.reduce((sum, c) => sum + c.products.length, 0)}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-2 pt-2 space-y-3">
                {categories.map(({ category, products }) => (
                  <Collapsible key={category} defaultOpen>
                    <CollapsibleTrigger className="flex items-center gap-1.5 w-full text-left py-1 px-2 rounded hover:bg-accent/30 transition-colors group">
                      <ChevronDown className="h-3 w-3 shrink-0 transition-transform group-data-[state=closed]:-rotate-90 text-muted-foreground" />
                      <span className="text-sm font-semibold text-muted-foreground">{category}</span>
                      <span className="text-[10px] text-muted-foreground">({products.length})</span>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-1">
                      <div className="border rounded-md overflow-hidden">
                        <div className="grid grid-cols-[1fr_2fr_60px_55px_70px_90px] gap-2 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b bg-muted/30">
                          <span>Model</span><span>Description</span><span>BTU</span><span>Refrig.</span><span>Pipe</span><span className="text-right">Price</span>
                        </div>
                        {products.map((product) => (
                          <div
                            key={product.id}
                            className="grid grid-cols-[1fr_2fr_60px_55px_70px_90px] gap-2 items-center px-3 py-1.5 border-b last:border-b-0 cursor-pointer hover:bg-accent/20 transition-colors text-xs"
                            onClick={() => openPanel(product)}
                          >
                            <div className="min-w-0">
                              <p className="font-mono font-medium truncate text-[11px]">{highlightText(product.product_code, searchQuery)}</p>
                            </div>
                            <p className="text-muted-foreground truncate text-[11px]">{highlightText(product.description, searchQuery)}</p>
                            <span className="text-muted-foreground">{product.btu_rating ? `${(product.btu_rating / 1000).toFixed(0)}K` : "—"}</span>
                            <span className="text-muted-foreground">{product.refrigerant_type || "—"}</span>
                            <span className="text-muted-foreground">{product.pipe_size || "—"}</span>
                            <span className="font-bold text-right">
                              {product.is_price_on_request || (!product.selling_price && !product.cost_price)
                                ? <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600 bg-amber-500/10 font-semibold px-1">POR</Badge>
                                : <span className="text-primary">{formatZAR(product.selling_price)}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((product) => {
            const isPinned = !!product.is_pinned;
            const isBulkSelected = bulkSelected.has(product.id);
            return (
              <Card
                key={product.id}
                className={`hover:shadow-md transition-shadow active:scale-[0.99] cursor-pointer ${(product as any).archived ? "opacity-50" : ""} ${isPinned ? "ring-1 ring-primary/30" : ""} ${isBulkSelected ? "ring-1 ring-accent bg-accent/10" : ""}`}
                onClick={() => openPanel(product)}
              >
                <CardContent className={isMobile ? "p-3" : "p-4"}>
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                        <Checkbox checked={isBulkSelected} onCheckedChange={() => toggleBulkSelect(product.id)} className="h-3.5 w-3.5" />
                      </div>
                      {/* Product image thumbnail */}
                      {product.image_url ? (
                        <div className="shrink-0 w-12 h-12 rounded-md overflow-hidden border bg-muted/20">
                          <img src={product.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      ) : (
                        <div className="shrink-0 w-12 h-12 rounded-md border bg-muted/20 flex items-center justify-center">
                          <Package className="h-5 w-5 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`font-bold text-primary ${isMobile ? "text-sm" : "text-base"} ${(product as any).archived ? "line-through" : ""}`}>
                          {highlightText(product.short_name || generateShortName(product), searchQuery)}
                        </p>
                        <p className={`text-xs font-mono text-muted-foreground ${(product as any).archived ? "line-through" : ""}`}>{highlightText(product.product_code, searchQuery)}</p>
                        <p className={`mt-0.5 line-clamp-2 text-muted-foreground ${isMobile ? "text-[11px]" : "text-xs"} ${(product as any).archived ? "line-through" : ""}`}>{highlightText(product.description, searchQuery)}</p>
                      </div>
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
                    <Popover>
                      <PopoverTrigger asChild>
                        <div onClick={(e) => e.stopPropagation()}>
                          <Badge variant="outline" className="text-[10px] cursor-pointer hover:bg-accent">{product.category || product.product_category || "Uncategorized"}</Badge>
                        </div>
                      </PopoverTrigger>
                      <PopoverContent className="w-44 p-2" onClick={(e) => e.stopPropagation()}>
                        <p className="text-xs font-medium mb-1.5">Change Category</p>
                        <div className="space-y-1">
                          {["Air Conditioning", "Consumables", "Water Heaters", "Inverters", "Batteries"].map((cat) => (
                            <button
                              key={cat}
                              className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-accent transition-colors ${product.product_category === cat ? "bg-accent font-medium" : ""}`}
                              onClick={() => {
                                (supabase.from("supplier_products") as any)
                                  .update({ product_category: cat })
                                  .eq("id", product.id)
                                  .then(() => {
                                    queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
                                    queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
                                    queryClient.invalidateQueries({ queryKey: ["product-category-counts"] });
                                    toast({ title: `Category changed to ${cat}` });
                                  });
                              }}
                            >
                              {cat}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    {product.btu_rating && <Badge variant="outline" className="text-[10px]">{(product.btu_rating / 1000).toFixed(0)}K BTU</Badge>}
                    {product.refrigerant_type && <Badge variant="outline" className="text-[10px]">{product.refrigerant_type}</Badge>}
                    {product.pipe_size && <Badge variant="outline" className="text-[10px]">⌀ {product.pipe_size}</Badge>}
                    {product.sold_in_length && product.price_per_metre && (
                      <Badge variant="outline" className="text-[10px] gap-0.5 border-green-500/50 text-green-700 bg-green-500/10">
                        📏 R{product.price_per_metre.toFixed(2)}/m
                      </Badge>
                    )}
                  </div>

                  <Separator className="mb-2" />

                  <div className="flex items-end justify-between">
                    <div>
                      {product.is_price_on_request || (!product.selling_price && !product.cost_price) ? (
                        <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-600 bg-amber-500/10 font-semibold">POR</Badge>
                      ) : (
                        <>
                          <p className="text-[10px] text-muted-foreground">Cost: {formatZAR(product.discounted_cost || product.cost_price)}</p>
                          {product.rrp && product.rrp > product.selling_price && (
                            <p className="text-[10px] text-muted-foreground line-through">{formatZAR(product.rrp)}</p>
                          )}
                          <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {product.image_url && (
                        <Button
                          size="icon" variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          disabled={enhancingIds.has(product.id)}
                          onClick={(e) => { e.stopPropagation(); enhanceProductImage(product.id, product.image_url!); }}
                          title="Enhance image with AI"
                        >
                          {enhancingIds.has(product.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button
                        size="icon" variant="ghost"
                        className={`h-7 w-7 ${isPinned ? "text-amber-500" : "text-muted-foreground"}`}
                        onClick={(e) => { e.stopPropagation(); togglePinMutation.mutate({ productId: product.id, isPinned }); }}
                      >
                        <Star className={`h-3.5 w-3.5 ${isPinned ? "fill-amber-400 text-amber-400" : ""}`} />
                      </Button>
                      {(product as any).archived ? (
                        <Button size="sm" variant="outline"
                          onClick={(e) => { e.stopPropagation(); unarchiveMutation.mutate(product.id); }}
                          className={`text-xs ${isMobile ? "h-8 px-3" : "h-7"}`}
                        >Unarchive</Button>
                      ) : onAddToQuote && !product.is_price_on_request && (product.selling_price > 0 || product.cost_price > 0) ? (
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

      {/* Floating compare button */}
      {compareIds.length >= 2 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30">
          <Button
            className="shadow-lg rounded-full px-6 gap-2"
            onClick={() => setCompareOpen(true)}
          >
            <GitCompareArrows className="h-4 w-4" />
            Compare {compareIds.length} products
          </Button>
        </div>
      )}

      {/* Slide-over detail panel */}
      <ProductSlideOverPanel
        product={panelProduct}
        open={panelOpen}
        onClose={() => { setPanelOpen(false); setTimeout(() => setPanelProductId(null), 300); }}
        onPrev={() => navigatePanel(-1)}
        onNext={() => navigatePanel(1)}
        hasPrev={panelIndex > 0}
        hasNext={panelIndex < sorted.length - 1}
        currentIndex={panelIndex}
        totalCount={sorted.length}
        deriveBrand={deriveBrand}
        deriveSpeedType={deriveSpeedType}
        derivePhase={derivePhase}
        onAddToQuote={onAddToQuote ? (item) => {
          onAddToQuote(item);
          if (panelProduct) incrementUsageMutation.mutate(panelProduct.id);
          toast({ title: "Added to quote" });
          setPanelOpen(false);
        } : undefined}
      />

      {/* Compare table */}
      <ProductCompareTable
        products={compareProducts}
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        onClear={() => setCompareIds([])}
        deriveBrand={deriveBrand}
        deriveSpeedType={deriveSpeedType}
        derivePhase={derivePhase}
      />

      {/* Legacy modal kept for suggestion clicks */}
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
