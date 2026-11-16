# WALDA: record expected money in

Field Lynk’s admin Home shows **Cash on hand**, then **Next 7 days**, then **Next 30 days**, then **Projected** (cash plus the next 30 days, including anything overdue). Open invoices already supply their deposit and final balances. WALDA does not retype those. This call adds the rest: a deposit, a final, or other money that is not already on an invoice.

Sign in as the WALDA accounts bot (the same user that calls `walda_record_bank_balance`). The bot’s company is the only company this call can write. A staff login, a disabled bot, and the anonymous key are refused.

This call does not change an invoice and does not record a payment. Marking money received on Home only updates this expected-money row.

## Call

`walda_record_expected_money`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_amount` | yes | Rands, including cents. More than zero. Rounded to 2 decimal places. |
| `p_expected_on` | yes | The day the money is expected, `YYYY-MM-DD`. From 2000-01-01 up to five years ahead (Johannesburg). |
| `p_kind` | yes | `deposit`, `final`, or `other`. |
| `p_client` | no | Client name, up to 200 characters. |
| `p_customer` | no | `customers.id` for the bot’s company. |
| `p_invoice` | no | `invoices.id` for the bot’s company. When this is set, Home uses this row instead of that invoice’s automatic figure for the same kind. `other` replaces the invoice’s deposit and final figures. |
| `p_note` | no | Up to 500 characters. Blank is stored as no note. |
| `p_source_ref` | no | WALDA’s own reference, up to 120 characters. Send the same value on a retry. |

Example (the bot’s Supabase client):

```js
const { data, error } = await supabase.rpc("walda_record_expected_money", {
  p_amount: 15000,
  p_expected_on: "2026-11-20",
  p_kind: "deposit",
  p_client: "Harbour",
  p_invoice: "…invoice uuid, or omit…",
  p_note: "Verbal deposit date",
  p_source_ref: "exp-harbour-2026-11-20",
});
```

The same call in SQL, still as the bot:

```sql
SELECT public.walda_record_expected_money(
  p_amount => 15000,
  p_expected_on => DATE '2026-11-20',
  p_kind => 'deposit',
  p_client => 'Harbour',
  p_note => 'Verbal deposit date',
  p_source_ref => 'exp-harbour-2026-11-20'
);
```

## What comes back

`data` is one object. `result` says what happened.

| `result` | Meaning |
| --- | --- |
| `inserted` | First time WALDA recorded this source reference. |
| `updated` | The same source reference was already stored, and the amount, date, kind, client, invoice, or note changed. That one row is updated. |
| `skipped` | The same source reference and the same details were already stored. No second row. |

```json
{
  "result": "inserted",
  "id": "…uuid of the cf_receipts row…",
  "amount": 15000,
  "expected_on": "2026-11-20",
  "kind": "deposit",
  "status": "expected"
}
```

A repeat of the same details returns `"result": "skipped"` and the same `id`. Sending a corrected amount for that same source reference returns `"result": "updated"`.

Without `p_source_ref`, every call inserts a new row. Send the reference whenever WALDA might retry.

Each call, including a skip, is written to `bot_audit_log` as `expected_money_inserted`, `expected_money_updated`, or `expected_money_skipped`.

A row a person types on Home is `source` `manual`. This call writes `source` `walda`. Home shows both, and it does not add the invoice-sync rows (`source` `field_lynk`) a second time.

## Errors

The call fails with no row written. The message is what the client should show.

| Message | When |
| --- | --- |
| `not allowed` | Not signed in as an enabled accounts bot. |
| `This company is not active` | The bot’s company is archived, on hold, or otherwise not active. |
| `Amount is required` | Amount was missing. |
| `Amount is not an expected amount` | Amount is zero, negative, or over R1 000 000 000. |
| `Kind must be deposit, final or other` | Kind was missing or something else. |
| `Expected date is required` | Date was missing, before 2000-01-01, or more than five years ahead. |
| `Note is too long` | Note is over 500 characters. |
| `Source reference is too long` | Source reference is over 120 characters. |
| `Client not found` | `p_customer` is not a client of the bot’s company. |
| `Invoice not found` | `p_invoice` is not an invoice of the bot’s company. |
| `This expected amount is already received` | That source reference was already marked received or cancelled, and the new call changes the amount, date, kind, or invoice. |
