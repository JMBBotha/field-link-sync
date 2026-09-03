import { useState, useMemo, useCallback, useRef, KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import Fuse from "fuse.js";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Package, Download, RefreshCw, Loader2, AlertTriangle, History, Upload, Minus, Plus, ArrowLeftRight, PackageOpen, Truck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/csvExport";
import CatalogSearchSuggestions, { FILTER_MATCHERS } from "@/components/catalog/CatalogSearchSuggestions";
import { DEFAULT_FILTERS } from "@/components/catalog/CatalogFilterBar";
import {
  buildSearchBlob,
  preprocessQuery,
  fuseMultiTokenSearch,
  sortByUnitTypePriority,
  sortCategoriesByPriority,
  deriveBtuBucket,
  deriveSpeedType,
  deriveUnitType,
  deriveBrand,
  derivePhase,
  FUSE_OPTIONS,
  type SearchableProduct,
} from "@/components/catalog/catalogSearchUtils";
import { useInventoryStock, type StockRecord, type StockMode } from "@/hooks/useInventoryStock";
import StockAdjustmentHistory from "@/components/inventory/StockAdjustmentHistory";
import StockReasonDialog from "@/components/inventory/StockReasonDialog";
import BulkStockUpdateModal from "@/components/inventory/BulkStockUpdateModal";
import ReceiveStockModal from "@/components/inventory/ReceiveStockModal";
import ReceiptsView from "@/components/inventory/ReceiptsView";
import { cn } from "@/lib/utils";

interface CatalogProduct extends SearchableProduct {
  id: string;
  product_code: string;
  description: string;
  category: string;
  cost_price: number;
  selling_price: number;
  supplier_id: string;
  default_markup_percent: number;
  btu_rating: number | null;
  refrigerant_type: string | null;
  pipe_size: string | null;
  is_price_on_request: boolean;
  quote_usage_count: number;
  search_blob?: string;
}

interface SupplierInfo {
  id: string;
  name: string;
}

type ModeFilter = "all" | "stock_sensitive" | "order_as_needed";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const SEARCH_HISTORY_KEY = "inventorySearchHistory";

// Stock quantity color helpers
const getQtyColorClass = (qty: number, threshold: number) => {
  if (qty === 0) return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  if (qty <= threshold) return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  return "bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400";
};

const getRowHighlight = (qty: number, threshold: number, mode: StockMode) => {
  if (mode !== "stock_sensitive") return "";
  if (qty === 0) return "border-l-2 border-l-red-500";
  if (qty <= threshold) return "border-l-2 border-l-amber-500";
  return "";
};

const InventoryList = () => {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [lowStockFilter, setLowStockFilter] = useState(false);
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(SEARCH_HISTORY_KEY);
      return saved ? JSON.parse(saved).slice(0, 10) : [];
    } catch { return []; }
  });
  const searchRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Stock management state
  const { stockMap, isLoadingStock, lowStockCount, updateStock, updateStockMode, bulkUpdateMode, bulkUpdate } = useInventoryStock();
  const [editingQty, setEditingQty] = useState<{ productId: string; value: number } | null>(null);
  const [reasonDialog, setReasonDialog] = useState<{
    productId: string;
    productName: string;
    oldQty: number;
    newQty: number;
  } | null>(null);
  const [historyDialog, setHistoryDialog] = useState<{
    stockId: string;
    productName: string;
  } | null>(null);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  // Selection state for bulk mode changes
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"inventory" | "receipts">("inventory");

  // Debounce ref for inline qty edits
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addToHistory = useCallback((term: string) => {
    const t = term.trim();
    if (!t || t.length < 2) return;
    setSearchHistory(prev => {
      const deduped = [t, ...prev.filter(h => h.toLowerCase() !== t.toLowerCase())].slice(0, 10);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(deduped)); } catch {}
      return deduped;
    });
  }, []);

  const removeFromHistory = useCallback((term: string) => {
    setSearchHistory(prev => {
      const updated = prev.filter(h => h !== term);
      try { localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as SupplierInfo[];
    },
  });

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["inventory-from-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products" as any)
        .select("id, product_code, description, category, cost_price, selling_price, supplier_id, default_markup_percent, btu_rating, refrigerant_type, pipe_size, is_price_on_request, quote_usage_count")
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return (data || []) as unknown as CatalogProduct[];
    },
  });

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || "—";

  const enrichedItems = useMemo(() =>
    items.map(item => ({
      ...item,
      supplier_name: supplierName(item.supplier_id),
      search_blob: buildSearchBlob({ ...item, supplier_name: supplierName(item.supplier_id) }),
    })),
    [items, suppliers]
  );

  const fuse = useMemo(() => new Fuse(enrichedItems, FUSE_OPTIONS), [enrichedItems]);

  const categories = useMemo(() => {
    const cats = [...new Set(items.map(i => i.category).filter(Boolean))] as string[];
    return sortCategoriesByPriority(cats);
  }, [items]);

  // Apply search + category + low stock + mode filter
  const filtered = useMemo(() => {
    let pool = categoryFilter
      ? enrichedItems.filter(item => item.category === categoryFilter)
      : enrichedItems;

    // Apply mode filter
    if (modeFilter !== "all") {
      pool = pool.filter(item => {
        const stock = stockMap.get(item.id);
        const mode = stock?.stock_mode ?? "order_as_needed";
        return mode === modeFilter;
      });
    }

    // Apply low stock filter (only stock_sensitive items)
    if (lowStockFilter) {
      pool = pool.filter(item => {
        const stock = stockMap.get(item.id);
        const mode = stock?.stock_mode ?? "order_as_needed";
        if (mode !== "stock_sensitive") return false;
        const qty = stock?.quantity ?? 0;
        const threshold = stock?.low_stock_threshold ?? 3;
        return qty <= threshold;
      });
    }

    if (!search.trim()) {
      return sortByUnitTypePriority(pool);
    }

    const baseFilters = { ...DEFAULT_FILTERS };
    const { cleanedQuery, autoFilters } = preprocessQuery(search, baseFilters);

    if (autoFilters.btu && autoFilters.btu !== "__all__") {
      pool = pool.filter(p => deriveBtuBucket(p) === autoFilters.btu);
    }
    if (autoFilters.speedType && autoFilters.speedType !== "__all__") {
      pool = pool.filter(p => deriveSpeedType(p) === autoFilters.speedType);
    }
    if (autoFilters.unitType && autoFilters.unitType !== "__all__") {
      pool = pool.filter(p => deriveUnitType(p) === autoFilters.unitType);
    }
    if (autoFilters.brand && autoFilters.brand !== "__all__") {
      pool = pool.filter(p => deriveBrand(p) === autoFilters.brand);
    }
    if (autoFilters.refrigerant && autoFilters.refrigerant !== "__all__") {
      pool = pool.filter(p => (p.refrigerant_type || "").toUpperCase() === autoFilters.refrigerant!.toUpperCase());
    }
    if (autoFilters.phase && autoFilters.phase !== "__all__") {
      pool = pool.filter(p => derivePhase(p) === autoFilters.phase);
    }
    if (autoFilters.priceMax) {
      pool = pool.filter(p => p.selling_price <= parseFloat(autoFilters.priceMax!));
    }
    if (autoFilters.priceMin) {
      pool = pool.filter(p => p.selling_price >= parseFloat(autoFilters.priceMin!));
    }

    if (cleanedQuery.trim()) {
      const poolFuse = new Fuse(pool, FUSE_OPTIONS);
      return fuseMultiTokenSearch(pool, poolFuse, cleanedQuery);
    }

    return sortByUnitTypePriority(pool);
  }, [search, categoryFilter, lowStockFilter, modeFilter, enrichedItems, fuse, stockMap]);

  const handleExportCSV = () => {
    const rows = filtered.map(i => {
      const stock = stockMap.get(i.id);
      return {
        SKU: i.product_code,
        Name: i.description,
        Category: i.category || "",
        "Cost Price": i.cost_price,
        "Sell Price": i.selling_price,
        Supplier: supplierName(i.supplier_id),
        BTU: i.btu_rating || "",
        Refrigerant: i.refrigerant_type || "",
        "Times Quoted": i.quote_usage_count,
        "Stock Mode": stock?.stock_mode ?? "order_as_needed",
        Quantity: stock?.stock_mode === "stock_sensitive" ? (stock?.quantity ?? 0) : "N/A",
        "Low Stock Threshold": stock?.stock_mode === "stock_sensitive" ? (stock?.low_stock_threshold ?? 3) : "N/A",
      };
    });
    exportToCSV(rows, `inventory-export-${new Date().toISOString().split("T")[0]}`);
    toast({ title: `${rows.length} items exported` });
  };

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestionIndex(prev => prev + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestionIndex(prev => Math.max(-1, prev - 1));
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    } else if (e.key === "Enter" && search.trim()) {
      addToHistory(search.trim());
      setShowSuggestions(false);
    }
  };

  const handleSelectFilter = useCallback((action: string, removePattern: RegExp) => {
    setSearch(prev => prev.replace(removePattern, "").trim());
    const filterLabel = action.split(":")[1];
    setSearch(prev => {
      const cleaned = prev.replace(removePattern, "").trim();
      return cleaned ? `${cleaned} ${filterLabel}` : filterLabel;
    });
    setShowSuggestions(false);
  }, []);

  const handleSelectProduct = useCallback((productId: string) => {
    const product = enrichedItems.find(p => p.id === productId);
    if (product) {
      setSearch(product.product_code || product.description);
      addToHistory(product.product_code || product.description);
    }
    setShowSuggestions(false);
  }, [enrichedItems, addToHistory]);

  const handleSelectHistory = useCallback((term: string) => {
    setSearch(term);
    setShowSuggestions(false);
  }, []);

  // Stock quantity inline edit handlers
  const handleQtyChange = useCallback((productId: string, newValue: number) => {
    setEditingQty({ productId, value: Math.max(0, newValue) });
  }, []);

  const handleQtyBlur = useCallback((productId: string, productName: string) => {
    if (!editingQty || editingQty.productId !== productId) return;
    const stock = stockMap.get(productId);
    const oldQty = stock?.quantity ?? 0;
    const newQty = editingQty.value;

    if (newQty === oldQty) {
      setEditingQty(null);
      return;
    }

    setReasonDialog({ productId, productName, oldQty, newQty });
  }, [editingQty, stockMap]);

  const handleQtyIncrement = useCallback((productId: string, productName: string, delta: number) => {
    const stock = stockMap.get(productId);
    const oldQty = stock?.quantity ?? 0;
    const newQty = Math.max(0, oldQty + delta);
    if (newQty === oldQty) return;
    setReasonDialog({ productId, productName, oldQty, newQty });
  }, [stockMap]);

  const handleReasonConfirm = useCallback((reason: string) => {
    if (!reasonDialog) return;
    updateStock.mutate({
      productId: reasonDialog.productId,
      newQuantity: reasonDialog.newQty,
      reason,
    });
    setReasonDialog(null);
    setEditingQty(null);
  }, [reasonDialog, updateStock]);

  const handleBulkUpdate = useCallback(async (updates: { productId: string; quantity: number; reason?: string }[]) => {
    await bulkUpdate.mutateAsync(updates);
  }, [bulkUpdate]);

  // Toggle stock mode for a single item
  const handleToggleMode = useCallback((productId: string) => {
    const stock = stockMap.get(productId);
    const currentMode = stock?.stock_mode ?? "order_as_needed";
    const newMode: StockMode = currentMode === "order_as_needed" ? "stock_sensitive" : "order_as_needed";
    updateStockMode.mutate({ productId, mode: newMode });
  }, [stockMap, updateStockMode]);

  // Selection handlers
  const handleSelectItem = useCallback((productId: string, index: number, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (shiftKey && lastSelectedIndex !== null) {
        const start = Math.min(lastSelectedIndex, index);
        const end = Math.max(lastSelectedIndex, index);
        for (let i = start; i <= end; i++) {
          if (filtered[i]) next.add(filtered[i].id);
        }
      } else {
        if (next.has(productId)) next.delete(productId);
        else next.add(productId);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }, [lastSelectedIndex, filtered]);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(i => i.id)));
    }
  }, [filtered, selectedIds]);

  const handleBulkMode = useCallback((mode: StockMode) => {
    if (selectedIds.size === 0) return;
    bulkUpdateMode.mutate({ productIds: Array.from(selectedIds), mode });
    setSelectedIds(new Set());
  }, [selectedIds, bulkUpdateMode]);

  const isAllSelected = filtered.length > 0 && selectedIds.size === filtered.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} products from catalog
            {lowStockCount > 0 && (
              <span className="ml-2 text-red-600 dark:text-red-400 font-medium">
                • {lowStockCount} low stock
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowReceiveModal(true)}>
            <Truck className="h-3.5 w-3.5 mr-1" /> Receive Stock
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowBulkModal(true)}>
            <Upload className="h-3.5 w-3.5 mr-1" /> Bulk Update
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Tabs: Inventory / Receipts */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
        <TabsList className="h-8">
          <TabsTrigger value="inventory" className="text-xs">Inventory</TabsTrigger>
          <TabsTrigger value="receipts" className="text-xs">
            Receipts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="mt-4">
          <ReceiptsView />
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 space-y-4">
          {/* Mode filter pills */}
          <div className="flex gap-1.5 flex-wrap">
            {(
              [
                { value: "all" as ModeFilter, label: "All", icon: Package },
                { value: "stock_sensitive" as ModeFilter, label: "Stock Sensitive", icon: PackageOpen },
                { value: "order_as_needed" as ModeFilter, label: "Order as Needed", icon: Truck },
              ] as const
            ).map(mf => (
              <Button
                key={mf.value}
                variant={modeFilter === mf.value ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setModeFilter(mf.value)}
                className="text-xs"
              >
                <mf.icon className="h-3 w-3 mr-1" />
                {mf.label}
              </Button>
            ))}
          </div>

          {/* Search and filter */}
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]" ref={searchRef}>
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products... (e.g. 12k inverter midea)"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setShowSuggestions(true);
                  setSuggestionIndex(-1);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={handleSearchKeyDown}
                className="pl-9"
              />
              <CatalogSearchSuggestions
                query={search}
                products={filtered.slice(0, 10)}
                visible={showSuggestions}
                onSelectFilter={handleSelectFilter}
                onSelectProduct={handleSelectProduct}
                onClose={() => setShowSuggestions(false)}
                focusIndex={suggestionIndex}
                searchHistory={searchHistory}
                onSelectHistory={handleSelectHistory}
                onRemoveHistory={removeFromHistory}
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button
                variant={categoryFilter === null && !lowStockFilter ? "secondary" : "ghost"}
                size="sm"
                onClick={() => { setCategoryFilter(null); setLowStockFilter(false); }}
              >
                All
              </Button>
              <Button
                variant={lowStockFilter ? "destructive" : "ghost"}
                size="sm"
                onClick={() => setLowStockFilter(!lowStockFilter)}
                className="text-xs"
              >
                <AlertTriangle className="h-3 w-3 mr-1" />
                Low Stock
                {lowStockCount > 0 && (
                  <Badge variant="destructive" className="ml-1 h-4 min-w-4 px-1 text-[9px]">
                    {lowStockCount}
                  </Badge>
                )}
              </Button>
              {categories.map((cat) => (
                <Button
                  key={cat}
                  variant={categoryFilter === cat ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => { setCategoryFilter(cat); setLowStockFilter(false); }}
                  className="text-xs"
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          {/* Results count */}
          {(search.trim() || lowStockFilter || modeFilter !== "all") && (
            <p className="text-xs text-muted-foreground">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              {search.trim() && <> for "{search}"</>}
              {lowStockFilter && <> (low stock only)</>}
              {modeFilter !== "all" && <> ({modeFilter === "stock_sensitive" ? "tracked" : "order-as-needed"})</>}
            </p>
          )}

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox
                        checked={isAllSelected}
                        // @ts-ignore
                        indeterminate={isIndeterminate}
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all"
                      />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Sell</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Quoted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(isLoading || isLoadingStock) ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                        {items.length === 0
                          ? "No products yet. Import from the Catalog page."
                          : "No matching products"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((item, index) => {
                      const stock = stockMap.get(item.id);
                      const mode: StockMode = (stock?.stock_mode as StockMode) ?? "order_as_needed";
                      const qty = stock?.quantity ?? 0;
                      const threshold = stock?.low_stock_threshold ?? 3;
                      const isEditing = editingQty?.productId === item.id;
                      const displayQty = isEditing ? editingQty.value : qty;
                      const isSelected = selectedIds.has(item.id);

                      return (
                        <TableRow key={item.id} className={cn(getRowHighlight(qty, threshold, mode), isSelected && "bg-primary/5")}>
                          <TableCell>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {}}
                              onClick={(e) => handleSelectItem(item.id, index, (e as any).shiftKey)}
                              aria-label={`Select ${item.description}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium text-sm max-w-[200px] truncate">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs font-mono">
                            {item.product_code || "—"}
                          </TableCell>
                          <TableCell>
                            {item.category && (
                              <Badge variant="outline" className="text-xs">
                                {item.category}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {item.is_price_on_request ? "POR" : formatZAR(item.cost_price)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-primary">
                            {item.is_price_on_request ? "POR" : formatZAR(item.selling_price)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px]">
                              {supplierName(item.supplier_id)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {mode === "order_as_needed" ? (
                              <div className="flex items-center justify-center gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="outline" className="text-[9px] cursor-default text-muted-foreground">
                                      Order
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    This item is ordered from suppliers as needed. Click the toggle to make it stock sensitive.
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-muted-foreground hover:text-primary"
                                      onClick={() => handleToggleMode(item.id)}
                                    >
                                      <ArrowLeftRight className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">Switch to Stock Sensitive</TooltipContent>
                                </Tooltip>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-0.5">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleQtyIncrement(item.id, item.description, -1)}
                                  disabled={qty === 0}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={displayQty}
                                      onChange={(e) => handleQtyChange(item.id, parseInt(e.target.value) || 0)}
                                      onBlur={() => handleQtyBlur(item.id, item.description)}
                                      onFocus={() => setEditingQty({ productId: item.id, value: qty })}
                                      className={cn(
                                        "w-14 h-7 text-center text-xs font-bold p-0 rounded",
                                        getQtyColorClass(qty, threshold)
                                      )}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">
                                    {qty === 0
                                      ? "Out of stock"
                                      : qty <= threshold
                                        ? `Low stock (threshold: ${threshold})`
                                        : `In stock (threshold: ${threshold})`}
                                  </TooltipContent>
                                </Tooltip>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => handleQtyIncrement(item.id, item.description, 1)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                                {stock && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 text-muted-foreground"
                                        onClick={() => setHistoryDialog({ stockId: stock.id, productName: item.description })}
                                      >
                                        <History className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">View history</TooltipContent>
                                  </Tooltip>
                                )}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5 text-muted-foreground hover:text-primary"
                                      onClick={() => handleToggleMode(item.id)}
                                    >
                                      <ArrowLeftRight className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs">Switch to Order as Needed</TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {item.quote_usage_count || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Floating action bar for bulk selection */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-20 lg:bottom-16 left-1/2 -translate-x-1/2 z-40 bg-card border rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" className="text-xs" onClick={() => handleBulkMode("order_as_needed")}>
            Mark Order-as-Needed
          </Button>
          <Button size="sm" variant="default" className="text-xs" onClick={() => handleBulkMode("stock_sensitive")}>
            Mark Stock Sensitive
          </Button>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Dialogs */}
      {reasonDialog && (
        <StockReasonDialog
          open={!!reasonDialog}
          productName={reasonDialog.productName}
          oldQty={reasonDialog.oldQty}
          newQty={reasonDialog.newQty}
          onConfirm={handleReasonConfirm}
          onCancel={() => { setReasonDialog(null); setEditingQty(null); }}
        />
      )}

      <StockAdjustmentHistory
        stockId={historyDialog?.stockId || null}
        productName={historyDialog?.productName || ""}
        open={!!historyDialog}
        onClose={() => setHistoryDialog(null)}
      />

      <BulkStockUpdateModal
        open={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        products={items.map(i => ({ id: i.id, product_code: i.product_code, description: i.description }))}
        onBulkUpdate={handleBulkUpdate}
      />

      <ReceiveStockModal
        open={showReceiveModal}
        onClose={() => setShowReceiveModal(false)}
        products={items.map(i => ({ id: i.id, product_code: i.product_code, description: i.description }))}
        suppliers={suppliers}
        stockMap={stockMap as any}
      />
    </div>
  );
};

export default InventoryList;
