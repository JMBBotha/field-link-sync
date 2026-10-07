# Canonical quote builder release

## Build
- Replace the initial area-name entry with four primary blue choices—Main bedroom, Guest bedroom, Lounge, Office—and an Other menu containing the remaining approved names plus free typing. Repeated names keep automatic numbering.
- Collapse the area chooser after creation, then render one action row: Add unit, Add service, Add material, Selected. Add area reopens the same chooser in a shadowed pop-up within the estimate, above totals.
- Make Selected read only from the existing PDF Selected Items basket and remove the Favourites label from that view.
- Put personal favourites directly below each item search: opening an empty search shows favourites; typing switches to ranked catalogue search; selecting one uses the existing quote add path.
- Keep the area table as Description, Rate, Quantity, Line total, with labour last inside each area and its existing orange outline.
- Apply slate/grey surfaces, blue accents, and orange selected states using semantic design tokens and existing controls.

## Compatibility
- Preserve existing areas and lines, pricing, specials, resolved bundles, R0 send block, manual labour, automatic labour reconciliation, PDF radio three-click cycle, and client output.
- The two new services remain zero-price lines with no description until edited.

## Technical details
- Reuse the shared area-name and quick-editor components so estimate detail, AreaFirst, Visual PDF, wizard, inline builder, popup, BasketCanvas, desktop, and mobile stay aligned.
- Do not alter the database, backend functions, Mandy files, or saved quote data.

## Verification
- Add focused tests for chooser ordering/collapse, repeated-name numbering, Selected basket labeling, favourites/search behavior, service ordering, R0 service lines, and control placement.
- Run affected tests and guarded browser checks at 1280px and 390px without allowing database writes.
