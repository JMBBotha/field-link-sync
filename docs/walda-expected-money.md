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

A manual or WALDA row linked to an invoice still replaces that invoice’s automatic expected date for the same kind. `other` replaces both the deposit and the final. The same `p_source_ref` is still inserted once, skipped when nothing changed, and updated when the amount, date, kind, client, invoice, or note changed.

## Automatic dates

Open invoices also get an expected date without anyone typing it. Paid, void, cancelled and archived invoices are left out. A partly paid invoice shows only the balance still owed. Nothing in this calculation changes an invoice or a payment.

A developer project with more than one house uses project timing. A single house, and any ordinary job, uses normal timing. An admin can force either timing on a project.

Project timing, unless that project picks another rule:

- Deposit: the deposit invoice date plus 15 days.
- Final: the final invoice date plus 15 days.
- The row shows the window, for example `Expected 1 Dec (1 to 6 Dec)`. The extra 5 days is the company window.

A project can instead use:

- a fixed day of the month, or
- the last day of the month.

Both of those take a month offset. 0 is the month the invoice is dated in. 1 is the next month. A short month uses its last day when the chosen day does not exist.

Normal timing:

- Deposit: the deposit invoice date plus 3 days.
- No deposit invoice yet: 3 days after the quote was accepted. The amount is the deposit share of the quote.
- Final: 7 days after the job is marked completed.
- No completed date yet: the final invoice date plus 7 days, marked as an estimate.

Company defaults are project deposit days, project final days, window extra days, normal deposit days, normal final days, and how many days past the expected date count as late. The late grace starts at 3. Unpaid money more than that many days past its expected date reads `Late` on Home and in the digest below.

A date saved on one invoice replaces the company and project timing for that deposit or that final. Admins save these. An invited client email cannot. The accounts bot cannot. The same check as company settings applies.

Stellenbosch Village (Cape Estates, `b00dc016-822d-411f-bf72-26a05537018f`) is the 15th of the month after the invoice. AVEC is the last day of the invoice’s own month. That AVEC offset is not confirmed yet. Both rules live in the preview and in `supabase/manual/20261116190000_expected_pay_project_seed.sql`. That seed is not part of the migration and is not applied to the live database from this preview.

## What WALDA reads

`walda_read_expected_money`

Sign in as the accounts bot. The call is `SECURITY DEFINER`, limited to the bot’s company by `_walda_co()`, and each read is written to `bot_audit_log` as `expected_money_read`. It does not change an invoice or a payment.

`p_today` is optional (`YYYY-MM-DD`). When it is left out, the day is today in Johannesburg.

```js
const { data, error } = await supabase.rpc("walda_read_expected_money", {
  p_today: "2026-11-16",
});
```

`data.lines` is the same picture Home uses: computed rows, acceptance deposits, and the manual or WALDA rows that replaced a computed date. `late` is true when the expected day is more than the company’s grace in the past. `estimate` is true only for a normal final that is still waiting on a completed date. `source` is `computed`, `override`, `acceptance`, `manual`, or `walda`.

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
