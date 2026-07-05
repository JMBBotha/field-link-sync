# Optimistic UI Updates — High-Frequency Actions

Make the app feel instant on the actions users tap most. Every change follows the same pattern: update the cache immediately, roll back on error, and show a subtle "Saving…" hint.

## Scope (high-frequency only)

1. **Job status changes** — Start / Complete / Accept
   - Job Detail sticky action bar (mobile)
   - Dispatch cards and My Jobs cards
2. **Quote actions**
   - Create quote (draft appears in list before server confirms)
   - Convert quote → invoice (quote status flips to `accepted`, toast links to new draft)
3. **Invoice payments**
   - Record payment on Invoice Detail (status → `paid`, balance updates instantly)
4. **Lead → Customer linking / conversion**
   - Card in Leads list shows linked customer immediately

## Pattern (applied to every mutation)

```text
onMutate  -> cancel queries, snapshot, patch cache, return snapshot
onError   -> restore snapshot, toast error
onSettled -> invalidate to reconcile with server
```

- Button shows `Saving…` with spinner for ~300ms minimum so state is legible.
- Status badges use the same `statusBadge()` helper already in the app.
- Toasts via existing `useToast` / `sonner`.

## Files to change

### New shared helper
- `src/hooks/useOptimisticMutation.ts` — thin wrapper around `useMutation` that standardises the snapshot/rollback dance and the "Saving…" timing.

### Job status
- `src/hooks/useJobStatusMutation.ts` (new) — one mutation, patches every cached list containing the job (`["jobs"]`, `["my-jobs"]`, `["dispatch-jobs"]`, `["job-detail", id]`, `["customer-jobs-detail", customerId]`).
- Wire into:
  - `src/pages/admin/AdminJobDetailPage.tsx` (sticky bottom bar)
  - `src/components/FieldAgentLeadCard.tsx` (Start / Complete)
  - `src/components/admin/…` dispatch card (Accept)

### Quotes
- `src/components/quoting/QuoteBuilder.tsx` — on save-as-draft, prepend an optimistic row to `["quotes"]` cache before the insert resolves.
- `src/components/quoting/QuotesList.tsx` — `handleConvertToInvoice` immediately flips the row status to `accepted` and disables the button; rollback on failure.

### Invoice payments
- `src/components/invoicing/InvoiceDetailPage.tsx` (or `InvoiceDetail.tsx`) — record-payment handler patches `["invoice", id]` and `["invoices"]` to `paid` with new `balance_due`, then invalidates.

### Lead linking
- `src/components/EditLeadDialog.tsx` / `CreateLeadDialog.tsx` — when a customer is linked, patch the lead row in `["leads"]` and `["lead", id]` caches before the update returns.

## Failure UX

- Toast: `"Couldn't update — reverted"` (destructive variant).
- Cache rolls back to snapshot so the UI matches server truth.
- No full-page reloads.

## Out of scope

- Low-frequency admin actions (settings, brochure uploads, catalog imports).
- Anything that already has a working optimistic path.
- Offline sync queue — this layer sits above it; offline mutations keep their existing Dexie flow.

## Testing

- Manual: throttle network to Slow 3G in DevTools, verify each action feels instant and rolls back on forced 500.
- Playwright smoke: Job Detail → tap Start on mobile viewport, assert badge flips before network resolves.
