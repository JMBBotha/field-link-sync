import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plus, Check, ZoomIn, ZoomOut, X, Maximize2, Minimize2,
  ChevronLeft, ChevronRight, FileImage, ArrowLeft,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface VisualCatalogPanelProps {
  open: boolean;
  onClose: () => void;
  baskets: Basket[];
  onAddProductToBasket: (basketId: string, product: PaletteProduct) => void;
}

interface PdfPage {
  id: string;
  supplier_id: string;
  pdf_filename: string;
  page_number: number;
  page_image_url: string;
}

interface ProductRegion {
  id: string;
  pdf_page_id: string;
  product_id: string | null;
  product_code: string;
  label: string;
  product?: PaletteProduct | null;
}

const VisualCatalogPanel = ({ open, onClose, baskets, onAddProductToBasket }: VisualCatalogPanelProps) => {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);

  const isFullWidth = isMobile || expanded;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setCurrentPageIndex(0);
      setZoom(1);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Fetch suppliers from pdf pages
  const { data: supplierOptions = [] } = useQuery({
    queryKey: ["visual-panel-suppliers"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("supplier_pdf_pages") as any)
        .select("supplier_id")
        .order("supplier_id");
      if (!data) return [];
      const unique = [...new Set((data as any[]).map((d) => d.supplier_id))];
      return unique as string[];
    },
    staleTime: 60000,
  });

  // Fetch supplier names for display
  const { data: supplierNameMap = {} } = useQuery({
    queryKey: ["visual-panel-supplier-names", supplierOptions],
    enabled: open && supplierOptions.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .in("id", supplierOptions);
      const map: Record<string, string> = {};
      (data || []).forEach((s: any) => { map[s.id] = s.name; });
      return map;
    },
    staleTime: 60000,
  });

  // Fetch pdf pages
  const { data: pages = [], isLoading: pagesLoading } = useQuery<PdfPage[]>({
    queryKey: ["visual-panel-pages", selectedSupplier],
    enabled: open,
    queryFn: async () => {
      let query = (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url")
        .order("supplier_id")
        .order("pdf_filename")
        .order("page_number");

      if (selectedSupplier !== "all") {
        query = query.eq("supplier_id", selectedSupplier);
      }

      const { data, error } = await query.limit(500);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,
  });

  // Fetch product regions for current page
  const currentPage = pages[currentPageIndex] || null;
  const { data: regions = [] } = useQuery<ProductRegion[]>({
    queryKey: ["visual-panel-regions", currentPage?.id],
    enabled: open && !!currentPage,
    queryFn: async () => {
      if (!currentPage) return [];
      const { data, error } = await (supabase.from("pdf_product_regions") as any)
        .select(
          "id, pdf_page_id, product_id, product_code, label, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name))"
        )
        .eq("pdf_page_id", currentPage.id);
      if (error) throw error;
      return (data || []).map((r: any) => ({
        ...r,
        product: r.supplier_products
          ? {
              ...r.supplier_products,
              product_category: r.supplier_products.product_category || r.supplier_products.category || "",
              supplier_name: r.supplier_products.suppliers?.name || "",
              price_per_metre: r.supplier_products.price_per_metre || null,
              sold_in_length: r.supplier_products.sold_in_length || false,
              unit_length: r.supplier_products.unit_length || null,
            }
          : null,
      }));
    },
    staleTime: 30000,
  });

  // Track what's in baskets
  const basketProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const basket of baskets) {
      for (const item of basket.items) {
        counts[item.product.id] = (counts[item.product.id] || 0) + item.quantity;
      }
    }
    return counts;
  }, [baskets]);

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

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-in Panel */}
      <div
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-background border-r shadow-2xl transition-all duration-300 ease-in-out ${
          isFullWidth ? "w-full" : "w-1/2"
        }`}
      >
        {/* Panel Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 shrink-0">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <FileImage className="h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate text-foreground">
                {currentSupplierName || "Visual Catalog"}
              </p>
              {currentFilename && (
                <p className="text-[10px] text-muted-foreground truncate">{currentFilename}</p>
              )}
            </div>
          </div>

          {/* Page navigation */}
          {pages.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => goToPage(-1)}
                disabled={currentPageIndex === 0}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-[10px] font-medium text-muted-foreground min-w-[60px] text-center">
                Page {currentPageIndex + 1} of {pages.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => goToPage(1)}
                disabled={currentPageIndex >= pages.length - 1}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Zoom */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[10px] text-muted-foreground w-9 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>

          {/* Supplier filter */}
          <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); setCurrentPageIndex(0); }}>
            <SelectTrigger className="h-7 w-32 text-[10px]">
              <SelectValue placeholder="All Suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Suppliers</SelectItem>
              {supplierOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {supplierNameMap[s] || s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Width toggle — hidden on mobile (always full) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? "Half screen" : "Full screen"}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          )}

          {/* Close */}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
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
              <p className="text-xs mt-1 max-w-[250px]">
                Import a supplier PDF via the Catalog → Import tab to populate the visual catalog.
              </p>
            </div>
          ) : currentPage ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* PDF Page image */}
              <ScrollArea className="flex-1">
                <div
                  className="relative bg-muted/10 min-h-[400px]"
                  style={{ cursor: zoom > 1 ? "grab" : "default" }}
                >
                  <img
                    src={currentPage.page_image_url}
                    alt={`Page ${currentPage.page_number}`}
                    className="w-full transition-transform origin-top-left"
                    style={{ transform: `scale(${zoom})` }}
                    loading="lazy"
                  />

                  {/* Product overlays would go here when region positioning data is available */}
                  {/* For now, products are listed below the PDF */}
                </div>
              </ScrollArea>

              {/* Products from this page */}
              {regions.length > 0 && (
                <div className="border-t bg-card shrink-0 max-h-[200px] overflow-y-auto">
                  <div className="px-3 py-2 space-y-1">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Products on this page ({regions.length})
                    </p>
                    {regions.map((region) => {
                      const product = region.product as PaletteProduct | null;
                      if (!product) {
                        // Unmatched item
                        return (
                          <div
                            key={region.id}
                            className="flex items-center gap-2 py-1.5 border-b last:border-0 border-dashed opacity-60"
                          >
                            <span className="text-[10px] font-mono text-muted-foreground truncate min-w-[80px]">
                              {region.product_code}
                            </span>
                            <span className="text-[10px] truncate flex-1 text-muted-foreground italic">
                              {region.label || "Unknown product"}
                            </span>
                            <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-dashed text-muted-foreground">
                              Not in catalog
                            </Badge>
                          </div>
                        );
                      }

                      const inQuoteQty = basketProductCounts[product.id] || 0;
                      const price = product.selling_price || product.cost_incl_vat || 0;

                      return (
                        <div
                          key={region.id}
                          className="flex items-center gap-2 py-1.5 border-b last:border-0 hover:bg-muted/30 rounded px-1 -mx-1 transition-colors"
                        >
                          <span className="text-[10px] font-mono font-medium text-primary/80 truncate min-w-[80px]">
                            {product.product_code}
                          </span>
                          <span className="text-[10px] truncate flex-1 text-foreground">
                            {product.short_name || product.description}
                          </span>
                          {product.sold_in_length && product.price_per_metre && (
                            <Badge variant="outline" className="text-[8px] px-1 py-0 h-4 border-orange-400/40 text-orange-600">
                              R{product.price_per_metre.toFixed(2)}/m
                            </Badge>
                          )}
                          <span className="text-[10px] font-bold text-foreground whitespace-nowrap">
                            R{price.toLocaleString("en-ZA")}
                          </span>
                          {inQuoteQty > 0 && (
                            <Badge
                              variant="secondary"
                              className="text-[8px] px-1 py-0 h-4 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            >
                              <Check className="h-2 w-2 mr-0.5" />
                              {inQuoteQty}
                            </Badge>
                          )}
                          <AddToZoneButton
                            baskets={baskets}
                            product={product}
                            onAdd={onAddProductToBasket}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Floating "Back to Quote" button — visible in full-width mode */}
        {isFullWidth && (
          <div className="absolute bottom-4 right-4 z-10">
            <Button
              variant="default"
              size="sm"
              className="shadow-lg gap-1.5"
              onClick={onClose}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Quote
            </Button>
          </div>
        )}
      </div>
    </>
  );
};

function AddToZoneButton({
  baskets,
  product,
  onAdd,
}: {
  baskets: Basket[];
  product: PaletteProduct;
  onAdd: (basketId: string, product: PaletteProduct) => void;
}) {
  if (baskets.length === 0) return null;

  if (baskets.length === 1) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={() => onAdd(baskets[0].id, product)}
      >
        <Plus className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
          <Plus className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="end">
        <p className="text-[9px] font-semibold text-muted-foreground uppercase px-2 py-1">
          Add to zone
        </p>
        {baskets.map((basket) => (
          <Button
            key={basket.id}
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => onAdd(basket.id, product)}
          >
            {basket.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default VisualCatalogPanel;
