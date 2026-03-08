/**
 * PdfViewerWithOverlays — renders supplier PDF page images with
 * interactive bbox overlays for each extracted product row.
 *
 * Usage: <PdfViewerWithOverlays supplierId={id} uploadId={uploadId} />
 */

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShoppingCart, CircleDot, ChevronLeft, ChevronRight } from "lucide-react";
import { calculatePricing } from "@/utils/pricing";
import { formatRand } from "@/utils/formatRand";

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayProduct {
  id: string;
  product_code: string;
  short_name: string | null;
  description: string;
  cost_price: number;
  cost_excl_vat: number;
  default_markup_percent: number;
  supplier_discount_percent?: number;
  row_bbox: BBox | null;
  price_bbox: BBox | null;
  page_number: number | null;
}

interface PdfViewerWithOverlaysProps {
  supplierId: string;
  uploadId?: string | null;
}

const PdfViewerWithOverlays: React.FC<PdfViewerWithOverlaysProps> = ({
  supplierId,
  uploadId,
}) => {
  const [pages, setPages] = useState<string[]>([]);
  const [products, setProducts] = useState<OverlayProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<OverlayProduct | null>(null);
  const [dimensions, setDimensions] = useState<Record<number, { w: number; h: number }>>({});
  const containerRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load page images + products
  useEffect(() => {
    async function loadData() {
      // Page images from storage
      const folderPath = uploadId
        ? `${supplierId}/${uploadId}`
        : `${supplierId}`;

      const { data: files } = await supabase.storage
        .from("supplier-pdf-pages")
        .list(folderPath, { sortBy: { column: "name", order: "asc" } });

      if (files?.length) {
        const urls = files
          .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f.name))
          .map((f) => {
            const { data } = supabase.storage
              .from("supplier-pdf-pages")
              .getPublicUrl(`${folderPath}/${f.name}`);
            return data.publicUrl;
          });
        setPages(urls);
      }

      // Products with bbox data
      const query = (supabase.from("supplier_products") as any)
        .select(
          "id, product_code, short_name, description, cost_price, cost_excl_vat, default_markup_percent, supplier_discount_percent, row_bbox, price_bbox, page_number"
        )
        .eq("supplier_id", supplierId)
        .not("page_number", "is", null)
        .not("price_bbox", "is", null);

      const { data } = await query;
      setProducts((data as OverlayProduct[]) || []);
    }

    loadData();
  }, [supplierId, uploadId]);

  // Track container dimensions on resize
  const updateDimensions = useCallback(() => {
    const dims: Record<number, { w: number; h: number }> = {};
    containerRefs.current.forEach((el, i) => {
      if (el) dims[i] = { w: el.clientWidth, h: el.clientHeight };
    });
    setDimensions(dims);
  }, []);

  useEffect(() => {
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [updateDimensions]);

  const computePricing = (p: OverlayProduct) => {
    const markup = p.default_markup_percent || 20;
    const costExVat = p.cost_excl_vat || p.cost_price || 0;
    const sellingExVat = costExVat * (1 + markup / 100);
    return { costExVat, sellingExVat, markup };
  };

  const productsForPage = (pageIdx: number) =>
    products.filter((p) => p.page_number === pageIdx + 1 && p.row_bbox && p.price_bbox);

  if (!pages.length) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        No PDF pages available for this supplier.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pages.map((pageUrl, pageIdx) => (
        <div
          key={pageIdx}
          ref={(el) => {
            containerRefs.current[pageIdx] = el;
          }}
          className="relative inline-block w-full"
        >
          <img
            src={pageUrl}
            alt={`Page ${pageIdx + 1}`}
            className="w-full h-auto block"
            onLoad={updateDimensions}
          />

          {productsForPage(pageIdx).map((product) => {
            const dim = dimensions[pageIdx];
            if (!dim || !product.row_bbox || !product.price_bbox) return null;
            const { w, h } = dim;
            const rb = product.row_bbox;
            const pb = product.price_bbox;

            const priceCenterX = pb.x * w + (pb.width * w) / 2;
            const priceCenterY = pb.y * h + (pb.height * h) / 2;

            return (
              <div key={product.id}>
                {/* Row gradient overlay */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: `${rb.y * h}px`,
                    left: `${rb.x * w}px`,
                    width: `${rb.width * w}px`,
                    height: `${rb.height * h}px`,
                    background:
                      "linear-gradient(to right, hsl(var(--primary) / 0.15), transparent, hsl(var(--primary) / 0.15))",
                    borderRadius: "2px",
                  }}
                />

                {/* Left chevron + radio icon */}
                <div
                  className="absolute flex items-center gap-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                  style={{
                    top: `${priceCenterY - 12}px`,
                    left: `${priceCenterX - 56}px`,
                  }}
                  onClick={() => setSelectedProduct(product)}
                >
                  <ChevronRight className="h-4 w-4 text-primary" />
                  <CircleDot className="h-5 w-5 text-primary" />
                </div>

                {/* Trolley icon + right chevron */}
                <div
                  className="absolute flex items-center gap-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                  style={{
                    top: `${priceCenterY - 12}px`,
                    left: `${priceCenterX + 20}px`,
                  }}
                  onClick={() => setSelectedProduct(product)}
                >
                  <ShoppingCart className="h-5 w-5 text-primary" />
                  <ChevronLeft className="h-4 w-4 text-primary" />
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {/* Product detail dialog */}
      <Dialog
        open={!!selectedProduct}
        onOpenChange={(open) => !open && setSelectedProduct(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Product Details</DialogTitle>
          </DialogHeader>
          {selectedProduct && (
            <ProductPopupContent product={selectedProduct} />
          )}
          <Button
            variant="outline"
            onClick={() => setSelectedProduct(null)}
            className="mt-2"
          >
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function ProductPopupContent({ product }: { product: OverlayProduct }) {
  const costExVat = product.cost_excl_vat || product.cost_price || 0;
  const markup = product.default_markup_percent || 20;
  const ourCost = costExVat * (1 + markup / 100);

  return (
    <div className="space-y-3 text-sm">
      <div>
        <span className="font-medium text-muted-foreground">Code:</span>{" "}
        <span className="font-mono">{product.product_code}</span>
      </div>
      <div>
        <span className="font-medium text-muted-foreground">Name:</span>{" "}
        {product.short_name || product.description}
      </div>
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
        <div>
          <p className="text-xs text-muted-foreground">Supplier Cost (ex-VAT)</p>
          <p className="font-semibold">{formatRand(costExVat)}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Our Cost ({markup}% markup)</p>
          <p className="font-semibold text-primary">{formatRand(ourCost)}</p>
        </div>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Markup</p>
        <p className="font-semibold">{markup.toFixed(1)}%</p>
      </div>
    </div>
  );
}

export default PdfViewerWithOverlays;
