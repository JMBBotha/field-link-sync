# Align Quote Builder with Versioning

## Goal
Make quote versions snapshot the real line items used by the live quote builder, so versioned/accepted quotes never appear empty.

## Changes
1. Replace `create_quote_version` with a tenant-scoped transactional function that snapshots current `quote_items` rows into immutable `quote_line_items` rows.
2. Preserve product descriptions, quantities, pricing units, ordering, and totals while avoiding generated-column writes.
3. Add regression coverage for the snapshot contract and ensure failures return clear errors instead of creating empty versions.
4. Apply the database migration and run focused tests/build verification.

## Technical details
- `quote_items` remains the live single source of truth used by all builders.
- `quote_line_items` remains the immutable version snapshot store.
- Version creation will reject a quote with no live items rather than reporting a successful empty snapshot.
- Existing tenant authorization and accepted-quote locking remain unchanged.
