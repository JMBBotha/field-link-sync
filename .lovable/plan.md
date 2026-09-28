# One quote-level add bar

## What will change
- Remove the add-item/service control currently repeated beneath every estimate area.
- Render one `QuoteQuickEditor` at the end of the editable quote document, below the final area and immediately above totals, marked `data-testid="quote-add-bar"`, `print:hidden`, and `data-pdf-hide`.
- Keep the existing catalogue/service choices and the shared unit-add function, so AC units still receive their normal installation bundle.

## Routing behavior
- Add a pure `decideAddTarget` helper with tests for all requested area/unit combinations.
- AC unit: use the existing AC-unit detector; add to the last area when it has no AC unit, otherwise create the next default area and add there.
- Non-unit item/service: create the first default area when none exists; add directly when exactly one exists; when several exist, open the existing “Which area?” picker pattern with the last area preselected.
- After a successful add, scroll the chosen or newly created area into view without moving any existing quote lines.

## Small print fix
- Update `AreaNameLabel` so an explicitly synthetic default area prints an empty span, while genuine saved names continue printing unchanged.

## Technical details
- Extend `QuoteQuickEditor` with target-resolution callbacks rather than changing its catalogue, pricing, or shared `addCatalogProductToQuote` path.
- Move the document-level add slot into `EstimateDocument` just before its totals section.
- Reuse/extract the existing staff area-selection dialog UI rather than introduce a new page or workflow.
- Run the focused new tests, the full test suite, and the TypeScript check; then inspect the current build diagnostics.

## Out of scope
- No backend, schema, pricing, Mandy, client roll-up, client PDF, or existing-line area changes.
