Make the Product Palette locally searchable

## Problem
The `ProductPalette` component renders a search input, but the list below it is only filtered by the parent component that passes `products={...}`. Inside `ProductPalette` itself, `searchQuery` is used only for highlighting matches, not for removing non-matching items. In the maximized/full-page area-builder palette this makes typing into the search box look like it does nothing — the palette appears unsearchable.

## Solution
Make `ProductPalette` defensively filter its own product list by `searchQuery`, while keeping the existing parent-level filtering so no other view regresses.

## Technical details
- In `src/components/catalog/quote-builder/ProductPalette.tsx`, update the `filteredProducts` memo so it also narrows products by `searchQuery` using the same multi-word blob search already used by the parent pages (product code, short name, brand, description, category, supplier).
- Keep the existing category/favorites/recent filtering behavior; search should work across all of them and hide empty category headers when no products match.
- The bundle filter already respects `searchQuery`; leave it unchanged.
- Add a clear-search button (×) inside the search input when `searchQuery` is non-empty.
- Update the empty-state copy to say “No products match your search” when a search term is active.

## Verification
- Type a product name/code in the product palette on the desktop area builder: the list should narrow immediately.
- Switch to the maximized/full-page mobile palette and type the same search: only matching products should remain.
- Clear the search or type a nonsense term: the empty state should explain that nothing matched.
