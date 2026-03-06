/* eslint-disable -- visual catalog panel */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { inclVatFromExcl } from "@/utils/pricing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ZoomIn, ZoomOut, X, FileImage, ScanSearch, Loader2, Lightbulb, Search, Trash2, Star, Plus, MonitorUp, AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import PdfPageOverlay from "./PdfPageOverlay";
import type { OverlayRegion } from "./PdfPageOverlay";
import { extractAndMatchPage, clearExtractionCache } from "./pdfTextExtractor";
import { autoCatalogFromRegions } from "./pdfAutoCatalog";
import FallbackProductPanel from "./FallbackProductPanel";
import PdfLinkButton from "./PdfLinkButton";
import PdfMagnifier from "./PdfMagnifier";
import CompactZonesSidebar from "./CompactZonesSidebar";
import EnhancedProductPopup from "./EnhancedProductPopup";
import ProductInfoDialog from "@/components/shared/ProductInfoDialog";

import CategoryNavBar, { groupCategory } from "./CategoryNavBar";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

// Cross-page dedup: tracks seen region keys across all pages to prevent duplicate icons
const globalSeenRegions = new Map<string, number>(); // key → first pageIndex
import type { WizardTriggerItem } from "./QuoteBuilderPopup";

interface VisualCatalogPanelProps {
  open: boolean;
  onClose: () => void;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  onAddBasket?: () => void;
  onRemoveBasket?: (id: string) => void;
  products: PaletteProduct[];
  isDragging?: boolean;
  onOpenWizard?: (item: WizardTriggerItem) => void;
  /** Mutable ref that the parent can use to trigger PDF search from outside (e.g. the wizard) */
  pdfSearchRef?: React.MutableRefObject<((term: string) => void) | null>;
  /** When true, suppresses backdrop click and Escape key to prevent closing while wizard is on top */
  wizardOpen?: boolean;
  /** Shared PDF selection state */
  pdfSelection?: PdfSelectionHandlers;
}

interface PdfPage {
  id: string;
  supplier_id: string;
  pdf_filename: string;
  page_number: number;
  page_image_url: string;
  pdf_storage_path: string | null;
}

