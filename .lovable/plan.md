# Full-screen Product Palette on mobile (Area tab)

## Goal
On the "Build Area Quote" tab in compact (phone/tablet) view, give the Product Palette a true full-page mode that hides the other accordion sections (Build Area Quote and Quote Summary) entirely — not just collapses them — so the whole screen is available for scrolling/searching products.

## Current state
- `AdminQuoteBuilderPageUnified.tsx` Area tab renders a 3-section accordion on compact screens: Product Palette / Area Builder / Quote Summary.
- Expanding a section hides the others' content, but their header bars still take up screen space (~80px total), and there is no way to get a true full-page palette.

## Changes (1 file: `src/pages/admin/AdminQuoteBuilderPageUnified.tsx`)

1. Add a `paletteMaximized` boolean state (compact view only).
2. Add a Maximize (expand icon) button to the Product Palette accordion header bar, next to the item count.
3. When `paletteMaximized` is true:
   - Hide the Area Builder and Quote Summary header bars and content completely.
   - Palette container takes `flex-1` of the full tab area (header bar + palette only).
   - Header shows a Minimize/Exit button (and "Full screen" label) to return to the normal accordion.
4. Exiting full-screen restores the previous `areaSection` state unchanged.
5. Desktop (`lg`) layout is untouched — no maximize button renders there.

## Verification
- `bunx tsc --noEmit -p tsconfig.app.json`
- Playwright at 390x710: open Area tab, tap Maximize on Product Palette, confirm only the palette header + product list are visible and scrollable; tap Exit, confirm Area Builder and Quote Summary headers return.
