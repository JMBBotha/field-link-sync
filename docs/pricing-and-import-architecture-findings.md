# Pricing & Product-Import Architecture — Findings

Investigated: does pricing/markup stay consistent across every quote/estimate
builder, does a new price-list upload correctly override old prices, and
should items removed from the newest list be archived instead of deleted?
All three turned out to have real, confirmed issues in the current code.

**Status: both fixes below are now implemented, typechecked, and built
successfully.** See "Resolution" under each section for exactly what changed.
Not yet committed/pushed at the time of writing — see the bottom of this doc.

## 1. Two competing "single source of truth" pricing files

There are two separate pricing calculation modules in the codebase, and both
literally label themselves the single source of truth:

**`src/utils/pricing.ts`** — "SIMPLE PRICING MODEL":
```
sellingExclVat = costPrice * (1 + markupPercent / 100)
```
Assumes `cost_price` already has any supplier trade discount baked in.
Exports `calcSellingPrice`, `getProductPricing`.

**`src/lib/pricing.ts`** — "CENTRALIZED PRICING HELPER":
Applies a hardcoded per-supplier trade discount on top of cost:
```
SUPPLIER_DISCOUNTS = { SAMSUNG: 0.20, DAIKIN: 0, MIDEA: 0, OTHER: 0 }
```
plus a fragile heuristic (`overrideCostExVat < listPriceExVat * 0.99`) to guess
whether `cost_price` is already pre-discounted. Exports `computePricing`,
`computeProductPricing`.

**Why this matters:** the two formulas can legitimately disagree — a Samsung
product priced through `@/lib/pricing` gets an extra 20% discount applied
that `@/utils/pricing` never applies, so the *same product* can show two
different selling prices depending on which builder component happens to
render it.

**Who imports which** (confirmed in code today):

| File | Imports |
|---|---|
| `BrandDiscountsSection.tsx`, `AreaQuoteSummary.tsx`, `EnhancedProductPopup.tsx`, `FloatingSelectedItems.tsx`, `VisualCatalogPanel.tsx`, `ACSelectionStep.tsx`, `PricingStep.tsx`, `ProductInfoDialog.tsx`, `FBQuoteBuilderPage.tsx`, `AdminQuoteBuilderPage.tsx`, `productImportParser.ts` | `@/utils/pricing` only |
| `ACOptionsModal.tsx`, `ConsumablesSuggestionPanel.tsx`, `DragOverlayCard.tsx`, `FallbackProductPanel.tsx`, `PdfPageOverlay.tsx`, `ProductPalette.tsx`, `VisualCatalogView.tsx`, `MaterialsStep.tsx`, `SharedBasketItems.tsx`, `quoteBasketTotals.ts` | `@/lib/pricing` only |
| **`QuoteBuilderTab.tsx`** | **both, side by side** (`inclVatFromExcl` from `@/utils/pricing` and `computePricing`/`resolveSupplierCode` from `@/lib/pricing`) |

That last row is the clearest evidence of the problem: one component pulls
from both files at once, which only makes sense if a developer wasn't aware
a second "source of truth" already existed.

**Practical impact:** the Area Quote wizard (`PricingStep.tsx`, uses
`@/utils/pricing`) and the main basket/palette builder (`ProductPalette.tsx`,
`VisualCatalogView.tsx`, `quoteBasketTotals.ts` — all use `@/lib/pricing`) can
price the identical Samsung unit differently. For non-Samsung products the
two formulas happen to agree (discount = 0), which is likely why this hasn't
been caught yet — it only shows up on discounted brands.

