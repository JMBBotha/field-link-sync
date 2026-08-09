# Fix false "Pending – assign a client" badge in Quote Builder

## Problem

The amber "Pending – assign a client" text in the Quote Builder header is not checking whether a client is assigned at all. It only checks whether the quote has been given a quote number yet. So a brand-new quote with a client already selected still shows the warning until the quote is saved and numbered.

## Fix

In the Quote Builder header:

- Show "Pending – assign a client" only when there is genuinely no client linked to the quote.
- When a client is assigned but the quote has not been saved/numbered yet, show a neutral "Draft – not saved yet" label instead of the misleading amber warning.
- When the quote has a number, keep showing the quote number as today.

## Technical detail

`src/pages/admin/AdminQuoteBuilderPageUnified.tsx` (header component, around line 181):

Current condition renders `meta?.quote_number` or else the amber warning. Replace with a three-way condition using the already-computed `clientLabel` (derived from the linked customer record with the quote's snapshot name as fallback):

- `meta?.quote_number` present -> quote number chip (unchanged)
- no quote number and no `clientLabel` -> amber "Pending – assign a client"
- no quote number but `clientLabel` present -> muted "Draft – not saved yet"

No backend or save-logic changes; the existing save gating (which already requires a client) is untouched.
