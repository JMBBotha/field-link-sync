# Roadmap — catalog source of truth (equipment + materials)

Scope lock: equipment/materials come from the current Visual PDF book only.
`hvac_services` stays a parallel source of truth and is never filtered.

- [x] Quote picker + Items search show only non-archived products still on the current Visual PDF book (`src/lib/catalogSoT.ts`, `useQuoteBuilderProducts.ts`, `QuoteQuickEditor.tsx`).
- [x] Brand-scoped archive-on-missing in `diffImportPipeline.ts` — never archives other brands, never deletes.
- [x] Post-parse summary shows inserted / updated / archived / unchanged.
- [x] `pdf_uploads.is_active` + `brand` + `activated_at`; active vs superseded badges and an Activate action that deactivates same supplier+brand siblings and warns about open draft quotes.
- [x] `parse-price-list` documented as a non-brochure path (insert/update only).
- Region scale unchanged: `pdf_product_regions` = percent 0-100, `row_bbox` = 0-1. AR18 overlays untouched.
