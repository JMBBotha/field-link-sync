# Unified Quote System — Single Source of Truth

Consolidate on `quote_items` + `quote_areas` (the richer model). Legacy `quote_line_items` becomes read-only, then retired. Every surface reads and writes through one path.

## 1. Database migration (one migration, transactional)

- **Sequence + RPC for quote numbers** — Add `quote_number_seq` and a security-definer function `generate_quote_number()` returning `Q-YYYY-XXXX`. Wire an `auto_assign_quote_number` BEFORE INSERT trigger so every new `quotes` row gets a number immediately (no more nulls like Cape Estates).
- **Backfill quote numbers** on existing rows where `quote_number IS NULL`.
- **Migrate `quote_line_items` → `quote_items`** for every quote that has zero `quote_items` rows. Each legacy row becomes a top-level item (no `area_id`, no `parent_item_id`, `item_type='line'`, `source='legacy'`).
- **Orphan quotes (like Cape Estates)** — quotes with totals but zero items in either table get a synthetic "Legacy quote — please re-enter items" placeholder `quote_items` row plus a metadata flag, so the user sees the old total and knows to rebuild. Totals stay untouched.
- **Recompute totals** trigger on `quote_items` (insert/update/delete) so `quotes.subtotal / vat_amount / total` always reflect actual items — no more phantom totals.
- **Lock legacy table** — revoke INSERT/UPDATE/DELETE on `quote_line_items` from `authenticated`. Keep SELECT for a short read-only grace period, then drop in a follow-up migration once no code references it.

## 2. Shared fetch hook — one query, everywhere

Create `src/hooks/useQuote.ts` exposing a single query keyed by `["quote", id]`:

```
quotes + quote_areas + quote_items + customers + leads
```

`.eq("id", quoteId).maybeSingle()` — used by Quotes list detail, Quote Builder, Lead detail, Customer detail, Job view, PDF, and the client-facing proposal view. All writes call `queryClient.invalidateQueries({ queryKey: ["quote", id] })` so every surface refreshes instantly.

## 3. One Quote Builder

- **Promote `AdminQuoteBuilderPageUnified` + `QuoteContext`** to be the canonical builder.
- **Route `/admin/quotes/:id` and every "Open quote" / "Edit quote" link** (Quotes list, Lead detail, Customer detail, Job detail, Proposal builder, Global search) through the unified builder with the real `quote.id`.
- **Retire `src/components/quoting/QuoteBuilder.tsx`** — replace its body with a thin redirect to the unified builder. This kills the destructive `DELETE FROM quote_line_items` save path that was wiping data.
- **Empty-quote safeguard** — when the builder mounts with a `leadId` or `customerId` but no `quoteId`, look up the latest existing draft for that lead/customer first; only create a new row if none exists.

## 4. Read-side rewire

- **QuotesList, Lead detail, Customer detail, Job detail, PDF, ProposalBuilder, ClientProposalView** all read line data from `quote_items` (grouped by `quote_areas`). Legacy fallback removed.
- **PDF renderer** groups items by area, honours `parent_item_id` for bundle nesting, and hides Cost/Markup on non-draft quotes (existing behaviour preserved).
- **Convert-to-invoice** (`convertQuoteToInvoice.ts`) reads from `quote_items` instead of `quote_line_items`.

## 5. Verification checklist (run after deploy)

- Open Cape Estates from Quotes list, Lead, and Customer surfaces → all three show identical data (placeholder row + preserved total, with rebuild prompt).
- Open Brendon Behnke Q-2026-0019 from all surfaces → identical, migrated line item, total unchanged.
- Create a new quote → receives next `Q-2026-XXXX`, appears in list, lead, customer views immediately.
- Edit an item in the builder → change reflects on Lead detail and Customer detail without manual refresh.
- Attempt an insert into `quote_line_items` as `authenticated` → rejected.

## Technical details

- Migration is a single transactional file. RPC uses `SECURITY DEFINER SET search_path = public`.
- Grants on new sequence + function: `usage` to `authenticated`, `all` to `service_role`.
- No RLS changes needed on `quote_items` / `quote_areas` (existing policies scope by company via join to `quotes`).
- React Query key contract: `["quote", id]` for a single quote, `["quotes", filters]` for the list. Writes invalidate both.
- Realtime subscription in `QuoteContext` already covers `quote_items` + `quote_areas`; no change.
- `QuoteBuilder.tsx` stub keeps its exported props so no callers break; it renders `<Navigate to={"/admin/quote-builder?quoteId=..."} replace />` (or equivalent).

## Out of scope for this change

- Redesigning the builder UI, area/bundle editing UX, or PDF layout.
- Touching `pdfTextExtractor.ts` (locked).
- Migrating `quote_line_items` schema deletion — done in a follow-up once monitoring shows zero reads for a week.
