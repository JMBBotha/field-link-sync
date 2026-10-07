# Show every active catalogue service

## Changes
- Extend the core-service mirror with “Extraction system” and “Fresh air system” after “Package unit”, allowing blank descriptions.
- Update the shared Add service dropdown so its list has a reliable scrollable height on desktop and mobile, without limiting service rows.
- Since every quote-builder Add service entry uses the shared `QuoteQuickEditor`, verify each builder surface receives the same full list.

## Verification
- Add tests proving all 12 active core services remain ordered and visible to the picker, including blank descriptions.
- Run the focused tests and inspect the live picker at desktop and 390px with the read-only browser guard, confirming 12 service names render.

## Scope
- UI and shared frontend catalogue helpers only; no database, pricing, or server-function changes.
