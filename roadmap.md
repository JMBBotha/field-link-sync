# Roadmap

## Catalog source-of-truth locks (equipment/materials only)
- [ ] A. Quote picker + Items search show only non-archived products linked to the current Visual PDF (regions, or pdf_upload_id on an active upload). hvac_services untouched.
- [ ] B. Import archive-on-missing is brand-scoped: update/insert as today, archive only same-brand codes absent from the new PDF, never other brands, never delete.
- [ ] C. Upload UX: is_active on pdf_uploads (activating deactivates siblings for same supplier+brand), parse summary counts (inserted/updated/archived/unchanged), warn when activation would archive SKUs used on open draft quotes.

Constraints: keep pdf_product_regions percent 0-100 and row_bbox 0-1; do not overwrite restored AR18 regions (page 2 Fourways); do not mass-archive Alliance/Midea SKUs still on current PDFs.