const VisualCatalogPanel = ({ open, onClose, baskets, onAddProductToBasket, onAddBasket, onRemoveBasket, products, isDragging: isDraggingExternal, onOpenWizard, pdfSearchRef, wizardOpen, pdfSelection }: VisualCatalogPanelProps) => {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [visiblePageIndex, setVisiblePageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loupeActive, setLoupeActive] = useState(false);
  const pdfAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const HD_KEY = "visual-catalog-hd";
  const [hdMode, setHdMode] = useState(() => {
    try { return localStorage.getItem(HD_KEY) === "true"; } catch { return false; }
  });
  const [hoveredProduct, setHoveredProduct] = useState<PaletteProduct | null>(null);
  const [hoverEvent, setHoverEvent] = useState<MouseEvent | null>(null);
  const [productInfoProduct, setProductInfoProduct] = useState<PaletteProduct | null>(null);

  // Manual product dialog state
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [manualPrice, setManualPrice] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  // handleManualProductSubmit defined after currentPage declaration below

  const handleProductInfoOpen = useCallback((product: PaletteProduct) => {
    setProductInfoProduct(product);
  }, []);

  const handleHoverStart = useCallback((product: PaletteProduct | null, e: React.MouseEvent) => {
    setHoveredProduct(product);
    setHoverEvent(e.nativeEvent);
  }, []);

  const handleHoverMove = useCallback((e: React.MouseEvent) => {
    setHoverEvent(e.nativeEvent);
  }, []);

  const handleHoverEnd = useCallback(() => {
    setHoveredProduct(null);
    setHoverEvent(null);
  }, []);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [categoryPageMap, setCategoryPageMap] = useState<Map<string, number>>(new Map());

  const handleDeleteSupplierPdf = useCallback(async (supplierId: string) => {
    setDeleting(true);
    try {
      const { data: pagesToDelete } = await (supabase.from("supplier_pdf_pages") as any)
        .select("id, pdf_storage_path")
        .eq("supplier_id", supplierId);
      const storagePaths = (pagesToDelete || []).map((p: any) => p.pdf_storage_path).filter(Boolean);
      if (storagePaths.length > 0) {
        await supabase.storage.from("supplier-pdfs").remove(storagePaths);
      }
      const { error } = await (supabase.from("supplier_pdf_pages") as any).delete().eq("supplier_id", supplierId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-suppliers"] });
      toast({ title: "PDF pages deleted successfully" });
    } catch (err) {
      console.error("Delete PDF failed:", err);
      toast({ title: "Failed to delete PDF pages", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }, [queryClient]);

  const isFullWidth = isMobile || (expanded && !isDraggingExternal);
  const panelWidth = isDraggingExternal ? "w-2/5" : isFullWidth ? "w-full" : "w-full";

  useEffect(() => {
    if (open) {
      setVisiblePageIndex(0);
      setZoom(1);
      clearExtractionCache();
      globalSeenRegions.clear(); // Reset cross-page dedup on panel open
      // Force all live-extract queries to re-run with latest detection logic
      queryClient.removeQueries({ queryKey: ["visual-panel-live-extract"] });
    }
  }, [open, queryClient]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !wizardOpen) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose, wizardOpen]);

  // Fetch suppliers
  const { data: supplierOptions = [] } = useQuery({
    queryKey: ["visual-panel-suppliers"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("supplier_pdf_pages") as any).select("supplier_id").neq("supplier_id", "").order("supplier_id");
      if (!data) return [];
      return [...new Set((data as any[]).map((d) => d.supplier_id))].filter((s: string) => s && s.trim() !== '') as string[];
    },
    staleTime: 60000,
  });

  const { data: supplierNameMap = {} } = useQuery({
    queryKey: ["visual-panel-supplier-names", supplierOptions],
    enabled: open && supplierOptions.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id, name").in("id", supplierOptions);
      const map: Record<string, string> = {};
      // Also map supplier_id text values (like "Daikin", "Samsung ") directly
      for (const opt of supplierOptions) {
        map[opt] = opt; // fallback to raw supplier_id text
      }
      (data || []).forEach((s: any) => { map[s.id] = s.name; });
      return map;
    },
    staleTime: 60000,
  });

  const { data: pages = [], isLoading: pagesLoading } = useQuery<PdfPage[]>({
    queryKey: ["visual-panel-pages", selectedSupplier],
    enabled: open,
    queryFn: async () => {
      let query = (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url, pdf_storage_path")
        .order("supplier_id").order("pdf_filename").order("page_number");
      if (selectedSupplier !== "all") query = query.eq("supplier_id", selectedSupplier);
      const { data, error } = await query.limit(500);
      if (error) throw error;
      // Deduplicate by (supplier_id, pdf_filename, page_number) – keep first occurrence
      const seen = new Set<string>();
      const deduped: typeof data = [];
      for (const row of (data || [])) {
        const key = `${row.supplier_id}|${row.pdf_filename}|${row.page_number}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(row);
        }
      }
      return deduped;
    },
    staleTime: 30000,
  });

  // IntersectionObserver to track visible page + update active category
  useEffect(() => {
    if (!open || pages.length === 0) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let bestIdx = visiblePageIndex;
        let bestRatio = 0;
        for (const entry of entries) {
          const idx = Number(entry.target.getAttribute("data-page-index"));
          if (!isNaN(idx) && entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            bestIdx = idx;
          }
        }
        if (bestRatio > 0) {
          setVisiblePageIndex(bestIdx);
          // Find which category this page belongs to (first match in categoryPageMap)
          let bestCat: string | undefined;
          categoryPageMap.forEach((pageIdx, cat) => {
            if (pageIdx <= bestIdx) {
              if (!bestCat || categoryPageMap.get(bestCat)! < pageIdx) {
                bestCat = cat;
              }
            }
          });
          if (bestCat) setActiveCategory(bestCat);
        }
      },
      {
        root: container,
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    );

    pageRefs.current.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [open, pages.length, categoryPageMap]);

  const currentPage = pages[visiblePageIndex] || pages[0] || null;

  const currentSupplierName = currentPage ? (supplierNameMap[currentPage.supplier_id] || currentPage.supplier_id) : "";
  const currentFilename = currentPage?.pdf_filename || "";

  const handleManualProductSubmit = useCallback(async () => {
    if (!manualName.trim() && !manualCode.trim()) {
      toast({ title: "Enter at least a product name or model code", variant: "destructive" });
      return;
    }
    const supplierId = selectedSupplier !== "all" ? selectedSupplier : (currentPage?.supplier_id || null);
    if (!supplierId) {
      toast({ title: "Select a supplier first", variant: "destructive" });
      return;
    }
    setManualSaving(true);
    try {
      const priceVal = parseFloat(manualPrice) || 0;
      const { data, error } = await (supabase.from("supplier_products") as any).insert({
        supplier_id: supplierId,
        product_code: manualCode.trim() || manualName.trim().substring(0, 20),
        short_name: manualName.trim(),
        description: manualName.trim(),
        cost_excl_vat: priceVal,
        cost_incl_vat: Math.round(priceVal * 1.15 * 100) / 100,
        selling_price: Math.round(priceVal * 1.15 * 100) / 100,
        category: "Manual",
        is_active: true,
        archived: false,
      }).select().single();
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-live-extract"] });
      clearExtractionCache();
      toast({ title: "Product added", description: `${manualName.trim() || manualCode.trim()} added to catalog` });
      setManualDialogOpen(false);
      setManualName("");
      setManualCode("");
      setManualPrice("");
    } catch (err) {
      console.error("[ManualProduct] Insert failed:", err);
      toast({ title: "Failed to add product", variant: "destructive" });
    } finally {
      setManualSaving(false);
    }
  }, [manualName, manualCode, manualPrice, selectedSupplier, currentPage, queryClient]);

  const scrollToPage = useCallback((index: number) => {
    const el = pageRefs.current.get(index);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const goToPage = useCallback((dir: number) => {
    const next = visiblePageIndex + dir;
    if (next < 0 || next >= pages.length) return;
    setZoom(1);
    scrollToPage(next);
  }, [pages.length, visiblePageIndex, scrollToPage]);

  // Legacy popup removed — clicks now route to Area Quote Builder via onOpenWizard
  const handleProductClick = useCallback((_product: PaletteProduct) => {
    // No-op: onOpenWizard handles this via PdfPageOverlay's row strip click
  }, []);

  const handleAddBasket = useCallback(() => {
    onAddBasket?.();
  }, [onAddBasket]);

  const handleQuickAddProduct = useCallback((label: string, productCode: string, price: number | null) => {
    toast({
      title: "Quick-add coming soon",
      description: `Detected: ${productCode || label.substring(0, 40)}${price ? ` — R${price.toLocaleString("en-ZA")}` : ""}. Use the Import tab to add this product to your catalog.`,
      duration: 8000,
    });
  }, []);

  // BUG 4b: Remove region — PdfPageOverlay handles persistence via dismissed_pdf_regions table
  const handleRemoveRegion = useCallback(async (region: OverlayRegion) => {
    try {
      clearExtractionCache();
      queryClient.removeQueries({ queryKey: ["visual-panel-live-extract"] });
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["dismissed-pdf-regions"] });
      toast({ title: "Region removed", duration: 2000 });
    } catch (err) {
      console.error("[VisualCatalog] Remove region failed:", err);
      toast({ title: "Failed to remove region", variant: "destructive" });
    }
  }, [queryClient]);

  const handleToggleFavorite = useCallback(async (product: PaletteProduct) => {
    // Always use is_pinned for the visual catalog overlay — this is what the UI checks
    const currentValue = !!product.is_pinned;
    const newValue = !currentValue;

    // Optimistic update: mutate product in all live-extract cached regions
    queryClient.setQueriesData({ queryKey: ["visual-panel-live-extract"] }, (old: any) => {
      if (!Array.isArray(old)) return old;
      return old.map((r: any) =>
        r.product?.id === product.id
          ? { ...r, product: { ...r.product, is_pinned: newValue } }
          : r
      );
    });

    // Also clear extraction cache so next re-render uses updated product data
    clearExtractionCache();

    try {
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ is_pinned: newValue })
        .eq("id", product.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      toast({ title: newValue ? "★ Added to favorites" : "Removed from favorites", duration: 2000 });
    } catch (err) {
      // Roll back optimistic update
      clearExtractionCache();
      queryClient.setQueriesData({ queryKey: ["visual-panel-live-extract"] }, (old: any) => {
        if (!Array.isArray(old)) return old;
        return old.map((r: any) =>
          r.product?.id === product.id
            ? { ...r, product: { ...r.product, is_pinned: currentValue } }
            : r
        );
      });
      toast({ title: "Failed to update favorite", variant: "destructive" });
    }
  }, [queryClient]);


  const handlePageCategories = useCallback((pageIndex: number, categories: string[]) => {
    setCategoryPageMap(prev => {
      const next = new Map(prev);
      let changed = false;
      for (const cat of categories) {
        if (!next.has(cat) || next.get(cat)! > pageIndex) {
          next.set(cat, pageIndex);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Category scroll handler
  const handleScrollToCategory = useCallback((category: string) => {
    setActiveCategory(category);
    const pageIndex = categoryPageMap.get(category);
    if (pageIndex !== undefined) {
      scrollToPage(pageIndex);
    }
  }, [categoryPageMap, scrollToPage]);

  // Favorites set
  const favoriteIds = useMemo(() => {
    const ids = new Set(products.filter(p => p.is_pinned).map(p => p.id));
    if (ids.size > 0) {
      console.log(`[VisualCatalog] ${ids.size} favorited products:`, [...ids].slice(0, 5));
    }
    return ids;
  }, [products]);

  const basketProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const basket of baskets) {
      for (const item of basket.items) {
        counts[item.product.id] = (counts[item.product.id] || 0) + item.quantity;
      }
    }
    return counts;
  }, [baskets]);

  // PDF search: find a product by term and scroll to it
  const handlePdfSearch = useCallback((term: string) => {
    if (!term.trim()) return;
    const lowerTerm = term.toLowerCase();
    // Search products for a match
    const match = products.find(p => {
      const blob = [p.product_code, p.short_name, p.brand, p.description].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(lowerTerm);
    });
    if (!match) {
      toast({ title: "No match found in PDF", description: `Could not find "${term}" on any page`, duration: 3000 });
      return;
    }
    // Find which page has this product by checking overlay regions in the query cache
    const allExtractKeys = queryClient.getQueriesData<any[]>({ queryKey: ["visual-panel-live-extract"] });
    let targetPageIndex: number | null = null;
    let targetYPct: number | null = null;
    for (const [key, regions] of allExtractKeys) {
      if (!Array.isArray(regions)) continue;
      const pageId = (key as any[])[1] as string;
      const pageIdx = pages.findIndex(p => p.id === pageId);
      if (pageIdx === -1) continue;
      for (const r of regions) {
        if (r.product?.id === match.id || (r.product_code && r.product_code === match.product_code)) {
          targetPageIndex = pageIdx;
          targetYPct = r.y_pct;
          break;
        }
      }
      if (targetPageIndex !== null) break;
    }
    if (targetPageIndex !== null) {
      const el = pageRefs.current.get(targetPageIndex);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        // If we have a y_pct, scroll a bit further down within the page
        if (targetYPct != null && scrollContainerRef.current) {
          setTimeout(() => {
            const container = scrollContainerRef.current;
            if (container) {
              const pageTop = el.offsetTop;
              const offset = (targetYPct! / 100) * el.offsetHeight;
              container.scrollTo({ top: pageTop + offset - 100, behavior: "smooth" });
            }
          }, 400);
        }
      }
    } else {
      toast({ title: "Product found but not visible", description: `"${match.product_code}" is in the catalog but not on a currently loaded PDF page`, duration: 3000 });
    }
  }, [products, pages, queryClient]);

  // Register the search callback with the parent via ref
  useEffect(() => {
    if (pdfSearchRef) {
      pdfSearchRef.current = open ? handlePdfSearch : null;
    }
    return () => {
      if (pdfSearchRef) pdfSearchRef.current = null;
    };
  }, [pdfSearchRef, open, handlePdfSearch]);

  // Get all pages for current file (for PdfLinkButton)
  const currentFilePages = useMemo(() => {
    if (!currentPage) return [];
    return pages.filter(p => p.supplier_id === currentPage.supplier_id && p.pdf_filename === currentPage.pdf_filename);
  }, [pages, currentPage]);

  // Check if any page has pdf source
  const anyPageHasPdfSource = useMemo(() => pages.some(p => !!p.pdf_storage_path), [pages]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/70 transition-opacity backdrop-blur-sm" onClick={wizardOpen ? undefined : onClose} />

      <div className={`fixed inset-y-0 left-0 z-50 flex bg-background border-r shadow-2xl transition-all duration-300 ease-in-out ${panelWidth}`}>
        {/* Quote Zones sidebar removed for cleaner PDF viewing experience */}

        {/* RIGHT: PDF Viewer */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <FileImage className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-foreground">{currentSupplierName || "Visual Catalog"}</p>
                {currentFilename && <p className="text-[10px] text-muted-foreground truncate">{currentFilename}</p>}
              </div>
              {currentPage && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-destructive hover:bg-destructive/10" disabled={deleting}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete PDF pages?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Delete all PDF pages for <strong>{currentSupplierName}</strong>? This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => handleDeleteSupplierPdf(currentPage.supplier_id)}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {/* Page indicator + quick-jump buttons */}
            {pages.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(-1)} disabled={visiblePageIndex === 0}>
                  <span className="text-xs">◀</span>
                </Button>
                <span className="text-[10px] font-medium text-muted-foreground min-w-[60px] text-center">
                  Page {visiblePageIndex + 1} of {pages.length}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(1)} disabled={visiblePageIndex >= pages.length - 1}>
                  <span className="text-xs">▶</span>
                </Button>
              </div>
            )}

            <div className="flex items-center gap-0.5 shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] text-muted-foreground w-9 text-center">{Math.round(zoom * 100)}%</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={loupeActive ? "secondary" : "ghost"}
                    size="icon"
                    className={`h-7 w-7 ${loupeActive ? "ring-1 ring-primary" : ""}`}
                    onClick={() => setLoupeActive(a => !a)}
                  >
                    <Search className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[10px]">Magnifying glass</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={hdMode ? "secondary" : "ghost"}
                    size="icon"
                    className={`h-7 w-7 text-[9px] font-bold ${hdMode ? "ring-1 ring-primary" : ""}`}
                    onClick={() => {
                      const next = !hdMode;
                      setHdMode(next);
                      localStorage.setItem(HD_KEY, String(next));
                      // Clear cache so pages re-render at new quality
                      clearExtractionCache();
                      queryClient.removeQueries({ queryKey: ["visual-panel-live-extract"] });
                    }}
                  >
                    HD
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[10px]">High quality PDF render (slower)</TooltipContent>
              </Tooltip>
            </div>

            <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); }}>
              <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {supplierOptions.filter((s) => s && s.trim() !== '').map((s) => (<SelectItem key={s} value={s}>{supplierNameMap[s] || s}</SelectItem>))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>

          {/* Content: Continuous scroll */}
          <div className="flex-1 overflow-hidden flex relative">
            {pagesLoading ? (
              <div className="p-4 space-y-3 flex-1">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-[60vh] w-full" />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center text-muted-foreground">
                <FileImage className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-sm font-medium">No Visual Catalog Pages</p>
                <p className="text-xs mt-1 max-w-[250px]">Import a supplier PDF via the Catalog → Import tab to populate the visual catalog.</p>
              </div>
            ) : (
              <>
                {/* Scrollable PDF container with all pages stacked */}
                <div
                  ref={scrollContainerRef}
                  className="flex-1 overflow-auto"
                  style={{
                    scrollBehavior: "smooth",
                    WebkitOverflowScrolling: "touch",
                    willChange: "transform",
                  }}
                >
                  <div ref={pdfAreaRef} style={{ cursor: loupeActive ? "none" : zoom > 1 ? "grab" : "default" }}>
                    <div className="origin-top-left transition-transform" style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                      {pages.map((page, idx) => (
                        <LazyPdfPage
                          key={page.id}
                          page={page}
                          pageIndex={idx}
                          products={products}
                          favoriteIds={favoriteIds}
                          baskets={baskets}
                          onAddProductToBasket={onAddProductToBasket}
                          basketProductCounts={basketProductCounts}
                          onProductClick={handleProductClick}
                          onQuickAddProduct={handleQuickAddProduct}
                          onToggleFavorite={handleToggleFavorite}
                          onRemoveRegion={handleRemoveRegion}
                          scrollContainerRef={scrollContainerRef}
                          onCategoriesDetected={handlePageCategories}
                          totalPages={pages.length}
                          supplierName={currentSupplierName}
                          onOpenWizard={onOpenWizard}
                          onHoverStart={handleHoverStart}
                          onHoverMove={handleHoverMove}
                          onHoverEnd={handleHoverEnd}
                          pdfSelection={pdfSelection}
                          onProductInfoOpen={handleProductInfoOpen}
                          hdMode={hdMode}
                          registerRef={(el) => {
                            if (el) pageRefs.current.set(idx, el);
                            else pageRefs.current.delete(idx);
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <PdfMagnifier
                    active={loupeActive}
                    imageUrl={currentPage?.page_image_url || ""}
                    containerRef={pdfAreaRef}
                    baseZoom={zoom}
                  />
                </div>

                {/* Fallback product sidebar when no PDF source */}
                {!anyPageHasPdfSource && currentPage && (
                  <FallbackProductPanel
                    products={products}
                    supplierId={currentPage.supplier_id}
                    supplierName={currentSupplierName}
                    baskets={baskets}
                    onAddProductToBasket={onAddProductToBasket}
                    basketProductCounts={basketProductCounts}
                  />
                )}

                {/* Floating category navigation bar */}
                <CategoryNavBar
                  products={products}
                  favoriteIds={favoriteIds}
                  currentSupplierName={currentSupplierName}
                  onScrollToCategory={handleScrollToCategory}
                  activeCategory={activeCategory}
                />

                {/* Floating "+" button for manual product entry */}
                <Button
                  onClick={() => setManualDialogOpen(true)}
                  className="absolute bottom-16 right-4 z-30 h-12 w-12 rounded-full shadow-lg"
                  size="icon"
                  title="Add product manually"
                >
                  <Plus className="h-5 w-5" />
                </Button>
              </>
            )}
          </div>

          {/* Status bar */}
          {pages.length > 0 && (
            <div className="border-t bg-muted/20 px-3 py-1 shrink-0 flex items-center gap-2">
              <ScanSearch className="h-3 w-3 text-muted-foreground" />
              {!anyPageHasPdfSource ? (
                <span className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <Lightbulb className="h-3 w-3" />
                  Tip: Link the original PDF for interactive overlays
                  <PdfLinkButton pages={currentFilePages} />
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">
                  Scroll through all {pages.length} pages · Click any highlight to add to quote
                  {favoriteIds.size > 0 && ` · ${favoriteIds.size} ★ favorited`}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Centralized hover popup via EnhancedProductPopup */}
      {hoveredProduct && (
        <EnhancedProductPopup
          product={hoveredProduct}
          mouseEvent={hoverEvent}
          isVisible={!!hoveredProduct}
          isHoverMode
          basketProductCounts={basketProductCounts}
        />
      )}

      {/* Controlled ProductInfoDialog triggered by PDF checkbox */}
      {productInfoProduct && (
        <ProductInfoDialog
          product={productInfoProduct}
          open={!!productInfoProduct}
          onOpenChange={(open) => { if (!open) setProductInfoProduct(null); }}
        />
      )}

      {/* Manual product entry dialog */}
      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Product Manually</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="manual-name">Product Name</Label>
              <Input id="manual-name" placeholder="e.g. 9000 BTU Wall Mount" value={manualName} onChange={(e) => setManualName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-code">Model Code</Label>
              <Input id="manual-code" placeholder="e.g. FTXM25Q" value={manualCode} onChange={(e) => setManualCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-price">Price (excl. VAT)</Label>
              <Input id="manual-price" type="number" placeholder="0.00" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleManualProductSubmit} disabled={manualSaving}>
              {manualSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ---- Lazy-loaded PDF Page component ----

interface LazyPdfPageProps {
  page: PdfPage;
  pageIndex: number;
  products: PaletteProduct[];
  favoriteIds: Set<string>;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  basketProductCounts: Record<string, number>;
  onProductClick: (product: PaletteProduct) => void;
  onQuickAddProduct?: (label: string, productCode: string, price: number | null) => void;
  onToggleFavorite?: (product: PaletteProduct) => void;
  onRemoveRegion?: (region: OverlayRegion) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onCategoriesDetected: (pageIndex: number, categories: string[]) => void;
  registerRef: (el: HTMLDivElement | null) => void;
  totalPages: number;
  supplierName?: string;
  onOpenWizard?: (item: WizardTriggerItem) => void;
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  pdfSelection?: PdfSelectionHandlers;
  onProductInfoOpen?: (product: PaletteProduct) => void;
  hdMode?: boolean;
}

const LazyPdfPage = ({
  page,
  pageIndex,
  products,
  favoriteIds,
  baskets,
  onAddProductToBasket,
  basketProductCounts,
  onProductClick,
  onQuickAddProduct,
  onToggleFavorite,
  onRemoveRegion,
  scrollContainerRef,
  onCategoriesDetected,
  registerRef,
  totalPages,
  supplierName,
  onOpenWizard,
  onHoverStart,
  onHoverMove,
  onHoverEnd,
  pdfSelection,
  onProductInfoOpen,
  hdMode,
}: LazyPdfPageProps) => {
  const queryClient = useQueryClient();
  const divRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const hasPdfSource = !!page.pdf_storage_path;

  // Lazy visibility detection
  useEffect(() => {
    const container = scrollContainerRef.current;
    const el = divRef.current;
    if (!container || !el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      {
        root: container,
        rootMargin: "200% 0px",
      }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollContainerRef]);

  // Filter out archived products before matching
  const activeProducts = useMemo(
    () => products.filter(p => !(p as any).archived),
    [products]
  );

  // ─── AUTHORITATIVE QUERY: supplier_products linked to this PDF page ───
  const { data: pageProducts = [] } = useQuery({
    queryKey: ["page-supplier-products", page.id],
    enabled: isVisible,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, description, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, is_pinned, pin_order, pipe_size, supplier_id, supplier_discount_percent, markup_percent, price_per_metre, sold_in_length, unit_length, is_material_favorite, rrp")
        .eq("pdf_page_id", page.id)
        .eq("archived", false)
        .eq("is_active", true)
        .order("product_code");
      if (error) {
        console.error(`[VisualCatalog] Failed to query products for page ${page.id}:`, error.message);
        return [];
      }
      return data || [];
    },
    staleTime: 60000,
  });

  // Also query pdf_product_regions for stored geometry
  const { data: storedGeometry = [] } = useQuery({
    queryKey: ["page-product-geometry", page.id],
    enabled: isVisible && pageProducts.length > 0,
    queryFn: async () => {
      const { data } = await (supabase.from("pdf_product_regions") as any)
        .select("id, product_id, product_code, region_x, region_y, region_width, region_height, label")
        .eq("pdf_page_id", page.id);
      return data || [];
    },
    staleTime: 60000,
  });

  // No archived product code filtering needed — PdfPageOverlay handles dismissals via dismissed_pdf_regions table

   // Live extraction for this page — enable even without hasPdfSource so fallback kicks in
  const queryEnabled = isVisible && hasPdfSource && activeProducts.length > 0;
  
  // Debug: log why query might not be enabled
  useEffect(() => {
    console.log(`[VisualCatalog] Page ${page.page_number} query conditions: isVisible=${isVisible}, hasPdfSource=${hasPdfSource}, activeProducts=${activeProducts.length}, enabled=${queryEnabled}, pdf_storage_path=${page.pdf_storage_path?.substring(0, 60) || 'null'}`);
  }, [isVisible, hasPdfSource, activeProducts.length, queryEnabled, page.page_number, page.pdf_storage_path]);

  const { data: liveRegions = [], isLoading: extracting } = useQuery({
    queryKey: ["visual-panel-live-extract", page.id, page.pdf_storage_path, activeProducts.length],
    enabled: queryEnabled,
    queryFn: async () => {
      if (!page.pdf_storage_path) return [];
      try {
        console.log(`[VisualCatalog] Extracting page ${page.page_number} from ${page.supplier_id}, matching against ${activeProducts.length} active products`);
        
        // First pass: extract and match against existing non-archived products
        const regions = await extractAndMatchPage(page.pdf_storage_path, page.page_number, activeProducts);
        const matched = regions.filter(r => r.matched);
        const unmatchedWithPrice = regions.filter(r => !r.matched && r.has_price && r.detected_price);
        
        console.log(`[VisualCatalog] Page ${page.page_number}: ${regions.length} regions, ${matched.length} matched, ${unmatchedWithPrice.length} unmatched with prices`);
        
        // Auto-catalog unmatched items with prices
        if (unmatchedWithPrice.length > 0) {
          try {
            const result = await autoCatalogFromRegions(regions, page.supplier_id);
            
            if (result.insertedCount > 0) {
              console.log(`[VisualCatalog] Auto-cataloged ${result.insertedCount} new products from page ${page.page_number}`);
              
              toast({
                title: `Auto-cataloged ${result.insertedCount} new products`,
                description: `Found on ${page.supplier_id} page ${page.page_number}. They are now available in your catalog.`,
                duration: 5000,
              });
              
              // Build augmented products list with newly inserted products
              const newPaletteProducts: PaletteProduct[] = result.newProducts.map(np => ({
                id: np.id,
                product_code: np.product_code,
                short_name: np.short_name || np.description,
                brand: np.brand || page.supplier_id,
                product_category: "Consumables",
                category: "Consumables",
                cost_excl_vat: np.cost_excl_vat || 0,
                cost_incl_vat: Math.round(inclVatFromExcl(np.cost_excl_vat || 0) * 100) / 100,
                selling_price: 0,
                description: np.description || "",
                is_pinned: false,
                pin_order: null,
                supplier_name: np.brand || page.supplier_id,
                supplier_type: "both",
                price_per_metre: null,
                sold_in_length: false,
                unit_length: null,
                pipe_size: null,
                is_material_favorite: false,
              }));
              
              // Clear cache and re-extract with augmented product list so icons turn blue
              clearExtractionCache();
              const allProducts = [...activeProducts, ...newPaletteProducts];
              const reMatched = await extractAndMatchPage(page.pdf_storage_path!, page.page_number, allProducts);
              
              // Invalidate the main products query so palette picks up new items
              queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
              // Also refresh the authoritative page products query
              queryClient.invalidateQueries({ queryKey: ["page-supplier-products", page.id] });
              
              return reMatched;
            }
          } catch (catalogErr) {
            console.error("[VisualCatalog] Auto-catalog failed:", catalogErr);
            toast({
              title: "Auto-catalog failed",
              description: `Could not auto-insert ${unmatchedWithPrice.length} products. Icons remain orange — you can retry by scrolling away and back.`,
              variant: "destructive",
              duration: 8000,
            });
            // Return original regions with orange icons so user can still interact
          }
        }
        
        return regions;
      } catch (err) {
        console.error("[VisualCatalog] Live extraction failed:", err);
        return [];
      }
    },
    staleTime: 120000,
  });

  // Build a lookup from product_code/id → live extraction y_pct for position merging
  const livePositionMap = useMemo(() => {
    const map = new Map<string, { y_pct: number; h_pct: number; x_pct: number; w_pct: number; detected_price: number | null; has_price: boolean }>();
    for (const r of liveRegions) {
      if (r.product_code) map.set(r.product_code, { y_pct: r.y_pct, h_pct: r.h_pct, x_pct: r.x_pct, w_pct: r.w_pct, detected_price: r.detected_price, has_price: r.has_price });
      if (r.product?.id) map.set(r.product.id, { y_pct: r.y_pct, h_pct: r.h_pct, x_pct: r.x_pct, w_pct: r.w_pct, detected_price: r.detected_price, has_price: r.has_price });
    }
    return map;
  }, [liveRegions]);

  // Build geometry lookup from stored pdf_product_regions
  const storedGeometryMap = useMemo(() => {
    const map = new Map<string, { y_pct: number; h_pct: number }>();
    for (const g of storedGeometry) {
      if (g.product_id) map.set(g.product_id, { y_pct: g.region_y ?? 0, h_pct: g.region_height ?? 2.5 });
      if (g.product_code) map.set(g.product_code, { y_pct: g.region_y ?? 0, h_pct: g.region_height ?? 2.5 });
    }
    return map;
  }, [storedGeometry]);

  // ─── BUILD AUTHORITATIVE OVERLAY REGIONS ───
  // Every supplier_product linked to this page gets exactly one icon
  const overlayRegions: OverlayRegion[] = useMemo(() => {
    // If we have authoritative page products, use them as the canonical source
    if (pageProducts.length > 0) {
      const usableRange = 90; // 5% to 95% of page height
      const evenSpacing = usableRange / Math.max(pageProducts.length, 1);
      let positionedCount = 0;

      const regions: OverlayRegion[] = pageProducts.map((sp: any, idx: number) => {
        // Try to find position from live extraction first
        const livePos = livePositionMap.get(sp.product_code) || livePositionMap.get(sp.id);
        // Then try stored geometry
        const storedPos = storedGeometryMap.get(sp.id) || storedGeometryMap.get(sp.product_code);

        let y_pct: number;
        let h_pct: number;
        let hasPosition = false;

        if (livePos) {
          y_pct = livePos.y_pct;
          h_pct = livePos.h_pct;
          hasPosition = true;
          positionedCount++;
        } else if (storedPos) {
          y_pct = storedPos.y_pct;
          h_pct = storedPos.h_pct;
          hasPosition = true;
          positionedCount++;
        } else {
          // Evenly distribute within the page
          y_pct = 5 + idx * evenSpacing;
          h_pct = Math.min(evenSpacing * 0.85, 4);
        }

        // Match against the palette products for full PaletteProduct data
        const paletteProduct = activeProducts.find(p => p.id === sp.id) || null;

        return {
          id: `auth-${page.id}-${sp.id}`,
          x_pct: livePos?.x_pct ?? 0,
          y_pct,
          w_pct: livePos?.w_pct ?? 100,
          h_pct,
          product: paletteProduct || {
            id: sp.id,
            product_code: sp.product_code,
            short_name: sp.short_name || sp.description,
            brand: sp.brand || "",
            product_category: sp.product_category || sp.category || "",
            category: sp.category || "",
            cost_excl_vat: sp.cost_excl_vat || 0,
            cost_incl_vat: sp.cost_incl_vat || 0,
            selling_price: sp.selling_price || 0,
            description: sp.description || "",
            is_pinned: sp.is_pinned || false,
            pin_order: sp.pin_order || null,
            supplier_name: supplierName || "",
            supplier_type: "both",
            price_per_metre: sp.price_per_metre || null,
            sold_in_length: sp.sold_in_length || false,
            unit_length: sp.unit_length || null,
            pipe_size: sp.pipe_size || null,
            is_material_favorite: sp.is_material_favorite || false,
          } as PaletteProduct,
          product_code: sp.product_code || "",
          label: sp.short_name || sp.description || "",
          has_price: !!(sp.selling_price || sp.cost_incl_vat),
          detected_price: sp.selling_price || sp.cost_incl_vat || null,
          matched: true,
        };
      });

      // Cross-check validation
      if (positionedCount < pageProducts.length) {
        console.warn(`[VisualCatalog] Page ${page.page_number}: ${pageProducts.length} products but only ${positionedCount} have overlay positions`);
      }

      return regions;
    }

    // ─── FALLBACK: use live extraction regions when no authoritative products ───
    const sourceRegions = liveRegions.length > 0 ? liveRegions : [];
    const result: OverlayRegion[] = [];
    for (let idx = 0; idx < sourceRegions.length; idx++) {
      const r = sourceRegions[idx];
      // Cross-page dedup: skip if this exact item was already seen on an earlier page
      const dedupKey = `${(r.label || "").substring(0, 80)}|${r.detected_price ?? "no-price"}`;
      const firstPage = globalSeenRegions.get(dedupKey);
      if (firstPage !== undefined && firstPage !== pageIndex) continue;
      globalSeenRegions.set(dedupKey, pageIndex);

      result.push({
        id: `live-${page.id}-${idx}`,
        x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct,
        product: r.product as PaletteProduct | null,
        product_code: r.product_code || "",
        label: r.label || "",
        has_price: r.has_price,
        detected_price: r.detected_price,
        matched: r.matched,
      });
    }

    // If no live regions, use supplier-based fallback distribution
    if (result.length === 0) {
      const pageSupplierName = (supplierName || page.supplier_id || "").toLowerCase().trim();
      const supplierProds = activeProducts.filter(p => {
        const productSupplier = (p.supplier_name || p.brand || "").toLowerCase().trim();
        return productSupplier.includes(pageSupplierName) || pageSupplierName.includes(productSupplier);
      });

      if (supplierProds.length === 0) {
        const productsPerPage = 20;
        const startIdx = (page.page_number - 1) * productsPerPage;
        const pageProds = activeProducts.slice(startIdx, startIdx + productsPerPage);
        if (pageProds.length > 0) {
          const usableRange = 90;
          const rowHeight = Math.min(usableRange / pageProds.length, 4);
          return pageProds.map((p, idx) => ({
            id: `fallback-${page.id}-${idx}`,
            x_pct: 0,
            y_pct: 5 + (idx * (usableRange / pageProds.length)),
            w_pct: 100,
            h_pct: rowHeight,
            product: p,
            product_code: p.product_code || "",
            label: p.short_name || p.description || "",
            has_price: !!(p.selling_price || p.cost_incl_vat),
            detected_price: p.selling_price || p.cost_incl_vat || null,
            matched: true,
          }));
        }
      } else {
        const productsPerPage = Math.ceil(supplierProds.length / Math.max(1, totalPages));
        const startIdx = pageIndex * productsPerPage;
        const pageProds = supplierProds.slice(startIdx, startIdx + productsPerPage);
        if (pageProds.length > 0) {
          const usableRange = 90;
          const rowHeight = Math.min(usableRange / pageProds.length, 4);
          return pageProds.map((p, idx) => ({
            id: `fallback-${page.id}-${idx}`,
            x_pct: 0,
            y_pct: 5 + (idx * (usableRange / pageProds.length)),
            w_pct: 100,
            h_pct: rowHeight,
            product: p,
            product_code: p.product_code || "",
            label: p.short_name || p.description || "",
            has_price: !!(p.selling_price || p.cost_incl_vat),
            detected_price: p.selling_price || p.cost_incl_vat || null,
            matched: true,
          }));
        }
      }
    }

    return result;
  }, [pageProducts, liveRegions, livePositionMap, storedGeometryMap, activeProducts, page.id, page.page_number, page.supplier_id, supplierName, totalPages, pageIndex]);

  // Report detected categories to parent for category→page mapping
  useEffect(() => {
    const cats = new Set<string>();
    for (const r of overlayRegions) {
      if (r.product) {
        const cat = groupCategory((r.product as any).product_category || (r.product as any).category || (r.product as any).description || "");
        cats.add(cat);
      }
    }
    if (cats.size > 0) {
      onCategoriesDetected(pageIndex, Array.from(cats));
    }
  }, [overlayRegions, pageIndex, onCategoriesDetected]);

  const starOverlays = useMemo(() => {
    const starred = overlayRegions.filter(r => r.product && favoriteIds.has(r.product.id));
    if (starred.length > 0) {
      console.log(`[VisualCatalog] Page ${page.page_number}: ${starred.length} starred products found on this page`);
    }
    return starred;
  }, [overlayRegions, favoriteIds, page.page_number]);

  // Count matched vs unmatched vs total
  const matchedCount = overlayRegions.filter(r => r.product).length;
  const unmatchedCount = overlayRegions.filter(r => !r.product).length;
  const totalRegions = overlayRegions.length;

  return (
    <div
      ref={(el) => {
        divRef.current = el;
        registerRef(el);
      }}
      data-page-index={pageIndex}
      className="relative border-b border-muted/30"
      style={{ minHeight: "400px", paddingRight: "88px", boxSizing: "border-box", overflow: "visible" }}
    >
      {/* Page number label */}
      <div className="absolute top-2 left-2 z-30 bg-black/60 text-white text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1.5">
        <span>Page {page.page_number}</span>
        {isVisible && totalRegions > 0 && (
          <span className="text-green-300">
            {totalRegions} items · {matchedCount} matched{unmatchedCount > 0 && <span className="text-orange-300"> · {unmatchedCount} new</span>}
          </span>
        )}
        {isVisible && starOverlays.length > 0 && (
          <span className="flex items-center gap-0.5 text-yellow-300">
            <Star className="h-2.5 w-2.5 fill-yellow-300" />
            {starOverlays.length}
          </span>
        )}
      </div>

      {isVisible ? (
        <>
          <img
            src={page.page_image_url}
            alt={`Page ${page.page_number}`}
            className="w-full block select-none"
            loading="lazy"
            draggable={false}
            style={hdMode ? { imageRendering: "high-quality" as any } : undefined}
          />
          {/* Show overlays for ALL regions (matched + unmatched) — works with live extraction or fallback */}
          {overlayRegions.length > 0 && (
            <PdfPageOverlay
              regions={overlayRegions}
              baskets={baskets}
              onAddProductToBasket={onAddProductToBasket}
              basketProductCounts={basketProductCounts}
              onProductClick={onProductClick}
              onQuickAddProduct={onQuickAddProduct}
              onToggleFavorite={onToggleFavorite}
              onRemoveRegion={onRemoveRegion}
              supplierName={supplierName}
              onOpenWizard={onOpenWizard}
              onHoverStart={onHoverStart}
              onHoverMove={onHoverMove}
              onHoverEnd={onHoverEnd}
              pdfSelection={pdfSelection}
              onProductInfoOpen={onProductInfoOpen}
            />
          )}
          {extracting && (
            <div className="absolute top-2 right-2 z-30 bg-black/50 text-white text-[9px] px-2 py-1 rounded flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Scanning…
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-[600px] bg-muted/5">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

export default VisualCatalogPanel;
