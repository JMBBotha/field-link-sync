# Roadmap — catalog source of truth (equipment + materials)

Scope lock: equipment/materials come from the current Visual PDF book only.
`hvac_services` stays a parallel source of truth and is never filtered.

- [x] Quote picker + Items search show only non-archived products still on the current Visual PDF book (`src/lib/catalogSoT.ts`, `useQuoteBuilderProducts.ts`, `QuoteQuickEditor.tsx`).
- [x] Brand-scoped archive-on-missing in `diffImportPipeline.ts` — never archives other brands, never deletes.
- [x] Post-parse summary shows inserted / updated / archived / unchanged.
- [x] `pdf_uploads.is_active` + `brand` + `activated_at`; active vs superseded badges and an Activate action that deactivates same supplier+brand siblings and warns about open draft quotes.
- [x] `parse-price-list` documented as a non-brochure path (insert/update only).
- Region scale unchanged: `pdf_product_regions` = percent 0-100, `row_bbox` = 0-1. AR18 overlays untouched.

- [x] Hide mobile Dashboard/Live Map control bands, remove map bottom gaps, verify, and publish.

# Voice / Quote MVP (estimate page)
- [x] `src/lib/voiceQuoteKit.ts`: intent parser (copper kit w/ sizes + 10% waste + Armaflex pairing, labour, cable, chase, AC unit, client, area, confirm/cancel/undo/read-back), read-back text.
- [x] `VoiceQuoteStrip.tsx` on `/admin/estimates/:id`: mic (WavRecorder + voice-quote-parse transcribe), typed fallback, short-turn questions with ranked candidates, pending list, explicit confirm -> writes live quote via QuoteContext.
- [x] Verify kit math + build; summarize works vs stubbed.
- [ ] Voice v2 (later): cable/chase items in catalog, AC-unit → auto kit suggestion, live-mic polish.

## Visual Catalog overlay hard-lock (2026-09-10)
- [ ] Controls anchored `right:10px` to PDF page box (no price_x_frac / priceColumnXFrac for placement)
- [ ] Pink/magenta price frames: confirm source (baked into uploaded page images, not app-drawn) and report
- [ ] Fix mobile tap selecting wrong row (hit-test in transformed overlay space)
- [ ] Smaller radios on phone (visual + hit target)
