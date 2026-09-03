/* eslint-disable -- visual catalog panel */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { inclVatFromExcl } from "@/lib/pricing";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PdfSelectionHandlers } from "@/types/pdfSelection";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ZoomIn, ZoomOut, FileImage, ScanSearch, Loader2, Lightbulb, Search, Trash2, Star, Plus, MonitorUp,
  ArrowLeft,
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
import DaikinOverlayDiagnostic from "./DaikinOverlayDiagnostic";

import CategoryNavBar, { groupCategory } from "./CategoryNavBar";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

    // Cross-page dedup removed in Step 2 rebuild — each page handles its own regions independently
import type { WizardTriggerItem } from "./QuoteBuilderPopup";

interface VisualCatalogPanelProps {
  open: boolean;
  onClose: () => void;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
  /** Push all PDF-selected products into the shared quote baskets */
  onAddSelectedToQuote?: () => void;
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
  price_column_bbox?: { x_frac: number; w_frac: number } | null;
}

const VisualCatalogPanel = ({ open, onClose, baskets, onAddProductToBasket, onAddSelectedToQuote, onAddBasket, onRemoveBasket, products, isDragging: isDraggingExternal, onOpenWizard, pdfSearchRef, wizardOpen, pdfSelection }: VisualCatalogPanelProps) => {
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
  const [hoveredPriceOverride, setHoveredPriceOverride] = useState<number | null>(null);
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

  const handleHoverStart = useCallback((product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => {
    setHoveredProduct(product);
    setHoveredPriceOverride(priceOverride ?? null);
    setHoverEvent(e.nativeEvent);
  }, []);

  const handleHoverMove = useCallback((e: React.MouseEvent) => {
    setHoverEvent(e.nativeEvent);
  }, []);

  const handleHoverEnd = useCallback(() => {
    setHoveredProduct(null);
    setHoveredPriceOverride(null);
    setHoverEvent(null);
  }, []);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [categoryPageMap, setCategoryPageMap] = useState<Map<string, number>>(new Map());

  const handleDeleteSupplierPdf = useCallback(async (supplierId: string, opts?: { filename?: string }) => {
    setDeleting(true);
    try {
      // Build alias list — legacy rows may use supplier NAME text instead of UUID.
      const aliases = new Set<string>([supplierId]);
      // Look up the display name for this supplier_id and include it as an alias.
      const { data: supplierRow } = await supabase.from("suppliers").select("name").eq("id", supplierId).maybeSingle();
      const supplierName = (supplierRow as any)?.name?.trim();
      if (supplierName) {
        aliases.add(supplierName);
        aliases.add(supplierName.toUpperCase());
      }
      const aliasArr = Array.from(aliases);

      // Fetch matching rows
      let selectQ = (supabase.from("supplier_pdf_pages") as any)
        .select("id, pdf_storage_path, page_image_url, pdf_filename, supplier_id")
        .in("supplier_id", aliasArr);
      if (opts?.filename) selectQ = selectQ.eq("pdf_filename", opts.filename);
      const { data: pagesToDelete } = await selectQ;

      // Remove storage objects (best-effort)
      const storagePaths = new Set<string>();
      for (const p of (pagesToDelete || []) as any[]) {
        for (const url of [p.page_image_url, p.pdf_storage_path]) {
          if (!url) continue;
          const m = String(url).match(/\/storage\/v1\/object\/(?:public|sign)\/supplier-pdf-pages\/(.+?)(?:\?|$)/);
          if (m) storagePaths.add(decodeURIComponent(m[1]));
        }
      }
      if (storagePaths.size > 0) {
        try { await supabase.storage.from("supplier-pdf-pages").remove(Array.from(storagePaths)); } catch {}
      }

      // Delete rows
      let delQ = (supabase.from("supplier_pdf_pages") as any).delete().in("supplier_id", aliasArr);
      if (opts?.filename) delQ = delQ.eq("pdf_filename", opts.filename);
      const { error } = await delQ;
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["visual-panel-supplier-names"] });
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["pdf-uploads-manager"] });
      toast({ title: opts?.filename ? `Deleted ${opts.filename}` : "Deleted all PDF pages for supplier" });
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

  // Auto-invalidate page/supplier queries when supplier_pdf_pages changes (new uploads, deletes)
  useEffect(() => {
    if (!open) return;
    const channel = supabase
      .channel("visual-panel-pdf-pages")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "supplier_pdf_pages" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["visual-panel-pages"] });
          queryClient.invalidateQueries({ queryKey: ["visual-panel-suppliers"] });
          queryClient.invalidateQueries({ queryKey: ["visual-panel-supplier-names"] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, queryClient]);

  // Fetch suppliers
  // UUID pattern to filter out raw IDs that shouldn't appear as display names
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      const map: Record<string, string> = {};
      // Fallback: raw supplier_id text (used for legacy name-keyed rows)
      for (const opt of supplierOptions) map[opt] = opt;
      // Only query suppliers table with real UUIDs — passing non-UUID text
      // makes Postgres reject the entire .in() query.
      const uuidOpts = supplierOptions.filter((s) => UUID_PATTERN.test(s));
      if (uuidOpts.length > 0) {
        const { data } = await supabase.from("suppliers").select("id, name").in("id", uuidOpts);
        (data || []).forEach((s: any) => { map[s.id] = (s.name || "").trim() || s.id; });
      }
      return map;
    },
    staleTime: 60000,
  });

  // Separate map for supplier_type lookup
  const { data: supplierTypeMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["visual-panel-supplier-types", supplierOptions],
    enabled: open && supplierOptions.length > 0,
    queryFn: async () => {
      const map: Record<string, string> = {};
      const uuidOpts = supplierOptions.filter((s) => UUID_PATTERN.test(s));
      if (uuidOpts.length === 0) return map;
      const { data } = await supabase.from("suppliers").select("id, supplier_type").in("id", uuidOpts);
      (data || []).forEach((s: any) => { if (s.supplier_type) map[s.id] = s.supplier_type; });
      return map;
    },
    staleTime: 60000,
  });


  const { data: pages = [], isLoading: pagesLoading } = useQuery<PdfPage[]>({
    queryKey: ["visual-panel-pages", selectedSupplier],
    enabled: open,
    queryFn: async () => {
      let query = (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url, pdf_storage_path, price_column_bbox")
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

  /**
   * Mobile pinch-zoom containment.
   * Without this, a two-finger pinch inside the PDF escapes to the browser's
   * own page zoom / overscroll, which on mobile webviews unmounts the route
   * and reloads the app. We capture the gesture ourselves (non-passive so
   * preventDefault actually applies) and drive the local `zoom` state.
   */
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    let pinchStartDist = 0;
    let pinchStartZoom = 1;

    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist = dist(e.touches);
        setZoom((z) => {
          pinchStartZoom = z;
          return z;
        });
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDist <= 0) return;
      e.preventDefault();
      const ratio = dist(e.touches) / pinchStartDist;
      setZoom(Math.min(3, Math.max(0.5, pinchStartZoom * ratio)));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartDist = 0;
    };
    // Safari/iOS emits gesture* for pinch — swallow so the page never zooms.
    const swallow = (e: Event) => e.preventDefault();
    // Ctrl+wheel is the trackpad/desktop pinch signal.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => Math.min(3, Math.max(0.5, z * Math.exp(-e.deltaY * 0.002))));
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    el.addEventListener("gesturestart", swallow as EventListener);
    el.addEventListener("gesturechange", swallow as EventListener);
    el.addEventListener("gestureend", swallow as EventListener);
    el.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("gesturestart", swallow as EventListener);
      el.removeEventListener("gesturechange", swallow as EventListener);
      el.removeEventListener("gestureend", swallow as EventListener);
      el.removeEventListener("wheel", onWheel);
    };
  }, [pages.length]);

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
        cost_price: priceVal,
        cost_excl_vat: priceVal,
        default_markup_percent: 20,
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
          <div className="flex items-center gap-2 px-3 py-2 border-b bg-card text-foreground shrink-0">
            {/* Back to quote builder — always first so it stays visible on mobile */}
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1 text-[11px]"
              onClick={onClose}
              title="Close the PDF viewer and return to the quote builder"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Quote Builder
            </Button>

            <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
              <FileImage className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate text-foreground">{currentSupplierName || "Visual Catalog"}</p>
                {currentFilename && <p className="text-[10px] text-muted-foreground truncate">{currentFilename}</p>}
              </div>
              {currentPage && (
                <DaikinOverlayDiagnostic
                  currentSupplierName={(currentPage.supplier_id || "").trim()}
                  currentPageNumber={currentPage.page_number ?? null}
                />
              )}
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
                        Choose what to remove for <strong>{currentSupplierName}</strong>. This also clears any duplicate legacy rows for the same supplier. Cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      {currentFilename && (
                        <AlertDialogAction
                          className="bg-destructive/80 text-destructive-foreground hover:bg-destructive"
                          onClick={() => handleDeleteSupplierPdf(currentPage.supplier_id, { filename: currentFilename })}
                        >
                          Delete this PDF only
                        </AlertDialogAction>
                      )}
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() => handleDeleteSupplierPdf(currentPage.supplier_id)}
                      >
                        Delete ALL PDFs for supplier
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}

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
                  {supplierOptions.filter((s) => s && s.trim() !== '' && !UUID_PATTERN.test(supplierNameMap[s] || s)).map((s) => (<SelectItem key={s} value={s}>{supplierNameMap[s] || s}</SelectItem>))}
                </SelectContent>
              </Select>

              {pdfSelection && pdfSelection.selectedFromPdf.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-[10px] shrink-0"
                  onClick={() => pdfSelection.setSelectedFromPdf([])}
                  title="Clear all selected items"
                >
                  Clear selected ({pdfSelection.selectedFromPdf.length})
                </Button>
              )}

              {onAddSelectedToQuote && pdfSelection && pdfSelection.selectedFromPdf.length > 0 && (
                <Button
                  size="sm"
                  className="h-7 shrink-0 gap-1 text-[11px]"
                  onClick={onAddSelectedToQuote}
                  title="Add the selected PDF products to this quote"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add {pdfSelection.selectedFromPdf.length} to quote
                </Button>
              )}
            </div>
          </div>

          {/* Content: Continuous scroll */}
          <div className="flex-1 min-h-0 overflow-hidden relative">
            {pagesLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-[60vh] w-full" />
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <FileImage className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-sm font-medium">No Visual Catalog Pages</p>
                <p className="text-xs mt-1 max-w-[250px]">Import a supplier PDF via the Catalog → Import tab to populate the visual catalog.</p>
              </div>
            ) : (
              <>
                {/* Scrollable PDF container with all pages stacked */}
                <div
                  ref={scrollContainerRef}
                  className="absolute inset-0 overflow-auto"
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
                          supplierType={supplierTypeMap[page.supplier_id]}
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
            <div className="border-t bg-card text-foreground px-3 py-1 shrink-0 flex items-center gap-2">
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
          priceOverride={hoveredPriceOverride}
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
  onHoverStart?: (product: PaletteProduct | null, e: React.MouseEvent, priceOverride?: number | null) => void;
  onHoverMove?: (e: React.MouseEvent) => void;
  onHoverEnd?: () => void;
  pdfSelection?: PdfSelectionHandlers;
  onProductInfoOpen?: (product: PaletteProduct) => void;
  hdMode?: boolean;
  supplierType?: string;
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
  supplierType,
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

  // Stored regions fallback: query pdf_product_regions only when no PDF source for live extraction
  const { data: storedRegions = [] } = useQuery({
    queryKey: ["visual-panel-stored-regions", page.id],
    enabled: isVisible && !hasPdfSource,
    queryFn: async () => {
      const { data } = await (supabase.from("pdf_product_regions") as any)
        .select("id, product_id, product_code, region_x, region_y, region_width, region_height, label")
        .eq("pdf_page_id", page.id);
      return data || [];
    },
    staleTime: 60000,
  });

  // OCR-stored bboxes from supplier_products — used when client-side text extraction
  // returns nothing (e.g. scanned/image PDFs like Daikin).
  // NOTE: page.supplier_id stores the supplier *name* (legacy), while supplier_products.supplier_id
  // stores a UUID. Resolve the UUID via the suppliers table by name (trimmed).
  const { data: ocrRegions = [] } = useQuery({
    queryKey: ["visual-panel-ocr-bboxes", page.supplier_id, page.page_number],
    enabled: isVisible,
    queryFn: async () => {
      const supplierName = (page.supplier_id || "").trim();
      if (!supplierName) return [];
      // Use wildcards: legacy supplier names may have trailing whitespace in DB
      const { data: supplierRow } = await (supabase.from("suppliers") as any)
        .select("id")
        .ilike("name", `%${supplierName}%`)
        .maybeSingle();
      const supplierUuid = supplierRow?.id;
      if (!supplierUuid) {
        console.warn(`[VisualCatalog] No supplier UUID for "${supplierName}"`);
        return [];
      }
      const { data } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, description, cost_excl_vat, cost_price, default_markup_percent, row_bbox, price_bbox")
        .eq("supplier_id", supplierUuid)
        .eq("page_number", page.page_number)
        .not("row_bbox", "is", null);
      console.log(`[VisualCatalog] OCR bbox query: supplier="${supplierName}" uuid=${supplierUuid} page=${page.page_number} → ${(data || []).length} regions`);
      return data || [];
    },
    staleTime: 120000,
  });

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
        
        // Fetch PDF as blob first to bypass sanitizePdfUrl trimming bug
        // (storage folders may have trailing spaces that sanitize incorrectly removes)
        let pdfUrl = page.pdf_storage_path;
        try {
          const resp = await fetch(page.pdf_storage_path);
          if (resp.ok) {
            const blob = await resp.blob();
            pdfUrl = URL.createObjectURL(blob);
          } else {
            console.warn(`[VisualCatalog] Direct fetch failed (${resp.status}), falling back to raw URL`);
          }
        } catch (fetchErr) {
          console.warn("[VisualCatalog] Blob fetch failed, using raw URL:", fetchErr);
        }

        // First pass: extract and match against existing non-archived products
        const regions = await extractAndMatchPage(pdfUrl, page.page_number, activeProducts, page.supplier_id, supplierType, page.price_column_bbox || null);
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
                cost_price: np.cost_excl_vat || 0,
                selling_price: 0,
                default_markup_percent: 20,
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
                pack_qty: null,
                supplier_discount_percent: null,
                markup_percent: null,
              }));
              
              // Clear cache and re-extract with augmented product list so icons turn blue
              clearExtractionCache();
              const allProducts = [...activeProducts, ...newPaletteProducts];
              const reMatched = await extractAndMatchPage(pdfUrl, page.page_number, allProducts, page.supplier_id, supplierType, page.price_column_bbox || null);
              
              // Invalidate the main products query so palette picks up new items
              queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
              
              // Revoke blob URL if we created one
              if (pdfUrl !== page.pdf_storage_path) URL.revokeObjectURL(pdfUrl);
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
        
        // Revoke blob URL if we created one
        if (pdfUrl !== page.pdf_storage_path) URL.revokeObjectURL(pdfUrl);
        return regions;
      } catch (err) {
        console.error("[VisualCatalog] Live extraction failed:", err);
        return [];
      }
    },
    staleTime: 120000,
  });

  // ─── FALLBACK REGIONS: always compute so overlayRegions can pick the richer source ───
  const fallbackRegions: OverlayRegion[] = useMemo(() => {
    // OCR-stored bboxes and stored regions are always computed; the overlayRegions
    // memo decides whether they win over the live text extraction based on coverage.

    // Primary fallback: OCR-extracted bboxes stored on supplier_products
    // (handles scanned/image PDFs e.g. Daikin where client-side text extraction fails)
    if (ocrRegions.length > 0) {
      return (ocrRegions as any[]).map((sp, idx) => {
        const rb = sp.row_bbox || {};
        const paletteProduct = activeProducts.find(p => p.id === sp.id || p.product_code === sp.product_code) || null;
        const cost = sp.cost_excl_vat ?? sp.cost_price ?? 0;
        return {
          id: `ocr-${page.id}-${sp.id}-${idx}`,
          x_pct: (rb.x ?? 0) * 100,
          y_pct: (rb.y ?? 0) * 100,
          w_pct: (rb.width ?? 1) * 100,
          h_pct: (rb.height ?? 0.02) * 100,
          product: paletteProduct,
          product_code: sp.product_code || "",
          label: sp.short_name || sp.description || sp.product_code || "",
          has_price: cost > 0,
          detected_price: cost || null,
          matched: !!paletteProduct,
        } as OverlayRegion;
      });
    }

    // Secondary: use stored regions from pdf_product_regions table
    if (storedRegions.length > 0) {
      return storedRegions.map((sr: any, idx: number) => {
        const paletteProduct = activeProducts.find(p => p.id === sr.product_id || p.product_code === sr.product_code) || null;
        return {
          id: `stored-${page.id}-${idx}`,
          x_pct: sr.region_x ?? 0,
          y_pct: sr.region_y ?? (idx * 3),
          w_pct: sr.region_width ?? 100,
          h_pct: sr.region_height ?? 2.5,
          product: paletteProduct,
          product_code: sr.product_code || "",
          label: sr.label || paletteProduct?.short_name || "",
          has_price: !!(paletteProduct?.selling_price || paletteProduct?.cost_incl_vat),
          detected_price: paletteProduct?.selling_price || paletteProduct?.cost_incl_vat || null,
          matched: !!paletteProduct,
        };
      });
    }

    return [];
  }, [liveRegions, ocrRegions, storedRegions, activeProducts, page.id]);

  // ─── OVERLAY REGIONS: prefer whichever source found more product rows ───
  const overlayRegions: OverlayRegion[] = useMemo(() => {
    // Prefer live text extraction, BUT if stored OCR bboxes cover meaningfully more
    // rows than live (e.g. OSS/consumables PDFs where the locked text extractor
    // only detects a handful of rows), fall back to the richer OCR source so every
    // priced row still gets an icon pair. Never modify the locked extractor for this.
    const ocrCount = fallbackRegions.length;
    const liveCount = liveRegions.length;
    const useOcr = liveCount === 0 || ocrCount > liveCount + 3;
    const sourceRegions = useOcr ? fallbackRegions : liveRegions;
    const result: OverlayRegion[] = [];

    const seenOnPage = new Set<string>();
    for (let idx = 0; idx < sourceRegions.length; idx++) {
      const r = sourceRegions[idx];
      if (!r || r.y_pct == null || r.h_pct == null || r.h_pct <= 0) continue;
      if (r.h_pct > 8) continue;

      // Within-page dedup by product_code|label|price
      const label = (r.label || "").substring(0, 80);
      const price = r.detected_price ?? "no-price";
      const dedupKeyPage = `${r.product_code || ""}|${label}|${price}`;
      if (seenOnPage.has(dedupKeyPage)) continue;
      seenOnPage.add(dedupKeyPage);

      // Resolve product from activeProducts if extractor matched by code but didn't attach object
      const rawCode = (r.product_code || "").toLowerCase().trim();
      const rawCodeBase = rawCode.split("@")[0].trim();
      // Normalize: strip whitespace, dashes, slashes for fuzzy compare
      const normalize = (s: string) => s.toLowerCase().replace(/[\s\-\/\._]+/g, "");
      const normRaw = normalize(rawCodeBase);

      // 1. Exact match
      let resolvedProduct = r.product
        || (rawCode ? activeProducts.find(p => p.product_code.toLowerCase().trim() === rawCode) || null : null);

      // 2. Normalized exact match
      if (!resolvedProduct && normRaw) {
        resolvedProduct = activeProducts.find(p => normalize(p.product_code) === normRaw) || null;
      }

      // 3. Substring/contains match
      if (!resolvedProduct && normRaw.length >= 4) {
        resolvedProduct = activeProducts.find(p => {
          const normDb = normalize(p.product_code);
          return normDb.length >= 4 && (normRaw.includes(normDb) || normDb.includes(normRaw));
        }) || null;
      }

      // 4. StartsWith match (DB code starts with extracted code or vice versa)
      if (!resolvedProduct && normRaw.length >= 4) {
        resolvedProduct = activeProducts.find(p => {
          const normDb = normalize(p.product_code);
          return normDb.length >= 4 && (normDb.startsWith(normRaw) || normRaw.startsWith(normDb));
        }) || null;
      }

      // 5. Label-based match as last resort
      if (!resolvedProduct && r.label) {
        const normLabel = normalize(r.label);
        resolvedProduct = activeProducts.find(p => {
          const normPc = normalize(p.product_code);
          return normPc.length >= 4 && normLabel.includes(normPc);
        }) || null;
      }

      const finalMatched = r.matched === true || !!resolvedProduct;
      result.push({
        id: `live-${page.id}-${idx}`,
        x_pct: r.x_pct, y_pct: r.y_pct, w_pct: r.w_pct, h_pct: r.h_pct,
        product: resolvedProduct as PaletteProduct | null,
        product_code: r.product_code || "",
        label: r.label || "",
        has_price: r.has_price,
        detected_price: r.detected_price,
        matched: finalMatched,
      });
    }

    // FUNDAMENTAL RULE: If extraction/OCR found no real regions on a page,
    // that page should show 0 items and 0 overlay controls.

    return result;
  }, [liveRegions, ocrRegions, fallbackRegions, page.id, pageIndex]);

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
        {isVisible && unmatchedCount > 0 && (
          <span className="text-red-300 text-[8px] ml-1">
            [{overlayRegions.filter(r => !r.product).map(r => (r.label || r.product_code || '?').substring(0, 80)).join(' | ')}]
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
              onOpenProductInfo={onProductInfoOpen}
              favoriteIds={favoriteIds}
             />
          )}
          {/* Banner for image-based/scanned pages where pdf.js text extraction returns 0 regions */}
          {isVisible && !extracting && overlayRegions.length === 0 && activeProducts.length > 0 && (
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 z-20 flex justify-center pointer-events-none">
              <div className="bg-primary/90 text-primary-foreground rounded-lg px-4 py-3 shadow-lg max-w-[80%] text-center pointer-events-auto">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <FileImage className="h-4 w-4" />
                  <span className="font-semibold text-sm">Scanned Page — No Text Layer</span>
                </div>
                <p className="text-xs opacity-90">
                  {activeProducts.length} products imported for this supplier. Use the <strong>Product Palette</strong> on the left to search and add them to your quote.
                </p>
              </div>
            </div>
          )}
          {extracting && (
            <div className="absolute top-2 right-2 z-30 bg-black/50 text-white text-[9px] px-2 py-1 rounded flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> Scanning…
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center h-[600px] bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/40" />
        </div>
      )}
    </div>
  );
};

export default VisualCatalogPanel;
