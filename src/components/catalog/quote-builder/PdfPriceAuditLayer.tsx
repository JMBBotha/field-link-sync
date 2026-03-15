import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import PdfPriceOverlayPills, { type PillProduct } from "@/components/PdfPriceOverlayPills";
import { resolveBaseColumn } from "@/config/supplierPriceColumns";
import { extractTextItemsFromPdfPage } from "./pdfTextExtractor";
import {
  buildPriceBboxFromRow,
  DAIKIN_FALLBACK_HEADER_CENTER,
  findHeaderCenterForPage,
  isDaikinSupplier,
  type BBox,
  type PriceColumnExtractionMeta,
} from "./pricePillOverlayUtils";

interface SupplierRelation {
  name: string | null;
  default_price_column: string | null;
}

interface SupplierProductRow {
  id: string;
  supplier_id: string;
  product_code: string;
  cost_price: number | null;
  cost_excl_vat: number | null;
  default_markup_percent: number | null;
  row_bbox: BBox | null;
  price_bbox: BBox | null;
  page_number: number | null;
  suppliers?: SupplierRelation | SupplierRelation[] | null;
}

interface PdfPriceAuditLayerProps {
  pageId: string;
  pageNumber: number;
  supplierId: string;
  supplierName?: string;
  pdfStoragePath: string | null;
  isVisible: boolean;
  showPills: boolean;
}

const EMPTY_EXTRACTION_META: PriceColumnExtractionMeta = {
  headerCenter: null,
  extractionSucceeded: false,
  textItemsCount: 0,
  usedLayoutFallback: false,
};

const normalize = (value: string) => value.toLowerCase().trim();

const getSupplierRelation = (value: SupplierProductRow["suppliers"]): SupplierRelation | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
};

const hasValidRowBbox = (bbox: BBox | null | undefined): bbox is BBox => {
  if (!bbox) return false;
  return [bbox.x, bbox.y, bbox.width, bbox.height].every((v) => Number.isFinite(v));
};

