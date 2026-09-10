# Pin catalog pickers to the page margin, fix wrong-row taps, shrink phone radios

## Changes

1. **Page-edge anchor.** Every info + select cluster sits at `right: 10px` of the PDF page box. Price-column coordinates (`price_x_frac`, `priceColumnXFrac`) are no longer used for control placement at all. Row bounds drive only the vertical position.
2. **Blue pill hugs the margin.** The row highlight becomes a short pill at the right edge (about the width of the two controls plus a few pixels), not a gradient sweeping across the R amounts.
3. **Correct row on tap (mobile hit fix).** On a phone the page rows are ~10 px tall while each button was 28-40 px tall, so neighbouring buttons stacked on top of each other and the topmost (a row 2-3 below) stole the tap. Fix: one transparent margin strip per page handles taps; it converts the pointer's Y into page-local space using the page's on-screen rectangle (which already reflects pinch scale, pan and scroll), then picks the row whose centre is nearest. Left part of the strip = info, right part = select. Double-tap still favourites. Pinch and scroll starting on the strip still work; a moved finger does not count as a tap.
4. **Smaller radios on phone.** Icon size is clamped to the row height (phone max 14 px, tablet/desktop max 20 px) so icons no longer overlap each other; the tap zone is the whole margin strip at that row's Y, so it stays thumb-friendly.
5. **Pink/magenta frames.** These are printed in the uploaded page images themselves (the marker rectangles the upload step reads to find the price column); the app draws no such frame. Nothing to remove in code; they disappear only if the pages are re-uploaded without the marker. Stated plainly in the summary.
6. **Legacy overlay viewer** gets the same right-margin rule so no catalog path can place controls over prices.

## Kept as-is

MIN_ZOOM = 1 fit-width clamp with elastic pinch, no gray gutter, no unmatched OCR red dump, landscape allowed, voice quote / client roll-up / pricing untouched.

## Verification

- Playwright at a 390 px phone viewport and at desktop width: controls inside the right margin, no overlap with R glyphs, no overlapping icons.
- Tap at the Y of a given painted radio (zoom 1 and pinch-zoomed 2x) selects exactly that SKU.
- Build passes.

## Technical details

- `PdfPageOverlay.tsx`: `RegionBox` renders visuals only (`pointer-events: none` for the cluster); new `MarginHitStrip` (absolute, `top:0 bottom:0 right:0`, width 44 px phone / 64 px desktop) with `pointerdown`/`pointerup` handlers; `yPct = (clientY - pageRect.top) / pageRect.height * 100`; nearest region by `|centre - yPct|` within `max(h_pct, 12px-equivalent)`. Selection/pricing logic moves unchanged into a shared `selectRegion` helper.
- `VisualCatalogPanel.tsx`: stop passing `priceColumnXFrac` for placement; keep `price_column_bbox` for the extractor.
- `PdfViewerWithOverlays.tsx`: controls at `right: 10px`.
