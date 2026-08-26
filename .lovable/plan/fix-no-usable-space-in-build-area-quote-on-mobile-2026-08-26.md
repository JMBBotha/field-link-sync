# Fix: no usable space in Build Area Quote on mobile

On a phone the Area tab currently forces exactly one open section, defaults to the Area Quote section, and its header only opens (never closes). The Product Palette search box and product list are therefore off-screen, and neither "Area Quote" nor "Quote Summary" can be collapsed to free space.

## What changes

1. **True independent collapsing.** Each of the three section headers (Product Palette, Area Quote, Quote Summary) toggles open/closed on its own. Any combination can be collapsed, including all three — the headers stay visible as a compact stack so nothing is unreachable.
2. **Open section fills the screen.** When one section is open it takes all remaining height and scrolls internally. When two or more are open they share the space evenly, each scrolling independently.
3. **Palette opens first.** On entering the Area tab on mobile, the Product Palette is the open section so search and products are visible immediately; Area Quote and Summary start collapsed.
4. **Search always visible.** The palette's search field, clear button and category chips stay pinned to the top of the palette while the product list scrolls beneath them.
5. **Collapsed headers stay informative.** Palette shows item count, Area Quote shows area count, Quote Summary shows the running total, so a collapsed section is still useful at a glance.
6. **Full page mode kept.** The palette's "Full page" toggle still hides the other two sections; "Exit" restores the accordion state.
7. **Desktop unchanged.** The three-column layout above `lg` is untouched.

## Technical notes

- `src/pages/admin/AdminQuoteBuilderPageUnified.tsx`: replace the single `areaSection` state with a set of open sections (e.g. `Record<"palette"|"areas"|"summary", boolean>` defaulting to palette-only). Section wrappers switch from `flex-1 / hidden` to `flex-1 min-h-0 overflow-hidden` when open and header-only when closed; content is unmounted-by-CSS rather than the whole block, so the header row always renders. Keep `paletteMaximized` behaviour as-is.
- `src/components/catalog/quote-builder/ProductPalette.tsx`: make the search + filter block `sticky top-0 z-10 bg-card` inside the scroll container so it stays visible; ensure the list container has `min-h-0 overflow-y-auto`.
- No data, pricing, or quote-persistence logic is touched.

## Verification

- Authenticated Playwright run at 390x710 on `/admin/quote-builder`, Area tab: palette search visible on load, typing filters the list, each header collapses/expands independently, all three can be collapsed, and full page mode still works.
- TypeScript check plus the existing pricing regression tests.
