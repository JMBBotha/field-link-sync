# Catalog / Visual-PDF source-of-truth audit

## 1. Quote picker / Items search

- `src/components/quoting/QuoteQuickEditor.tsx` (estimate page add bars) — loads `supplier_products` with `.or("archived.is.null,archived.eq.false")`, limit 2000. Services come from `hvac_services` where `is_active = true`. No PDF filter.
- `src/hooks/useQuoteBuilderProducts.ts` (full builder palette) — same archived filter, limit 2000, ordered by pin. No PDF filter.
- `src/pages/admin/AdminCatalogPage.tsx` lines 46 / 153 — same archived filter.

**Verdict:** the picker filters out archived only. It does **not** restrict to products linked to a Visual PDF page/region, and there is no notion of an "active PDF" anywhere in the query.

## 2. PDF parse / import workflow

- Upload + page rasterising + import: `src/components/suppliers/SupplierDocumentsTab.tsx` (writes `supplier_pdf_pages` rows per page, then calls the diff import).
- Diff engine: `src/services/diffImportPipeline.ts` — `buildProductDiff` / `applyProductDiff`. Upserts on `supplier_id,product_code`; codes present in the DB but absent from the new file are soft-archived (`archived = true`, `archived_at`), never hard-deleted; re-appearing codes are restored (`archived: false, archived_at: null`).
- Nuke path: `src/services/cleanImportPipeline.ts` — `cleanImportForSupplier` hard-deletes all products, `pdf_uploads`, `pdf_product_regions` and `supplier_pdf_pages` for a supplier before a fresh import.
- CSV/manual path: `src/components/catalog/SupplierProductImporter.tsx` (same diff engine).
- Server-side: `supabase/functions/parse-price-list/index.ts` inserts/updates `supplier_products` directly — no archiving of missing SKUs.

**Verdict:** archiving of missing SKUs happens per **supplier_id**, not per brand and not per PDF. A new PDF for one brand under a multi-brand supplier will archive that supplier's other brands' SKUs unless the incoming row set covers them.

## 3. Region rendering

- `src/components/catalog/quote-builder/VisualCatalogPanel.tsx` — `pdf_product_regions` is only a **fallback** (queried when there is no PDF source for live text extraction, ~line 1020). Precedence: live text extraction (`pdfTextExtractor`, locked) → OCR bboxes stored on `supplier_products.row_bbox` → `pdf_product_regions`.
- Scale: stored regions are used directly as `x_pct/y_pct/w_pct/h_pct` (no multiply) — **percent 0-100**. DB confirms: 307 rows, `region_x` 0-4.1, max `region_width` 100, max `region_height` 20.
- `supplier_products.row_bbox` / `price_bbox` are **fractions 0-1** and multiplied by 100 in the panel (~line 1207). Two different scales coexist.
- Pages come from `supplier_pdf_pages`, not `pdf_uploads`.

## 4. pdf_uploads active vs archived

- Columns: `id, supplier_id, file_name, file_path, file_url, storage_path, page_count, status, price_list_type, price_includes_vat, markup_percent, trade_discount_percent, created_at, updated_at`.
- There is **no** `is_active`, `active`, or `archived` column, and no activate flow anywhere in `src/`. `status` is only `pending | parsed | failed` (both live rows are `parsed`) and is used purely as a filter/badge in `src/components/suppliers/SupplierPDFManager.tsx`.
- `supplier_pdf_pages` has no active flag either — it is treated as "whatever pages currently exist for this supplier".

## Data snapshot

- `supplier_products`: 734 rows, 18 archived, 387 with `pdf_upload_id`, 392 with `row_bbox`, 392 with `page_number`.
- `pdf_uploads`: 2 rows (both `parsed`). `supplier_pdf_pages`: 41 rows. `pdf_product_regions`: 307 rows.

## Gaps vs the rule (equipment/materials = Visual PDF SoT only; hvac_services parallel SoT)

| Rule | State |
|---|---|
| Picker shows only Visual-PDF-linked, non-archived equipment/materials | **Missing** — archived filter only; ~347 of 734 products have no `pdf_upload_id` and would still appear |
| One active PDF per supplier/brand drives the catalog | **Missing** — no active flag on `pdf_uploads` or `supplier_pdf_pages`, no activate flow |
| New PDF for a brand archives that brand's missing SKUs | **Partial** — archiving is supplier-scoped, not brand- or PDF-scoped; `parse-price-list` archives nothing |
| Regions have one consistent coordinate scale | **Partial** — `pdf_product_regions` is 0-100, `row_bbox`/`price_bbox` is 0-1 |
| `hvac_services` remains a separate SoT | **Present** — services are queried separately (`is_active = true`) and never mixed into the product query |

## Proposed next steps (no code changed yet)

1. Add an active-PDF marker: `supplier_pdf_pages`/`pdf_uploads` gain `is_active` (or an `active_pdf_filename` per supplier+brand) plus a single activate action in the supplier documents tab that deactivates siblings.
2. Scope diff archiving to supplier **+ brand** (and record the source `pdf_upload_id` on every imported row), so a Samsung PDF never archives Daikin rows.
3. Gate the equipment/materials pickers (`QuoteQuickEditor`, `useQuoteBuilderProducts`) to rows sourced from the active PDF, leaving `hvac_services` untouched.
4. Normalise region coordinates to one scale (keep 0-100 in `pdf_product_regions`, convert `row_bbox` at read time as today, documented in one helper).
