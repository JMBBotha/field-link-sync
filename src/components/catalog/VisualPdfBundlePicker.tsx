import { useState, useMemo, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileImage, ZoomIn, ZoomOut, Search, X, ChevronLeft, ChevronRight, Plus, Package,
} from "lucide-react";
import { allTermsMatchBlob } from "./searchSynonyms";
import { toast } from "sonner";

interface PdfPage {
  id: string;
  supplier_id: string;
  pdf_filename: string;
  page_number: number;
  page_image_url: string;
}

interface VisualPdfBundlePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddProduct: (product: any) => void;
  existingProductIds: Set<string>;
}

const VisualPdfBundlePicker = ({ open, onOpenChange, onAddProduct, existingProductIds }: VisualPdfBundlePickerProps) => {
  const [selectedSupplier, setSelectedSupplier] = useState("all");
  const [zoom, setZoom] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [showResults, setShowResults] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch supplier list that have PDF pages
  const { data: supplierIds = [] } = useQuery({
    queryKey: ["bundle-pdf-suppliers"],
    enabled: open,
    queryFn: async () => {
      const { data } = await (supabase.from("supplier_pdf_pages") as any)
        .select("supplier_id")
        .neq("supplier_id", "")
        .order("supplier_id");
      if (!data) return [];
      return [...new Set((data as any[]).map((d) => d.supplier_id))].filter(Boolean) as string[];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["bundle-pdf-supplier-names", supplierIds],
    enabled: open && supplierIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, supplier_type")
        .in("id", supplierIds)
        .order("name");
      return (data || []) as { id: string; name: string; supplier_type: string }[];
    },
  });

  // Filter to consumables/parts suppliers
  const consumablesSuppliers = useMemo(() =>
    suppliers.filter(s => s.supplier_type === "consumables" || s.supplier_type === "both"),
    [suppliers]
  );

  // Fetch PDF pages
  const { data: pages = [], isLoading: pagesLoading } = useQuery({
    queryKey: ["bundle-pdf-pages", selectedSupplier],
    enabled: open,
    queryFn: async () => {
      let query = (supabase.from("supplier_pdf_pages") as any)
        .select("id, supplier_id, pdf_filename, page_number, page_image_url")
        .order("supplier_id")
        .order("pdf_filename")
        .order("page_number");

      if (selectedSupplier !== "all") {
        query = query.eq("supplier_id", selectedSupplier);
      } else {
        // Show all suppliers that have consumables type
        const consumableIds = consumablesSuppliers.map(s => s.id);
        if (consumableIds.length > 0) {
          query = query.in("supplier_id", consumableIds);
        }
      }

      const { data } = await query.limit(500);
      return (data || []) as PdfPage[];
    },
  });

  // Product search for clicking add from visual
  const { data: searchResults = [] } = useQuery({
    queryKey: ["bundle-visual-search", search],
    enabled: search.length >= 2,
    queryFn: async () => {
      const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];

      const { data, error } = await supabase
        .from("supplier_products")
        .select("id, description, product_code, cost_price, price_per_metre, sold_in_length, pipe_size, short_name, brand, category, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .or(`product_code.ilike.%${terms[0]}%,short_name.ilike.%${terms[0]}%,description.ilike.%${terms[0]}%`)
        .limit(200);
      if (error) throw error;

      return (data || []).filter((p: any) => {
        const blob = [p.product_code, p.short_name, p.description, p.brand, p.category, p.suppliers?.name]
          .filter(Boolean).join(" ").toLowerCase();
        return allTermsMatchBlob(terms, blob);
      }) as any[];
    },
  });

  const currentPage = pages[pageIndex];
  const supplierForPage = useMemo(() => {
    if (!currentPage) return null;
    return suppliers.find(s => s.id === currentPage.supplier_id);
  }, [currentPage, suppliers]);

  const handleAddFromSearch = (product: any) => {
    if (existingProductIds.has(product.id)) {
      toast.info("Item already in bundle");
      return;
    }
    onAddProduct(product);
    toast.success(`Added ${product.short_name || product.product_code}`);
  };

  const goPage = (dir: number) => {
    setPageIndex(prev => Math.max(0, Math.min(pages.length - 1, prev + dir)));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <FileImage className="h-4 w-4 text-primary" />
            Visual PDF Browser — Consumables
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-muted/30 shrink-0 flex-wrap">
          <Select value={selectedSupplier} onValueChange={(v) => { setSelectedSupplier(v); setPageIndex(0); }}>
            <SelectTrigger className="h-8 w-48 text-xs">
              <SelectValue placeholder="All Consumables Suppliers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Consumables Suppliers</SelectItem>
              {(consumablesSuppliers.length > 0 ? consumablesSuppliers : suppliers).map(s => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setZoom(z => Math.min(2, z + 0.25))}>
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageIndex === 0} onClick={() => goPage(-1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground min-w-[60px] text-center">
              {pages.length > 0 ? `${pageIndex + 1} / ${pages.length}` : "—"}
            </span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={pageIndex >= pages.length - 1} onClick={() => goPage(1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Main content: PDF viewer + search panel */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* PDF page viewer */}
          <div ref={scrollRef} className="flex-1 overflow-auto bg-muted/20 p-4 flex justify-center">
            {pagesLoading ? (
              <div className="flex flex-col items-center gap-3 pt-12">
                <Skeleton className="w-[400px] h-[560px] rounded" />
                <p className="text-xs text-muted-foreground">Loading PDF pages...</p>
              </div>
            ) : pages.length === 0 ? (
              <div className="flex flex-col items-center gap-3 pt-12 text-muted-foreground">
                <FileImage className="h-12 w-12" />
                <p className="text-sm">No PDF pages found for consumables suppliers.</p>
                <p className="text-xs">Import supplier price list PDFs first via the Import tab.</p>
              </div>
            ) : currentPage ? (
              <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}>
                <img
                  src={currentPage.page_image_url}
                  alt={`${currentPage.pdf_filename} - Page ${currentPage.page_number}`}
                  className="max-w-full rounded shadow-md border"
                  draggable={false}
                />
                {supplierForPage && (
                  <div className="absolute top-2 left-2">
                    <Badge variant="secondary" className="text-[10px] bg-background/80 backdrop-blur-sm">
                      {supplierForPage.name} — p.{currentPage.page_number}
                    </Badge>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Side search panel */}
          <div className="w-72 border-l flex flex-col bg-background shrink-0">
            <div className="p-3 border-b">
              <p className="text-xs font-medium mb-2 text-muted-foreground">
                Browse the PDF, then search & add items below
              </p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={e => { setSearch(e.target.value); setShowResults(true); }}
                  placeholder="Search product code or name..."
                  className="pl-8 h-8 text-xs"
                />
                {search && (
                  <Button variant="ghost" size="icon" className="absolute right-0.5 top-0.5 h-7 w-7" onClick={() => { setSearch(""); setShowResults(false); }}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {search.length < 2 ? (
                <div className="flex flex-col items-center gap-2 pt-8 text-muted-foreground">
                  <Package className="h-8 w-8" />
                  <p className="text-xs text-center px-4">
                    View the PDF price list on the left, then type a product code or name here to find and add it to your bundle.
                  </p>
                </div>
              ) : searchResults.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center pt-6">No products found</p>
              ) : (
                searchResults.map(p => {
                  const alreadyAdded = existingProductIds.has(p.id);
                  return (
                    <div
                      key={p.id}
                      className={`flex items-start gap-2 p-2 rounded text-xs border transition-colors ${
                        alreadyAdded
                          ? "bg-primary/5 border-primary/20 opacity-60"
                          : "hover:bg-muted cursor-pointer border-transparent hover:border-border"
                      }`}
                      onClick={() => !alreadyAdded && handleAddFromSearch(p)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-muted-foreground shrink-0">{p.product_code}</span>
                          {alreadyAdded && (
                            <Badge variant="secondary" className="text-[8px] px-1 h-3.5">Added</Badge>
                          )}
                        </div>
                        <div className="font-medium truncate mt-0.5">{p.short_name || p.description?.slice(0, 50)}</div>
                        <div className="text-[10px] text-muted-foreground flex gap-1.5 mt-0.5 flex-wrap">
                          {p.pipe_size && <span>⌀ {p.pipe_size}</span>}
                          {p.suppliers?.name && <span>• {p.suppliers.name}</span>}
                          <span className="font-medium">R{(p.cost_price || 0).toFixed(2)}</span>
                          {p.sold_in_length && p.price_per_metre && (
                            <Badge variant="outline" className="text-[8px] h-3.5 px-1 border-green-500/50 text-green-700">
                              📏 R{p.price_per_metre.toFixed(2)}/m
                            </Badge>
                          )}
                        </div>
                      </div>
                      {!alreadyAdded && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-primary">
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default VisualPdfBundlePicker;