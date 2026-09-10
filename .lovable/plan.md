# Pin catalog controls to the PDF page margin

## Changes

- Position every normal catalog info/select cluster at `right: 10px` inside each PDF page overlay, using row bounds only for vertical alignment.
- Remove price-column coordinates from control placement while retaining existing extraction data for non-control purposes.
- Remove any production-rendered magenta/pink price-column frames from the catalog page overlay.
- Apply the same right-margin rule to the legacy PDF overlay viewer so no catalog path can place controls over prices.
- Preserve fit-width minimum zoom, elastic pinch behavior, smaller phone controls, landscape support, and the existing no-gutter layout.

## Verification

- Confirm controls remain inside the white PDF page at its right edge and never use price-column coordinates.
- Confirm no production debug price outlines or unmatched OCR text render.
- Confirm zoom still clamps to fit width and the project builds successfully.

## Technical details

- The control cluster will use absolute positioning with `right: 10px` relative to the full-page overlay row.
- Row `y`/height continues to determine vertical centering; `price_x_frac` and `priceColumnXFrac` will not influence controls.
