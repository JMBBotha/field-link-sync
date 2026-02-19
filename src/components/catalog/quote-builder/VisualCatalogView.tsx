import { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Check, ZoomIn, ZoomOut, FileImage, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/hooks/use-toast";
import type { PaletteProduct, Basket } from "../QuoteBuilderTab";

interface VisualCatalogViewProps {
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

const VisualCatalogView = ({ baskets, onAddProductToBasket }: VisualCatalogViewProps) => {
  const queryClient = useQueryClient();
  const [selectedSupplier, setSelectedSupplier] = useState<string>("all");
  const [zoomLevels, setZoomLevels] = useState<Record<string, number>>({});

  const handleDeleteSupplierPdf = useCallback(async (supplierId: string) => {
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
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-pages"] });
      queryClient.invalidateQueries({ queryKey: ["visual-catalog-suppliers"] });
      toast({ title: "PDF pages deleted successfully" });
    } catch (err) {
      console.error("Delete PDF failed:", err);
      toast({ title: "Failed to delete PDF pages", variant: "destructive" });
    }
  }, [queryClient]);

  // Fetch available suppliers from pdf pages
  const { data: suppliers = [] } = useQuery({
    queryKey: ["visual-catalog-suppliers"],
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

  // Fetch pdf pages
  const { data: pages = [], isLoading: pagesLoading } = useQuery<PdfPage[]>({
    queryKey: ["visual-catalog-pages", selectedSupplier],
    queryFn: async () => {
      let query = (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url")
        .order("supplier_id")
        .order("pdf_filename")
        .order("page_number");

      if (selectedSupplier !== "all") {
        query = query.eq("supplier_id", selectedSupplier);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data || [];
    },
    staleTime: 30000,
  });

  // Fetch product regions for visible pages
  const pageIds = pages.map((p) => p.id);
  const { data: regions = [] } = useQuery<ProductRegion[]>({
    queryKey: ["visual-catalog-regions", pageIds.join(",")],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("pdf_product_regions") as any)
        .select(
          "id, pdf_page_id, product_id, product_code, label, supplier_products(id, product_code, short_name, brand, product_category, category, cost_excl_vat, cost_incl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, suppliers(name))"
        )
        .in("pdf_page_id", pageIds);
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

  // Group regions by page
  const regionsByPage = useMemo(() => {
    const map: Record<string, ProductRegion[]> = {};
    for (const r of regions) {
      if (!map[r.pdf_page_id]) map[r.pdf_page_id] = [];
      map[r.pdf_page_id].push(r);
    }
    return map;
  }, [regions]);

  // Track what's already in baskets
  const basketProductCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const basket of baskets) {
      for (const item of basket.items) {
        counts[item.product.id] = (counts[item.product.id] || 0) + item.quantity;
      }
    }
    return counts;
  }, [baskets]);

  // Group pages by filename - must be before early returns
  const pagesByFile = useMemo(() => {
    const grouped: Record<string, PdfPage[]> = {};
    for (const page of pages) {
      const key = `${page.supplier_id}::${page.pdf_filename}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(page);
    }
    return grouped;
  }, [pages]);

  const getZoom = (pageId: string) => zoomLevels[pageId] || 1;
  const setZoom = (pageId: string, zoom: number) => {
    setZoomLevels((prev) => ({ ...prev, [pageId]: Math.max(0.5, Math.min(3, zoom)) }));
  };

  if (pagesLoading) {
    return (
      <div className="space-y-3 p-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
        <FileImage className="h-12 w-12 mb-3 opacity-40" />
        <p className="text-sm font-medium">No Visual Catalog Pages</p>
        <p className="text-xs mt-1 max-w-[250px]">
          Import a supplier PDF via the Catalog → Import tab to populate the visual catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Supplier filter */}
      <div className="flex items-center gap-2 px-1">
        <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue placeholder="All Suppliers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.filter((s) => s && s.trim() !== '').map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className="text-[10px]">
          {pages.length} pages
        </Badge>
      </div>

      {/* Pages grid */}
      <ScrollArea className="flex-1" style={{ maxHeight: "calc(100vh - 340px)" }}>
        <div className="space-y-6 p-1">
          {Object.entries(pagesByFile).map(([fileKey, filePages]) => {
            const [supplier, filename] = fileKey.split("::");
            return (
              <div key={fileKey} className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                    {supplier} — {filename}
                  </p>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete PDF pages?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Delete all PDF pages for <strong>{supplier}</strong>? This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => handleDeleteSupplierPdf(filePages[0]?.supplier_id || supplier)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filePages.map((page) => {
                    const pageRegions = regionsByPage[page.id] || [];
                    const zoom = getZoom(page.id);
                    return (
                      <div
                        key={page.id}
                        className="rounded-lg border bg-card shadow-sm overflow-hidden"
                      >
                        {/* Page header */}
                        <div className="flex items-center justify-between px-2 py-1.5 border-b bg-muted/30">
                          <Badge variant="secondary" className="text-[10px]">
                            Page {page.page_number}
                          </Badge>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setZoom(page.id, zoom - 0.25)}
                            >
                              <ZoomOut className="h-3 w-3" />
                            </Button>
                            <span className="text-[10px] text-muted-foreground w-8 text-center">
                              {Math.round(zoom * 100)}%
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => setZoom(page.id, zoom + 0.25)}
                            >
                              <ZoomIn className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>

                        {/* Page image */}
                        <div
                          className="overflow-auto max-h-[400px] bg-muted/10"
                          style={{ cursor: zoom > 1 ? "grab" : "default" }}
                        >
                          <img
                            src={page.page_image_url}
                            alt={`Page ${page.page_number}`}
                            className="w-full transition-transform origin-top-left"
                            style={{ transform: `scale(${zoom})` }}
                            loading="lazy"
                          />
                        </div>

                        {/* Products from this page */}
                        {pageRegions.length > 0 && (
                          <div className="border-t px-2 py-1.5 space-y-1 max-h-[200px] overflow-y-auto">
                            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                              Products on this page ({pageRegions.length})
                            </p>
                            {pageRegions.map((region) => {
                              const product = region.product as PaletteProduct | null;
                              if (!product) return null;
                              const inQuoteQty = basketProductCounts[product.id] || 0;
                              const price = product.selling_price || product.cost_incl_vat || 0;

                              return (
                                <div
                                  key={region.id}
                                  className="flex items-center gap-2 py-1 border-b last:border-0"
                                >
                                  <span className="text-[10px] font-mono font-medium text-primary/80 truncate min-w-[80px]">
                                    {product.product_code}
                                  </span>
                                  <span className="text-[10px] truncate flex-1 text-foreground">
                                    {product.short_name || product.description}
                                  </span>
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
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
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
        className="h-5 w-5 shrink-0"
        onClick={() => onAdd(baskets[0].id, product)}
      >
        <Plus className="h-3 w-3" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0">
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

export default VisualCatalogView;
