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
  totalPages?: number;
  pageIndex?: number;
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
  totalPages = 1,
  pageIndex = 0,
}: PdfPriceAuditLayerProps) => {
  const normalizedSupplierName = normalize(supplierName || "");

  // Fetch ALL products for this supplier (page_number is usually NULL)
  const { data: allSupplierProducts = [] } = useQuery<SupplierProductRow[]>({
    queryKey: ["visual-price-pill-all-products", supplierId, normalizedSupplierName],
    enabled: isVisible,
    queryFn: async () => {
      // First try by page_number (in case some products have it set)
      const { data: byPage, error: byPageErr } = await (supabase.from("supplier_products") as any)
        .select(
          "id, supplier_id, product_code, cost_price, cost_excl_vat, default_markup_percent, row_bbox, price_bbox, page_number, suppliers(name, default_price_column)"
        )
        .eq("page_number", pageNumber)
        .limit(2000);

      if (!byPageErr && byPage && byPage.length > 0) {
        const rows = byPage as SupplierProductRow[];
        const matched = rows.filter((row) => {
          if (row.supplier_id === supplierId) return true;
          const relation = getSupplierRelation(row.suppliers);
          const name = normalize(relation?.name || "");
          if (!name || !normalizedSupplierName) return false;
          return name.includes(normalizedSupplierName) || normalizedSupplierName.includes(name);
        });
        return matched.length > 0 ? matched : rows;
      }

      // Fallback: fetch ALL products for the supplier by name match
      const { data: allData, error: allErr } = await (supabase.from("supplier_products") as any)
        .select(
          "id, supplier_id, product_code, cost_price, cost_excl_vat, default_markup_percent, row_bbox, price_bbox, page_number, suppliers(name, default_price_column)"
        )
        .limit(2000);

      if (allErr) throw allErr;

      const rows = (allData as SupplierProductRow[]) || [];
      return rows.filter((row) => {
        const relation = getSupplierRelation(row.suppliers);
        const name = normalize(relation?.name || "");
        if (!name || !normalizedSupplierName) return false;
        return name.includes(normalizedSupplierName) || normalizedSupplierName.includes(name);
      });
    },
    staleTime: 60000,
  });

  // Distribute products across pages when page_number is NULL
  const pageProducts = useMemo(() => {
    // If products have page_number set, use only those matching this page
    const withPageNumber = allSupplierProducts.filter((p) => p.page_number === pageNumber);
    if (withPageNumber.length > 0) return withPageNumber;

    // Otherwise distribute evenly across pages
    if (allSupplierProducts.length === 0) return [];
    const productsPerPage = Math.ceil(allSupplierProducts.length / Math.max(1, totalPages));
    const startIdx = pageIndex * productsPerPage;
    return allSupplierProducts.slice(startIdx, startIdx + productsPerPage);
  }, [allSupplierProducts, pageNumber, pageIndex, totalPages]);

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

  // Products WITHOUT row_bbox need synthetic positioning
  const productsWithoutRows = useMemo(
    () => pageProducts.filter((row) => !hasValidRowBbox(row.row_bbox)),
    [pageProducts]
  );

  const { data: extractionMeta = EMPTY_EXTRACTION_META } = useQuery<PriceColumnExtractionMeta>({
    queryKey: [
      "visual-price-pill-meta",
      pageId,
      pageNumber,
      pdfStoragePath,
      resolvedPriceColumn,
      pageProducts.length,
    ],
    enabled: isVisible && pageProducts.length > 0,
    queryFn: async () => {
      const shouldUseDaikinFallback = isDaikinSupplier(resolvedSupplierName);

      if (!pdfStoragePath) {
        return {
          ...EMPTY_EXTRACTION_META,
          headerCenter:
            shouldUseDaikinFallback && pageProducts.length > 0
              ? DAIKIN_FALLBACK_HEADER_CENTER
              : null,
          usedLayoutFallback: shouldUseDaikinFallback && pageProducts.length > 0,
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
          !headerCenter && !extractionSucceeded && shouldUseDaikinFallback && pageProducts.length > 0;

        return {
          headerCenter: usedLayoutFallback ? DAIKIN_FALLBACK_HEADER_CENTER : headerCenter,
          textItemsCount,
          extractionSucceeded,
          usedLayoutFallback,
        };
      } catch (error) {
        console.warn(`[PdfPriceAuditLayer] Header extraction failed for page ${pageNumber}`, error);

        const usedLayoutFallback = shouldUseDaikinFallback && pageProducts.length > 0;

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

  // Build pills from products WITH row_bbox (positioned via header alignment)
  const pillsFromRows = useMemo<PillProduct[]>(() => {
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

  // Build pills from products WITHOUT row_bbox (synthetic evenly-spaced layout)
  const pillsFromSynthetic = useMemo<PillProduct[]>(() => {
    if (productsWithoutRows.length === 0) return [];

    const headerCenter = extractionMeta.headerCenter || DAIKIN_FALLBACK_HEADER_CENTER;
    const usableTop = 0.08;
    const usableBottom = 0.95;
    const usableRange = usableBottom - usableTop;
    const rowHeight = Math.min(usableRange / productsWithoutRows.length, 0.035);

    return productsWithoutRows.map((product, idx) => {
      const yPos = usableTop + idx * (usableRange / productsWithoutRows.length);
      const syntheticRowBbox: BBox = { x: 0, y: yPos, width: 1, height: rowHeight };
      const priceBbox = buildPriceBboxFromRow(syntheticRowBbox, headerCenter);

      return {
        id: product.id,
        product_code: product.product_code,
        cost_price: product.cost_price ?? product.cost_excl_vat ?? 0,
        cost_excl_vat: product.cost_excl_vat ?? product.cost_price ?? 0,
        default_markup_percent: product.default_markup_percent ?? 20,
        row_bbox: syntheticRowBbox,
        price_bbox: priceBbox,
        page_number: pageNumber,
      };
    });
  }, [productsWithoutRows, extractionMeta.headerCenter, pageNumber]);

  const pillProducts = useMemo(
    () => [...pillsFromRows, ...pillsFromSynthetic],
    [pillsFromRows, pillsFromSynthetic]
  );

  const withPriceBboxCount = pillProducts.filter((product) => !!product.price_bbox).length;

  useEffect(() => {
    console.log(
      `[PdfPriceAuditLayer] page=${pageNumber} allSupplier=${allSupplierProducts.length} pageProducts=${pageProducts.length} withRowBbox=${productsWithRows.length} synthetic=${productsWithoutRows.length} pills=${pillProducts.length} with_price_bbox=${withPriceBboxCount} extract=${extractionMeta.extractionSucceeded} fallback=${extractionMeta.usedLayoutFallback}`
    );
  }, [pageNumber, allSupplierProducts.length, pageProducts.length, productsWithRows.length, productsWithoutRows.length, pillProducts.length, withPriceBboxCount, extractionMeta]);

  if (!isVisible) return null;

  return (
    <>
      <div className="absolute top-8 left-2 z-40 rounded bg-destructive/90 text-destructive-foreground text-[9px] font-mono px-1.5 py-0.5">
        p{pageNumber} · products:{pageProducts.length} · pills:{pillProducts.length} · with_bbox:{withPriceBboxCount} · extract:
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
