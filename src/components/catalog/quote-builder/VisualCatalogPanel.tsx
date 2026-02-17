import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ZoomIn, ZoomOut, X, Maximize2, Minimize2,
  ChevronLeft, ChevronRight, FileImage, ArrowLeft, ScanSearch, Loader2, Lightbulb, Search, Trash2, Star,
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
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loupeActive, setLoupeActive] = useState(false);
  const pdfAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [popupProduct, setPopupProduct] = useState<PaletteProduct | null>(null);
  const [autoScrollDone, setAutoScrollDone] = useState(false);

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
      setCurrentPageIndex(0);
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

  useEffect(() => { if (open) { setCurrentPageIndex(0); setZoom(1); setAutoScrollDone(false); } }, [open]);

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

  const currentPage = pages[currentPageIndex] || null;
  const hasPdfSource = !!currentPage?.pdf_storage_path;

  // Live extraction
  const { data: liveRegions = [], isLoading: extracting } = useQuery({
    queryKey: ["visual-panel-live-extract", currentPage?.id, currentPage?.pdf_storage_path, products.length],
    enabled: open && hasPdfSource && products.length > 0,
    queryFn: async () => {
      if (!currentPage?.pdf_storage_path) return [];
      try {
        return await extractAndMatchPage(currentPage.pdf_storage_path, currentPage.page_number, products);
      } catch (err) {
        console.error("[VisualCatalog] Live extraction failed:", err);
        return [];
      }
    },
    staleTime: 120000,
  });

  const basketProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const basket of baskets) {
      for (const item of basket.items) {
        counts[item.product.id] = (counts[item.product.id] || 0) + item.quantity;
      }
    }
    return counts;
  }, [baskets]);

  // Favorites set
  const favoriteIds = useMemo(() => new Set(products.filter(p => p.is_pinned).map(p => p.id)), [products]);

  const overlayRegions: OverlayRegion[] = useMemo(() =>
    liveRegions.map((r, idx) => ({
      id: `live-${currentPage?.id || "x"}-${idx}`,
      x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct,
      product: r.product as PaletteProduct | null,
      product_code: r.product_code || "",
      label: r.label || "",
    })),
    [liveRegions, currentPage?.id]
  );

  const hasOverlayRegions = overlayRegions.length > 0;
  const matchedCount = overlayRegions.filter(r => r.product).length;
  const unmatchedCount = overlayRegions.filter(r => !r.product).length;

  // Star overlay positions for favorited products on PDF
  const starOverlays = useMemo(() => {
    return overlayRegions.filter(r => r.product && favoriteIds.has(r.product.id));
  }, [overlayRegions, favoriteIds]);

  // Auto-scroll to first starred product page
  useEffect(() => {
    if (!open || autoScrollDone || pages.length === 0 || favoriteIds.size === 0) return;
    // We need to check all pages' overlay data — for simplicity, just look for favorites in current products
    // and find a page with a matching region once regions are loaded
    if (overlayRegions.length > 0 && starOverlays.length > 0) {
      setAutoScrollDone(true);
      // Already on a page with starred products — scroll to the first star
      const firstStar = starOverlays[0];
      if (scrollContainerRef.current && firstStar) {
        const container = scrollContainerRef.current;
        const targetY = (firstStar.y_pct / 100) * container.scrollHeight;
        setTimeout(() => {
          container.scrollTo({ top: Math.max(0, targetY - 100), behavior: "smooth" });
        }, 300);
      }
    }
  }, [open, autoScrollDone, pages, favoriteIds, overlayRegions, starOverlays]);

  const currentFilePages = useMemo(() => {
    if (!currentPage) return [];
    return pages.filter(p => p.supplier_id === currentPage.supplier_id && p.pdf_filename === currentPage.pdf_filename);
  }, [pages, currentPage]);

  const currentSupplierName = currentPage ? (supplierNameMap[currentPage.supplier_id] || currentPage.supplier_id) : "";
  const currentFilename = currentPage?.pdf_filename || "";

  const goToPage = useCallback((dir: number) => {
    setCurrentPageIndex((prev) => {
      const next = prev + dir;
      if (next < 0 || next >= pages.length) return prev;
      setZoom(1);
      return next;
    });
  }, [pages.length]);

  const handleProductClick = useCallback((product: PaletteProduct) => {
    setPopupProduct(product);
  }, []);

  const handleAddBasket = useCallback(() => {
    onAddBasket?.();
  }, [onAddBasket]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 transition-opacity" onClick={onClose} />

      <div className={`fixed inset-y-0 left-0 z-50 flex bg-background border-r shadow-2xl transition-all duration-300 ease-in-out ${panelWidth}`}>
        {/* LEFT: Compact Zones Sidebar (50% split) */}
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

            {pages.length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(-1)} disabled={currentPageIndex === 0}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-[10px] font-medium text-muted-foreground min-w-[60px] text-center">
                  Page {currentPageIndex + 1} of {pages.length}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => goToPage(1)} disabled={currentPageIndex >= pages.length - 1}>
                  <ChevronRight className="h-3.5 w-3.5" />
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
                <TooltipContent side="bottom" className="text-[10px]">Magnifying glass (scroll to adjust)</TooltipContent>
              </Tooltip>
            </div>

            <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); setCurrentPageIndex(0); }}>
              <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue placeholder="All Suppliers" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Suppliers</SelectItem>
                {supplierOptions.map((s) => (<SelectItem key={s} value={s}>{supplierNameMap[s] || s}</SelectItem>))}
              </SelectContent>
            </Select>

            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {pagesLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-[60vh] w-full" />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center text-muted-foreground">
                <FileImage className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-sm font-medium">No Visual Catalog Pages</p>
                <p className="text-xs mt-1 max-w-[250px]">Import a supplier PDF via the Catalog → Import tab to populate the visual catalog.</p>
              </div>
            ) : currentPage ? (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex flex-1 overflow-hidden">
                  {/* PDF image area with smooth scrolling */}
                  <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-auto"
                    style={{
                      scrollBehavior: "smooth",
                      WebkitOverflowScrolling: "touch",
                      willChange: "transform",
                    }}
                  >
                    <div ref={pdfAreaRef} className="relative bg-muted/10 min-h-[400px]" style={{ cursor: loupeActive ? "none" : zoom > 1 ? "grab" : "default" }}>
                      <div className="relative origin-top-left transition-transform" style={{ transform: `scale(${zoom})` }}>
                        <img
                          src={currentPage.page_image_url}
                          alt={`Page ${currentPage.page_number}`}
                          className="w-full block select-none"
                          loading="lazy"
                          draggable={false}
                        />
                        {hasPdfSource && (
                          <PdfPageOverlay
                            regions={overlayRegions}
                            baskets={baskets}
                            onAddProductToBasket={onAddProductToBasket}
                            basketProductCounts={basketProductCounts}
                            onProductClick={handleProductClick}
                          />
                        )}
                        {/* Star overlays for favorited products */}
                        {starOverlays.map((region) => (
                          <div
                            key={`star-${region.id}`}
                            className="absolute pointer-events-none z-20"
                            style={{
                              left: `${Math.max(0, region.x_pct - 2.5)}%`,
                              top: `${region.y_pct}%`,
                              width: "20px",
                              height: "20px",
                            }}
                          >
                            <Star className="h-4 w-4 fill-yellow-400 text-yellow-500 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
                          </div>
                        ))}
                      </div>
                      <PdfMagnifier
                        active={loupeActive}
                        imageUrl={currentPage.page_image_url}
                        containerRef={pdfAreaRef}
                        baseZoom={zoom}
                      />
                    </div>
                  </div>

                  {/* Fallback product sidebar */}
                  {(!hasPdfSource || !hasOverlayRegions) && (
                    <FallbackProductPanel
                      products={products}
                      supplierId={currentPage.supplier_id}
                      supplierName={currentSupplierName}
                      baskets={baskets}
                      onAddProductToBasket={onAddProductToBasket}
                      basketProductCounts={basketProductCounts}
                    />
                  )}
                </div>

                {/* Status bar */}
                <div className="border-t bg-muted/20 px-3 py-1 shrink-0 flex items-center gap-2">
                  <ScanSearch className="h-3 w-3 text-muted-foreground" />
                  {extracting ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Loader2 className="h-3 w-3 animate-spin" />Scanning PDF text…
                    </span>
                  ) : !hasPdfSource ? (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-2">
                      <Lightbulb className="h-3 w-3" />
                      Tip: Link the original PDF for interactive overlays
                      <PdfLinkButton pages={currentFilePages} />
                    </span>
                  ) : hasOverlayRegions ? (
                    <span className="text-[10px] text-muted-foreground">
                      {matchedCount} matched · {unmatchedCount} unmatched · {starOverlays.length > 0 && `${starOverlays.length} ★ `}Click any highlight to add to quote
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      No text extracted — this may be an image-based PDF
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
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

export default VisualCatalogPanel;
