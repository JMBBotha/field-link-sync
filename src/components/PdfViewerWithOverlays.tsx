/**
 * PdfViewerWithOverlays — renders supplier PDF page images with
 * interactive bbox overlays for each extracted product row.
 *
 * Non-negotiable: Icons appear ONLY next to rightmost final amounts.
 * center_x correspondence is enforced at filter + post-render validation.
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
import { ShoppingCart, CircleDot, ChevronLeft, ChevronRight, Eye, EyeOff } from "lucide-react";
import { formatRand } from "@/utils/formatRand";
import PdfPriceOverlayPills from "@/components/PdfPriceOverlayPills";
import { resolveBaseColumn } from "@/config/supplierPriceColumns";

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
  center_x?: number;
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

const RIGHT_THRESHOLD = 0.7;
const CENTER_TOLERANCE = 0.01;

/**
 * Derive price_bbox for products that have row_bbox but no price_bbox,
 * using a median center_x from sibling products that DO have price_bbox.
 */
function enrichMissingPriceBboxes(products: OverlayProduct[]): OverlayProduct[] {
  // Group products by page
  const byPage: Record<number, OverlayProduct[]> = {};
  for (const p of products) {
    if (p.page_number == null) continue;
    (byPage[p.page_number] ??= []).push(p);
  }

  return products.map((p) => {
    // Already has price_bbox — keep it
    if (p.price_bbox) return p;
    // No row_bbox to derive from
    if (!p.row_bbox || p.page_number == null) return p;

    const siblings = (byPage[p.page_number] || []).filter((s) => s.price_bbox);
    if (siblings.length === 0) return p;

    // Use median center_x from siblings
    const centers = siblings
      .map((s) => s.price_bbox!.center_x ?? s.price_bbox!.x + s.price_bbox!.width / 2)
      .sort((a, b) => a - b);
    const medianCenter = centers[Math.floor(centers.length / 2)];

    // Use median width from siblings
    const widths = siblings.map((s) => s.price_bbox!.width).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)];

    const derived: BBox = {
      x: medianCenter - medianWidth / 2,
      y: p.row_bbox.y,
      width: medianWidth,
      height: p.row_bbox.height,
      center_x: medianCenter,
    };

    return { ...p, price_bbox: derived };
  });
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
  const [showPills, setShowPills] = useState(false);
  const [priceColumnLabel, setPriceColumnLabel] = useState<string>("");

  // Load page images + products + supplier info
  useEffect(() => {
    async function loadData() {
      // Fetch supplier info for price column resolution
      const { data: supplierRow } = await (supabase.from("suppliers") as any)
        .select("name, default_price_column")
        .eq("id", supplierId)
        .maybeSingle();

      if (supplierRow) {
        const col = resolveBaseColumn(supplierRow.name, supplierRow.default_price_column);
        setPriceColumnLabel(col);
      }

      // Try to load page images from supplier_pdf_pages table first
      const { data: pageRows } = await (supabase.from("supplier_pdf_pages") as any)
        .select("page_image_url, page_number")
        .eq("supplier_id", supplierId)
        .order("page_number", { ascending: true });

      if (pageRows?.length) {
        const urls = pageRows
          .map((r: any) => r.page_image_url)
          .filter((u: string | null) => !!u);
        if (urls.length > 0) setPages(urls);
      }

      // Fallback: list from storage directly
      if (!pageRows?.length) {
        const folderPath = uploadId ? `${supplierId}/${uploadId}` : `${supplierId}`;
        const { data: folders } = await supabase.storage
          .from("supplier-pdf-pages")
          .list(folderPath, { sortBy: { column: "name", order: "asc" } });

        const allUrls: string[] = [];
        if (folders?.length) {
          for (const item of folders) {
            if (/\.(png|jpg|jpeg|webp)$/i.test(item.name)) {
              const { data } = supabase.storage
                .from("supplier-pdf-pages")
                .getPublicUrl(`${folderPath}/${item.name}`);
              allUrls.push(data.publicUrl);
            } else if (!item.name.includes(".")) {
              const { data: subFiles } = await supabase.storage
                .from("supplier-pdf-pages")
                .list(`${folderPath}/${item.name}`, { sortBy: { column: "name", order: "asc" } });
              if (subFiles?.length) {
                for (const sf of subFiles) {
                  if (/\.(png|jpg|jpeg|webp)$/i.test(sf.name)) {
                    const { data } = supabase.storage
                      .from("supplier-pdf-pages")
                      .getPublicUrl(`${folderPath}/${item.name}/${sf.name}`);
                    allUrls.push(data.publicUrl);
                  }
                }
              }
            }
          }
        }
        if (allUrls.length > 0) setPages(allUrls);
      }

      // Products with bbox data — include rows with row_bbox OR price_bbox
      const { data } = await (supabase.from("supplier_products") as any)
        .select(
          "id, product_code, short_name, description, cost_price, cost_excl_vat, default_markup_percent, supplier_discount_percent, row_bbox, price_bbox, page_number"
        )
        .eq("supplier_id", supplierId)
        .not("page_number", "is", null);

      const raw = (data as OverlayProduct[]) || [];
      // Enrich products that have row_bbox but no price_bbox
      setProducts(enrichMissingPriceBboxes(raw));
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

  // Post-render validation effect
  useEffect(() => {
    if (products.length === 0) return;
    let misaligned = 0;
    products.forEach((p) => {
      if (!p.price_bbox) return;
      const pb = p.price_bbox;
      const computedCenter = pb.x + pb.width / 2;
      const aiCenter = pb.center_x ?? computedCenter;
      if (Math.abs(aiCenter - computedCenter) > CENTER_TOLERANCE) {
        console.error(`[PostRender] Misalignment: ${p.product_code} center_x=${aiCenter.toFixed(3)} vs computed=${computedCenter.toFixed(3)}`);
        misaligned++;
      }
      if (computedCenter < RIGHT_THRESHOLD) {
        console.error(`[PostRender] ${p.product_code} center not in rightmost column (${computedCenter.toFixed(3)})`);
        misaligned++;
      }
    });
    if (misaligned > 0) {
      console.warn(`[PostRender] ${misaligned} overlay misalignment(s) detected — suppressed in render`);
    }
  }, [products, pages]);

  const productsForPage = (pageIdx: number) =>
    products.filter((p) => {
      if (p.page_number !== pageIdx + 1 || !p.row_bbox || !p.price_bbox) return false;
      const pb = p.price_bbox;
      const rb = p.row_bbox;

      // Guard: positive dimensions
      if (pb.width <= 0 || rb.width <= 0 || pb.x < 0 || pb.y < 0 || rb.x < 0 || rb.y < 0) {
        console.warn(`[Overlay] Skipping ghost for ${p.id}: invalid bbox coords`);
        return false;
      }

      // Right-column gate
      if (pb.x + pb.width < RIGHT_THRESHOLD) {
        console.warn(`[Overlay] Skipping ${p.id}: price_bbox not in rightmost column`);
        return false;
      }

      // Center correspondence check
      const computedCenter = pb.x + pb.width / 2;
      const aiCenter = pb.center_x ?? computedCenter;
      if (Math.abs(aiCenter - computedCenter) > CENTER_TOLERANCE) {
        console.warn(`[Overlay] center_x mismatch for ${p.id} — suppressing`);
        return false;
      }
      if (computedCenter < RIGHT_THRESHOLD) {
        console.warn(`[Overlay] center not in rightmost column for ${p.id}`);
        return false;
      }

      return true;
    });

  if (!pages.length) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        No PDF pages available for this supplier.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2 items-center">
        {priceColumnLabel && (
          <span className="text-xs text-muted-foreground">
            Column: <span className="font-medium text-foreground">{priceColumnLabel}</span>
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowPills((v) => !v)}
          className="gap-1.5"
        >
          {showPills ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          {showPills ? "Hide Pricing Pills" : "Show Pricing Pills"}
        </Button>
      </div>
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

          <PdfPriceOverlayPills
            products={products}
            pageIndex={pageIdx}
            containerWidth={dimensions[pageIdx]?.w || 0}
            containerHeight={dimensions[pageIdx]?.h || 0}
            showPills={showPills}
            priceColumnLabel={priceColumnLabel}
          />

          {productsForPage(pageIdx).map((product) => {
            const dim = dimensions[pageIdx];
            if (!dim || !product.row_bbox || !product.price_bbox) return null;
            const { w, h } = dim;
            const rb = product.row_bbox;
            const pb = product.price_bbox;

            // Use center_x for exact horizontal alignment (non-negotiable)
            const centerXNorm = pb.center_x ?? (pb.x + pb.width / 2);
            const priceCenterX = centerXNorm * w;
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

                {/* Left of price center: chevron + radio */}
                <div
                  className="absolute flex items-center gap-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                  style={{
                    top: `${priceCenterY - 12}px`,
                    left: `${priceCenterX - 50}px`,
                  }}
                  onClick={() => setSelectedProduct(product)}
                >
                  <ChevronRight className="h-4 w-4 text-primary" />
                  <CircleDot className="h-5 w-5 text-primary" />
                </div>

                {/* Right of price center: trolley + chevron */}
                <div
                  className="absolute flex items-center gap-0.5 cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                  style={{
                    top: `${priceCenterY - 12}px`,
                    right: `${w - priceCenterX - 24}px`,
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
            <ProductPopupContent product={selectedProduct} priceColumnLabel={priceColumnLabel} />
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

function ProductPopupContent({ product, priceColumnLabel }: { product: OverlayProduct; priceColumnLabel?: string }) {
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
          <p className="text-xs text-muted-foreground">{priceColumnLabel || "Supplier Cost"} (ex-VAT)</p>
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