const PdfPriceAuditLayer = ({
  pageId,
  pageNumber,
  supplierId,
  supplierName,
  pdfStoragePath,
  isVisible,
  showPills,
}: PdfPriceAuditLayerProps) => {
  const normalizedSupplierName = normalize(supplierName || "");

  const { data: pageProducts = [] } = useQuery<SupplierProductRow[]>({
    queryKey: ["visual-price-pill-products", pageId, supplierId, pageNumber, normalizedSupplierName],
    enabled: isVisible,
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select(
          "id, supplier_id, product_code, cost_price, cost_excl_vat, default_markup_percent, row_bbox, price_bbox, page_number, suppliers(name, default_price_column)"
        )
        .eq("page_number", pageNumber)
        .limit(2000);

      if (error) throw error;

      const rows = (data as SupplierProductRow[]) || [];
      const supplierMatched = rows.filter((row) => {
        if (row.supplier_id === supplierId) return true;
        const relation = getSupplierRelation(row.suppliers);
        const rowSupplierName = normalize(relation?.name || "");
        if (!rowSupplierName || !normalizedSupplierName) return false;
        return (
          rowSupplierName.includes(normalizedSupplierName) ||
          normalizedSupplierName.includes(rowSupplierName)
        );
      });

      return supplierMatched.length > 0 ? supplierMatched : rows;
    },
    staleTime: 60000,
  });

  const supplierRelation = getSupplierRelation(pageProducts[0]?.suppliers ?? null);
  const resolvedSupplierName = supplierRelation?.name || supplierName || "";
  const resolvedPriceColumn = resolveBaseColumn(
    resolvedSupplierName,
    supplierRelation?.default_price_column || null
  );

  const productsWithRows = useMemo(
    () => pageProducts.filter((row) => hasValidRowBbox(row.row_bbox)),
    [pageProducts]
  );

  const { data: extractionMeta = EMPTY_EXTRACTION_META } = useQuery<PriceColumnExtractionMeta>({
    queryKey: [
      "visual-price-pill-meta",
      pageId,
      pageNumber,
      pdfStoragePath,
      resolvedPriceColumn,
      productsWithRows.length,
    ],
    enabled: isVisible && productsWithRows.length > 0,
    queryFn: async () => {
      const shouldUseDaikinFallback = isDaikinSupplier(resolvedSupplierName);

      if (!pdfStoragePath) {
        return {
          ...EMPTY_EXTRACTION_META,
          headerCenter:
            shouldUseDaikinFallback && productsWithRows.length > 0
              ? DAIKIN_FALLBACK_HEADER_CENTER
              : null,
          usedLayoutFallback: shouldUseDaikinFallback && productsWithRows.length > 0,
        };
      }

      try {
        const extracted = await extractTextItemsFromPdfPage(pdfStoragePath, pageNumber);
        const textItemsCount = extracted.items.length;
        const extractionSucceeded = textItemsCount > 0;

        const headerCenter = extractionSucceeded
          ? findHeaderCenterForPage(extracted.items, extracted.pageWidth, resolvedPriceColumn)
          : null;

        const usedLayoutFallback =
          !headerCenter && !extractionSucceeded && shouldUseDaikinFallback && productsWithRows.length > 0;

        return {
          headerCenter: usedLayoutFallback ? DAIKIN_FALLBACK_HEADER_CENTER : headerCenter,
          textItemsCount,
          extractionSucceeded,
          usedLayoutFallback,
        };
      } catch (error) {
        console.warn(`[PdfPriceAuditLayer] Header extraction failed for page ${pageNumber}`, error);

        const usedLayoutFallback = shouldUseDaikinFallback && productsWithRows.length > 0;

        return {
          headerCenter: usedLayoutFallback ? DAIKIN_FALLBACK_HEADER_CENTER : null,
          textItemsCount: 0,
          extractionSucceeded: false,
          usedLayoutFallback,
        };
      }
    },
    staleTime: 60000,
  });

  const pillProducts = useMemo<PillProduct[]>(() => {
    return productsWithRows.map((product) => {
      const rowBbox = product.row_bbox!;

      const derivedPriceBbox = extractionMeta.headerCenter
        ? buildPriceBboxFromRow(rowBbox, extractionMeta.headerCenter)
        : product.price_bbox;

      return {
        id: product.id,
        product_code: product.product_code,
        cost_price: product.cost_price ?? product.cost_excl_vat ?? 0,
        cost_excl_vat: product.cost_excl_vat ?? product.cost_price ?? 0,
        default_markup_percent: product.default_markup_percent ?? 20,
        row_bbox: rowBbox,
        price_bbox: derivedPriceBbox,
        page_number: pageNumber,
      };
    });
  }, [productsWithRows, extractionMeta.headerCenter, pageNumber]);

  const withPriceBboxCount = pillProducts.filter((product) => !!product.price_bbox).length;

  useEffect(() => {
    console.log(
      `[PdfPriceAuditLayer] page=${pageNumber} products=${pillProducts.length} with_price_bbox=${withPriceBboxCount} extractionSucceeded=${extractionMeta.extractionSucceeded} usedFallback=${extractionMeta.usedLayoutFallback}`
    );
  }, [pageNumber, pillProducts.length, withPriceBboxCount, extractionMeta]);

  if (!isVisible) return null;

  return (
    <>
      <div className="absolute top-8 left-2 z-40 rounded bg-destructive/90 text-destructive-foreground text-[9px] font-mono px-1.5 py-0.5">
        p{pageNumber} · products:{pillProducts.length} · with_bbox:{withPriceBboxCount} · extract:
        {extractionMeta.extractionSucceeded ? `ok(${extractionMeta.textItemsCount})` : `empty(${extractionMeta.textItemsCount})`}
        {extractionMeta.usedLayoutFallback ? " · daikin-fallback" : ""}
      </div>

      <PdfPriceOverlayPills
        products={pillProducts}
        pageIndex={pageNumber - 1}
        showPills={showPills}
        priceColumnLabel={resolvedPriceColumn}
      />
    </>
  );
};

export default PdfPriceAuditLayer;