**Sharper root cause, found while implementing the fix:** the bug is worse
than "the two formulas can disagree" — `@/lib/pricing`'s own heuristic is
wrong in the dominant real-world case, independent of which file a builder
imports. Every actual write path in the app sets `cost_price` to the value
*already net of the supplier discount* (i.e. `cost_price === cost_excl_vat`
as parsed/entered). The heuristic `overrideCostExVat < listPriceExVat * 0.99`
is checking the wrong thing — it's almost always **false** in that dominant
case, so `computePricing`/`computeProductPricing` fall through to treating
`cost_price` as a pre-discount list price and re-apply
`SUPPLIER_DISCOUNTS[code]` on top of a cost that was already discounted.
Concretely, for a Samsung product with a 20% trade discount: list price
R1000, correct net cost R800 (already stored as `cost_price`). The old
`@/lib/pricing` code recomputed `800 × (1 − 0.20) = R640` as "cost", then
applied the 1.35 markup → **R864 sell**, instead of the correct
`800 × 1.35 = R1080 sell`. That's a ~20% underprice on every Samsung line
item quoted through any of the nine files that imported `@/lib/pricing`, not
a rare edge case — it fires whenever the discount heuristic's assumption
doesn't hold, which is the normal case today. This is more severe and more
certain than the original "the two files can disagree" framing suggested (see
Grok's review below, which was given the milder framing).

### Resolution (implemented)

- Rewrote `src/lib/pricing.ts` as the single source of truth, merging in the
  exports `@/utils/pricing` provided (`calcSellingPrice`, `getProductPricing`,
  `inclVatFromExcl`, etc.) so every caller can converge on one file.
- Retired `SUPPLIER_DISCOUNTS` entirely and fixed `computePricing` /
  `computeProductPricing` to trust `overrideCostExVat` (`cost_price`)
  directly with **no re-discount** — it falls back to computing from
  `listPriceExVat` only when no cost override is present at all (e.g. a
  brand-new product row with no cost yet). This removes the guessing
  heuristic instead of patching it, per Grok's suggestion that the data
  model should decide once, explicitly, what `cost_price` means.
- Deleted `src/utils/pricing.ts` and repointed all twelve former callers
  (`BrandDiscountsSection.tsx`, `AreaQuoteSummary.tsx`,
  `EnhancedProductPopup.tsx`, `FloatingSelectedItems.tsx`,
  `VisualCatalogPanel.tsx`, `ACSelectionStep.tsx`, `PricingStep.tsx`,
  `ProductInfoDialog.tsx`, `FBQuoteBuilderPage.tsx`,
  `AdminQuoteBuilderPage.tsx`, `productImportParser.ts`, and
  `QuoteBuilderTab.tsx`'s duplicate dual import) at `@/lib/pricing`.
- `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` both pass with
  zero errors after the consolidation.
- Not yet migrated to a database-driven discount table (Grok's longer-term
  suggestion) — that's a reasonable follow-up but out of scope for this pass
  since the discount table itself is now unused dead weight, not read from
  anywhere.


## 2. Product-import: two different pipelines, only one is safe

There are two completely independent ways to import a supplier's product
list, reachable from different pages, with opposite behavior toward
discontinued items:

**Destructive pipeline** (`src/services/pdfImportPipeline.ts` +
`cleanImportPipeline.ts`, triggered from `SupplierImportPanel.tsx` /
`SupplierDocumentsTab.tsx`, rendered on `AdminSuppliersPage.tsx` /
`SupplierDetailSheet.tsx`):
- Flow is literally commented `PURGE → UPLOAD → PARSE → VALIDATE → INSERT → AUDIT`.
- Before importing anything new, it hard-deletes every dependent row
  (`quote_items`, `job_used_parts`, `inventory_stock`, `bundle_items`,
  `pdf_product_regions`) referencing that supplier's existing products, then
  deletes the products themselves (`cleanImportPipeline.ts`).
- New rows are always `.insert()`, never matched or merged by model number —
  so a re-upload of the same list with one item removed permanently destroys
  that item's entire history, not just its catalog listing.

**Safe, diff-based pipeline** (`SupplierProductImporter.tsx`, rendered on
`AdminCatalogPage.tsx`):
- Has a proper `buildDiff()` that matches incoming rows to existing ones by
  `product_code` and classifies each as `new`, `update`, `restore` (an item
  that had been archived and reappeared on a new list), or `archive` (an
  item that existed before but is missing from the new list).
- Writes via `.upsert(..., { onConflict: "supplier_id,product_code" })`, and
  archiving sets a flag rather than deleting (`ProductCatalogBrowser.tsx`
  already has working un-archive/restore UI and shows archived items with a
  strikethrough badge, confirming this pattern is proven elsewhere in the
  app).
- This is exactly the "archive, don't delete, matched by model number"
  behavior you asked about — it just isn't the pipeline that's reachable
  from the Suppliers pages.

**Filtering is fine either way:** everywhere I checked that queries "active"
products (`GuidedProductSelector.tsx`, `SupplierComparison.tsx`,
`QuoteBuilderTab.tsx`, `InventoryList.tsx`, `FlatRateBook.tsx`,
`AdminCatalogPage.tsx`, `AdminQuoteBuilderPageUnified.tsx`,
`useBundleProducts.ts`, `useQuoteBrochures.ts`, `useProductOptions.ts`,
`useQuoteBuilderBundles.ts`) correctly filters `.eq("is_active", true)`. Once
an item is archived the right way, it does disappear from every selector
checked — the only gap is that one of the two import entry points never
archives anything, it deletes.

**A third destructive entry point, found while implementing the fix:** the
initial investigation named `SupplierDetailSheet.tsx` and
`SupplierDocumentsTab.tsx`'s AI Import flow as the destructive callers, but
`AdminSuppliersPage.tsx` also rendered its own inline
`<SupplierImportPanel compact />` (an "Import Products" expander per supplier
row in the admin suppliers table) — a fourth path into the same purge-based
pipeline that would otherwise have survived this fix untouched.

**A fourth, narrower destructive call, also found while implementing the
fix:** `SupplierDocumentsTab.tsx`'s Visual Catalog PDF upload
(`processUpload`, used by "Upload Price List" / "Replace PDF") was calling
the *full* `cleanImportForSupplier()` purge — hard-deleting the entire
product catalog and every dependent row — even though that flow only ever
stores PDF page images for a viewer and imports zero products. This was
clearly the same bug class (destructive-by-default where a merge/replace was
intended) and is fixed alongside the others below.

### Resolution (implemented)

- **New shared service** `src/services/diffImportPipeline.ts`, ported from
  `SupplierProductImporter.tsx`'s working `buildDiff()`/`handleApplyDiff()`
  logic: `buildProductDiff(supplierId, incoming)` matches by `product_code`
  (including archived-for-restore detection) and classifies each row as
  `new` / `update` / `restore` / `archive`; `applyProductDiff(opts)` does a
  three-phase upsert/update/archive-by-omission and writes a
  `price_list_uploads` audit row. It never issues a `.delete()` on products.
- **`SupplierProductImporter.tsx`** refactored to delegate to this shared
  service instead of keeping its own inline copy, so there is now exactly
  one implementation of the safe diff logic instead of one canonical copy
  plus copies-to-be-made.
- **All four destructive entry points repointed to the safe importer:**
  - `SupplierDetailSheet.tsx` — the supplier detail "Import" tab now renders
    `SupplierProductImporter` instead of `SupplierImportPanel`.
  - `AdminSuppliersPage.tsx` — the inline per-row "Import Products" expander
    now renders `SupplierProductImporter` instead of `SupplierImportPanel`.
  - `SupplierDocumentsTab.tsx`'s AI Import flow now calls
    `buildProductDiff`/`applyProductDiff` directly instead of
    `runImportPipeline`, and its "Replace existing products?" purge-warning
    dialog (and the state that drove it) was removed since diff-based import
    is always safe to run unconditionally. Toasts now report
    "X new, Y updated, Z archived" instead of "X products imported".
  - `SupplierDocumentsTab.tsx`'s Visual Catalog PDF upload (`processUpload`)
    no longer calls `cleanImportForSupplier()` at all — it now only removes
    the *old page images* for that supplier (storage files +
    `supplier_pdf_pages` rows) before rendering the new PDF, and the
    confirmation dialog copy was corrected to say so (it previously warned
    "this will DELETE all existing products", which was never actually true
    of that flow's intent, just its implementation).
- **Now-dead code removed:** `src/components/suppliers/SupplierImportPanel.tsx`
  and `src/services/pdfImportPipeline.ts` (`runImportPipeline`) had zero
  remaining callers after the four repoints above, so both files were
  deleted rather than left as orphaned dead code (git history preserves them
  if ever needed).
- **Deliberately left unchanged** — these are explicit, opt-in admin actions
  a user consciously triggers, not silent side effects of routine reimport,
  so they're out of scope for this fix:
  - The manual "Delete All Products" / "Archive All" tool on the orphaned-
    products card (`productDeleteMode` toggle).
  - "Clear All & Re-upload", a deliberate nuke-everything action that still
    calls `cleanImportForSupplier()` on purpose.
  - `cleanImportPipeline.ts` itself is kept — it still backs both of the
    actions above.
- `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` both pass with
  zero errors after all of the above.
- Not yet addressed (per Grok's review, worth a follow-up rather than this
  pass): a database-verified stable `product_code`/`supplier_sku` matching
  key, a "full replace vs. delta" toggle for partial supplier files, and a
  dedicated `product_import_runs` audit table beyond the existing
  `price_list_uploads` row.

## Grok's review of these findings

Asked Grok to sanity-check both diagnoses and recommendations ([full conversation](https://grok.com/c/09aa790f-77c2-4078-9971-2ba919e08d11)). Summary of its take:

**On pricing:** agrees the dual-source-of-truth bug is real and dangerous — "every downstream number (quote total, margin, job cost, inventory valuation) becomes untrustworthy," and calls the dual import in `QuoteBuilderTab.tsx` "the smoking gun." Agrees `@/lib/pricing` is the better file to consolidate on short-term, but flags it shouldn't be the *final* end state as-is because:
- The hardcoded `SUPPLIER_DISCOUNTS` table belongs in the database (a `supplier_discounts` table or a column on `suppliers`) so it can be edited without a code change when a supplier's trade terms change.
- The heuristic that guesses whether `cost_price` is already net-of-discount is fragile — the data model should just decide once, explicitly, whether `cost_price` means list price or net cost, rather than guessing at read time.
- Recommends: migrate all 12 callers onto `@/lib/pricing` first, fix the `QuoteBuilderTab.tsx` dual-import first as the highest-risk spot, add a unit test asserting one price for one product, only then delete `@/utils/pricing` — and audit the 12 call sites beforehand for any that deliberately relied on the simple formula because their cost was already netted (those would silently gain an extra 20% discount otherwise).

**On imports:** agrees strongly — calls Pipeline A "a data-loss foot-gun" with "no justification for keeping the destructive path" given Pipeline B's archive model already exists and works. Additional risks/edge cases it flagged worth covering in the refactor:
- Confirm `product_code` is a truly stable matching key across supplier files — if a supplier ever renumbers a model, archive-and-recreate orphans history; consider a secondary/never-changed `supplier_sku` key.
- Some supplier files are partial deltas, not full catalogues — consider a UI toggle for "full replace" vs "delta" so archiving-by-omission doesn't misfire on a partial file.
- Archiving a product still referenced by open quotes/jobs should never hard-delete (already true here) — just confirmed as the right behavior.
- Consider adding a `product_import_runs` audit row (who/when/counts/source file) for future debugging of price discrepancies.
- Suggests the Suppliers page's "Import products" button should call the same underlying service Pipeline B uses, rather than removing Pipeline A outright — keep the destructive code behind a flag briefly, then delete it.

**Overall:** treat as two separate PRs given the surface area — pricing is higher *urgency* (produces wrong numbers today), the import path is higher *severity* (can destroy history).

## Status

Both fixes described above have been implemented directly in the codebase
(not just recommended), verified with `npx tsc --noEmit -p tsconfig.app.json`
and `npm run build` (zero errors), and are ready to commit and push as two
separate commits (pricing consolidation, then import-pipeline safety), per
Grok's suggestion to treat them as two separate PRs given the different risk
profiles. Follow-ups intentionally left for later, listed under each
section's Resolution: a database-driven supplier discount table, a stable
`supplier_sku` matching key independent of `product_code`, a full-replace-
vs-delta toggle for partial supplier files, and deciding whether
`SupplierImportPanel`'s UI pattern (compact inline import) is worth
recreating around the new safe service anywhere it isn't already covered.
