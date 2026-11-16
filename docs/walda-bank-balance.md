# WALDA: record the checked bank balance

Field Lynk’s **Cash on hand** tile reads the latest row in `cf_bank_balances`. Checking the bank in WALDA does not change that row until WALDA calls this function.

Sign in as the WALDA accounts bot (the same user that calls `walda_bank_match`). The bot’s company is the only company this call can write. A staff login, a disabled bot, and the anonymous key are refused.

## Call

`walda_record_bank_balance`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_amount` | yes | Checked balance in rands, including cents. Negative is allowed (the account is overdrawn). Rounded to 2 decimal places. |
| `p_as_at` | yes | Statement date, `YYYY-MM-DD`. Not in the future (Johannesburg). Not before 2000-01-01. |
| `p_account` | one of these | `cf_bank_accounts.id` for the bot’s company. |
| `p_account_ref` | one of these | The reference stored on that account, or just its digits. `563591` matches a stored `…563591`. |
| `p_note` | no | Short note, up to 500 characters. Blank is stored as no note. |
| `p_source_ref` | no | WALDA’s own reference for this check (statement id), up to 120 characters. |

Pass the account id, or the reference, or both. If both are sent, they must be the same account.

Example (the bot’s Supabase client):

```js
const { data, error } = await supabase.rpc("walda_record_bank_balance", {
  p_amount: 412550.25,
  p_as_at: "2026-11-16",
  p_account_ref: "563591",
  p_note: "FNB checked",
  p_source_ref: "fnb-2026-11-16",
});
```

The same call in SQL, still as the bot:

```sql
SELECT public.walda_record_bank_balance(
  p_amount => 412550.25,
  p_as_at => DATE '2026-11-16',
  p_account_ref => '563591',
  p_note => 'FNB checked',
  p_source_ref => 'fnb-2026-11-16'
);
```

## What comes back

`data` is one object. `result` says what happened. Older statement dates are never changed.

| `result` | Meaning |
| --- | --- |
| `inserted` | First time WALDA recorded this account on this statement date. A new row, `source` `walda`. |
| `updated` | WALDA already had a row for this account and date, and the amount, note, or source reference changed. That one row is updated. |
| `skipped` | The same account, date, amount, note, and source reference were already stored. No second row. |

```json
{
  "result": "inserted",
  "id": "…uuid of the cf_bank_balances row…",
  "account_id": "…uuid…",
  "account_label": "FNB Business",
  "balance": 412550.25,
  "as_at": "2026-11-16",
  "source": "walda"
}
```

A repeat of the same check returns `"result": "skipped"` and the same `id`. Sending a corrected amount for that same date returns `"result": "updated"`. Leaving the note or the source reference out counts as blank. A later call that drops a note you sent before is an update, not a skip, because the stored note changes.

Each call, including a skip, is written to `bot_audit_log` as `bank_balance_inserted`, `bank_balance_updated`, or `bank_balance_skipped`.

A balance a person types on Cash-flow health is a separate row (`source` `manual`). This call does not change those rows. Home shows the latest statement date, and if two rows share that date, the one saved last.

## Errors

The call fails with no row written. The message is what the client should show.

| Message | When |
| --- | --- |
| `not allowed` | Not signed in as an enabled accounts bot. |
| `This company is not active` | The bot’s company is archived, on hold, or otherwise not active. |
| `Bank account not found` | The id or reference is not an account of the bot’s company. |
| `Account reference does not match that account` | Both id and reference were sent, and they point at different accounts. |
| `More than one bank account matches that reference` | Two accounts share those digits. Send `p_account` (the id) instead. |
| `Give the bank account id or the account reference` | Neither was sent. |
| `Amount is required` | Amount was missing. |
| `Amount is not a bank balance` | Amount is bigger than R1 000 000 000 either way. |
| `Statement date is required` | Date was missing or before 2000-01-01. |
| `Statement date cannot be in the future` | Date is after today in Johannesburg. |
| `Note is too long` | Note is over 500 characters. |
| `Source reference is too long` | Source reference is over 120 characters. |

The home tile only adds accounts marked “Count in forecast”. Massair CT’s FNB Business account is included. A balance saved on an account that is not ticked is stored, and it does not appear in Cash on hand.
