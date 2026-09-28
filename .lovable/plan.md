# Collapse installation materials on estimates

## Build
- Add a stable unit reference to each installation line supplied by the estimate builder.
- Group linked installation lines beneath their AC unit in the staff estimate table.
- Show one collapsed summary row with item count and total; expand it to reveal the unchanged line editors.
- Keep child rows visible for printing and leave orphan installation lines ungrouped.

## Verification
- Add focused tests for collapsed, expanded, empty, and orphan cases.
- Run the full test suite and TypeScript check.

## Technical details
- UI state stays local to the estimate document and defaults closed per unit.
- No database, pricing, client roll-up, kit recipe, or Mandy behavior changes.
