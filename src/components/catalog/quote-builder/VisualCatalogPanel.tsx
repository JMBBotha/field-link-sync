import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ZoomIn, ZoomOut, X, FileImage, ScanSearch, Loader2, Lightbulb, Search, Trash2, Star,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import PdfPageOverlay from "./PdfPageOverlay";
import type { OverlayRegion } from "./PdfPageOverlay";
import { extractAndMatchPage } from "./pdfTextExtractor";
import FallbackProductPanel from "./FallbackProductPanel";
import PdfLinkButton from "./PdfLinkButton";
import PdfMagnifier from "./PdfMagnifier";
import CompactZonesSidebar from "./CompactZonesSidebar";
import EnhancedProductPopup from "./EnhancedProductPopup";
import CategoryNavBar, { groupCategory } from "./CategoryNavBar";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface VisualCatalogPanelProps {
  open: boolean;
  onClose: () => void;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  onAddBasket?: () => void;
  onRemoveBasket?: (id: string) => void;
  products: PaletteProduct[];
  isDragging?: boolean;
}

interface PdfPage {
  id: string;
  supplier_id: string;
  pdf_filename: string;
  page_number: number;
  page_image_url: string;
  pdf_storage_path: string | null;
}

const VisualCatalogPanel = ({ open, onClose, baskets, onAddProductToBasket, onAddBasket, onRemoveBasket, products, isDragging: isDraggingExternal }: VisualCatalogPanelProps) => {
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
  const [popupProduct, setPopupProduct] = useState<PaletteProduct | null>(null);
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

  useEffect(() => { if (open) { setVisiblePageIndex(0); setZoom(1); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Fetch suppliers
  const { data: supplierOptions = [] } = useQuery({
    queryKey: ["visual-panel-suppliers"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("supplier_pdf_pages") as any).select("supplier_id").order("supplier_id");
      if (!data) return [];
      return [...new Set((data as any[]).map((d) => d.supplier_id))] as string[];
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
      return data || [];
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

  const handleProductClick = useCallback((product: PaletteProduct) => {
    setPopupProduct(product);
  }, []);

  const handleAddBasket = useCallback(() => {
    onAddBasket?.();
  }, [onAddBasket]);


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
      <div className="fixed inset-0 z-40 bg-black/40 transition-opacity" onClick={onClose} />

      <div className={`fixed inset-y-0 left-0 z-50 flex bg-background border-r shadow-2xl transition-all duration-300 ease-in-out ${panelWidth}`}>
        {/* LEFT: Compact Zones Sidebar */}
        {!isDraggingExternal && !isMobile && (
          <div className="w-[280px] min-w-[240px] shrink-0 border-r flex flex-col">
            <CompactZonesSidebar
              baskets={baskets}
              onAddBasket={handleAddBasket}
              onRemoveBasket={onRemoveBasket || (() => {})}
            />
          </div>
        )}

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
            </div>

            <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); }}>
              <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {supplierOptions.map((s) => (<SelectItem key={s} value={s}>{supplierNameMap[s] || s}</SelectItem>))}
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
                          scrollContainerRef={scrollContainerRef}
                          onCategoriesDetected={handlePageCategories}
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

      {/* Enhanced product popup */}
      {popupProduct && (
        <EnhancedProductPopup
          product={popupProduct}
          baskets={baskets}
          onAddProductToBasket={onAddProductToBasket}
          onAddBasket={handleAddBasket}
          onClose={() => setPopupProduct(null)}
          basketProductCounts={basketProductCounts}
        />
      )}
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
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onCategoriesDetected: (pageIndex: number, categories: string[]) => void;
  registerRef: (el: HTMLDivElement | null) => void;
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
  scrollContainerRef,
  onCategoriesDetected,
  registerRef,
}: LazyPdfPageProps) => {
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

  // Live extraction for this page
  const { data: liveRegions = [], isLoading: extracting } = useQuery({
    queryKey: ["visual-panel-live-extract", page.id, page.pdf_storage_path, products.length],
    enabled: isVisible && hasPdfSource && products.length > 0,
    queryFn: async () => {
      if (!page.pdf_storage_path) return [];
      try {
        console.log(`[VisualCatalog] Extracting page ${page.page_number} from ${page.supplier_id}, matching against ${products.length} products`);
        const regions = await extractAndMatchPage(page.pdf_storage_path, page.page_number, products);
        const matched = regions.filter(r => r.matched);
        console.log(`[VisualCatalog] Page ${page.page_number}: ${regions.length} text regions found, ${matched.length} matched to products`);
        return regions;
      } catch (err) {
        console.error("[VisualCatalog] Live extraction failed:", err);
        return [];
      }
    },
    staleTime: 120000,
  });

  const overlayRegions: OverlayRegion[] = useMemo(() =>
    liveRegions.map((r, idx) => ({
      id: `live-${page.id}-${idx}`,
      x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct,
      product: r.product as PaletteProduct | null,
      product_code: r.product_code || "",
      label: r.label || "",
    })),
    [liveRegions, page.id]
  );

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

  // Count matched vs total
  const matchedCount = overlayRegions.filter(r => r.product).length;
  const totalRegions = overlayRegions.length;

  return (
    <div
      ref={(el) => {
        divRef.current = el;
        registerRef(el);
      }}
      data-page-index={pageIndex}
      className="relative border-b border-muted/30"
      style={{ minHeight: "400px" }}
    >
      {/* Page number label */}
      <div className="absolute top-2 left-2 z-30 bg-black/60 text-white text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1.5">
        <span>Page {page.page_number}</span>
        {isVisible && totalRegions > 0 && (
          <span className="text-green-300">{matchedCount}/{totalRegions} matched</span>
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
          />
          {/* Show overlays for ALL regions (matched + unmatched) */}
          {hasPdfSource && overlayRegions.length > 0 && (
            <PdfPageOverlay
              regions={overlayRegions}
              baskets={baskets}
              onAddProductToBasket={onAddProductToBasket}
              basketProductCounts={basketProductCounts}
              onProductClick={onProductClick}
            />
          )}
          {/* Star overlays for favorited products */}
          {starOverlays.map((region) => (
            <div
              key={`star-${region.id}`}
              className="absolute pointer-events-none z-[45]"
              style={{
                left: `${Math.max(0, region.x_pct - 3.5)}%`,
                top: `${region.y_pct}%`,
              }}
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-black/60 shadow-lg ring-2 ring-yellow-400/50">
                <Star className="h-5 w-5 fill-yellow-400 text-yellow-400 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]" />
              </div>
            </div>
          ))}
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
