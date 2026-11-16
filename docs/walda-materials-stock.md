# WALDA: materials pool, unit purchases, returns, and direct delivery

Field Lynk already keeps stock in three buckets (Phase 1):

1. **Materials pool** — cabling, copper pipe, aluminium pipe, lagging, and the rest. Costed to a job later by the standard average, not by booking each metre to a house.
2. **Units bought for a job** — a physical unit received against that job (or its project house).
3. **Unallocated units** — a physical unit with no job yet. Allocate it later.

These calls write into that ledger. They do not invent a fourth bucket. A materials line never lands on a house. A direct delivery (the client paid the supplier, for example RKP 21217) is a note on the job only: no stock row and no cost.

Sign in as the WALDA accounts bot (the same user that calls `walda_record_bank_balance`). The bot’s company is the only company a `walda_*` call can write. A staff login, a disabled bot, and the anonymous key are refused.

Slip photos go in the private bucket `purchase-slips`, under a folder named with the company id: `purchase-slips/{company_id}/…`. The bucket is not public. Pass that path as `p_attachment`. A public URL is refused.

Every purchase call returns `result` `inserted`, `updated`, or `skipped`, the same way `walda_record_bank_balance` does. Send `p_source_ref` (up to 120 characters). The same reference and the same details return `skipped` and the same id. A changed amount, quantity, note, or payment returns `updated` on that one row. A retry does not add a second purchase. Without `p_source_ref`, each call inserts a new row.

Each call, including a skip, is written to `bot_audit_log`.

## End-to-end flow

1. **Supplier slip.** Johan posts the photo to WALDA. WALDA calls `walda_record_material_purchase` or `walda_record_unit_purchase` with `p_attachment` pointing at the private slip, `p_doc_ref` / `p_invoice_ref` for the supplier invoice, and `p_paid` false when the invoice is not paid yet.
2. **Bank match.** The weekday FNB run matches the payment with `walda_bank_match` (supplier bill, expense, or an existing payment — that call is unchanged). It returns the bank line id.
3. **Receive.** If the slip and the payment arrive together, pass `p_paid` true and `p_bank_line` on the purchase call. Materials go to the pool. Units go to the job or house when one is known, otherwise they stay unallocated.
4. **Allocate.** Units that arrived with no job are booked out later with `walda_allocate_unit`.
5. **Link payment.** When the purchase was recorded unpaid and the bank line turns up afterwards, call `walda_link_purchase_payment`. It marks that purchase paid. It does not create a client payment and it does not edit the original quantities.
6. **Return (only after Johan says so).** WALDA flags the supplier credit note to Johan. It calls `walda_record_purchase_return` only when he says to book it. The original purchase is left as it was. The credit is its own row.
7. **Direct delivery.** When the client paid the supplier, call `walda_record_direct_delivery`. Nothing enters stock and nothing hits cost. The note shows on the job timeline.

Recent pool buys to load when the slips are in: about R25–26k cabling, about R25–26k copper pipe, about R20k aluminium pipe and lagging. Those are purchases, not the standard averages.

## Materials purchase

`walda_record_material_purchase`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_item` | yes | Item or category, such as `Copper pipe`. |
| `p_qty` | yes | Quantity, more than zero. |
| `p_unit` | yes | `m`, `each`, `kg`, `l`, or `roll`. |
| `p_total_cost` | yes | Total cost excluding VAT. |
| `p_doc_date` | yes | Invoice or slip date. |
| `p_supplier` | no | Supplier name. |
| `p_doc_ref` | no | Supplier document reference. |
| `p_invoice_ref` | no | Supplier invoice reference. Stored on the purchase. |
| `p_paid` | no | `true` when the invoice is already paid. Default unpaid. |
| `p_bank_line` | no | `bank_lines.id` from `walda_bank_match`, when the payment is already matched. |
| `p_note` | no | Up to 500 characters. |
| `p_source_ref` | no | Idempotency key, up to 120 characters. |
| `p_attachment` | no | Private storage path that contains the company id. |
| `p_already_used` | no | Quantity already used out of this buy. Cannot be more than `p_qty`. Posts a use against the pool. |

There is no job argument. Materials only enter the pool.

An admin can type the same buy on Stock with `record_material_purchase` (same arguments, `source` `manual`). The bot cannot call that one.

```js
const { data, error } = await supabase.rpc("walda_record_material_purchase", {
  p_item: "Copper pipe",
  p_qty: 100,
  p_unit: "m",
  p_total_cost: 25600,
  p_doc_date: "2026-11-03",
  p_supplier: "One Stop",
  p_invoice_ref: "CU-19",
  p_paid: false,
  p_source_ref: "fnb-cu-19",
  p_attachment: "purchase-slips/…company id…/cu-19.jpg",
});
```

```json
{ "result": "inserted", "id": "…", "kind": "material_purchase", "bucket": "material_pool", "total": 25600, "already_used": 0 }
```

Home shows the pool value (`material_pool_on_hand`) on the materials card. Stock shows the same total, the lines, and a one-tap **Already used** adjustment (`record_pool_used`). That adjustment is for an admin, not for WALDA.

Changing the quantity or the cost after some of it has been used or credited fails with `This purchase is already used or credited. Book a return instead of changing it.` A note, a slip path, or a paid flag on the same source reference is an update.

## Unit purchase

`walda_record_unit_purchase`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_supplier` | yes | Supplier name. |
| `p_doc_ref` | yes | Supplier document reference. |
| `p_doc_date` | yes | Slip or invoice date. |
| `p_model` | yes | Model code or size, as printed. |
| `p_qty` | yes | Whole number of units, 1 to 500. |
| `p_unit_cost` | yes | Cost excluding VAT for one unit. |
| `p_job` | no | `jobs.id`. With a job, the units are bought for that job. |
| `p_project_house` | no | `project_houses.id`. When the house’s installation job can be seen, the units are booked to that job. Otherwise they are kept against the house. |
| `p_invoice_ref` | no | Supplier invoice reference. |
| `p_paid` | no | Paid or unpaid. |
| `p_bank_line` | no | Bank line id, when already matched. |
| `p_note` | no | Up to 500 characters. |
| `p_source_ref` | no | Idempotency key. |
| `p_attachment` | no | Private slip path. |

The model is matched to the catalogue. One clear match stores `product_id` and `"review": false`. No match, or more than one, keeps the printed model as text and returns `"review": true`. The call still books the units. It does not fail for an unknown model.

With neither a job nor a house, the bucket is `general_unit` (unallocated). With a job or a house, the bucket is `job_unit`.

```json
{ "result": "inserted", "id": "…", "kind": "unit_purchase", "bucket": "job_unit", "review": false, "product_id": "…", "qty": 1 }
```

## Allocate an unallocated unit

`walda_allocate_unit`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_source_ref` | yes | Idempotency key for this allocation, not the original purchase. |
| `p_unit` | one of these | One `stock_units.id`. |
| `p_purchase_ref` | one of these | The purchase `p_source_ref`, or the purchase id. |
| `p_job` | one of these | Job to book onto. |
| `p_project_house` | one of these | House. The installation job for that house is used when it exists. |
| `p_qty` | no | How many unallocated units. Default 1. |

A repeat with the same source reference and the same job returns `skipped`. A different job on that same source reference fails: use a new source reference. A unit that was received already on a job is not unallocated stock. If fewer units are free than `p_qty`, the call fails and nothing is half-allocated.

```json
{ "result": "inserted", "id": "…", "kind": "allocate", "qty": 1, "job_id": "…", "house_id": "…" }
```

## Link a payment later

`walda_link_purchase_payment`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_source_ref` | one of these | The purchase source reference. |
| `p_purchase` | one of these | The purchase id returned earlier. |
| `p_bank_line` | one of these | `bank_lines.id`. |
| `p_bank_line_ref` | one of these | The reference printed on that bank line. If several lines share it, send the id. |

Marks that purchase paid and stores the bank line. The same line again returns `skipped`. A different line returns `updated`. The purchase quantities stay as they were. This does not write a client payment.

```json
{ "result": "updated", "id": "…", "payment_status": "paid", "bank_line_id": "…" }
```

## Credit note

`walda_record_purchase_return`

WALDA shows Johan the credit note first. Call this only when he says to book it.

| Name | Required | Meaning |
| --- | --- | --- |
| `p_supplier` | yes | Supplier name. |
| `p_credit_ref` | yes | Credit note reference. |
| `p_doc_date` | yes | Credit note date. |
| `p_lines` | yes | JSON array. Each line has `kind` (`material` or `unit`), `item` or `model`, `qty`, and `amount` (the credit, excluding VAT). |
| `p_purchase_ref` | yes | `p_source_ref` of the original purchase. |
| `p_bank_line` | no | Bank line id, when the refund is already matched. |
| `p_source_ref` | no | Idempotency key for this credit note. |
| `p_note` | no | Up to 500 characters. |
| `p_attachment` | no | Private path to the credit note. |

Materials: the pool quantity and the pool value go down by the credited qty and amount. The call fails if the credit is more than what is still in the pool.

Units: stock in the right bucket goes down. If a unit was allocated to a job, it is taken off that job first and then returned. If it cannot be taken off, the call fails and says so. A credit larger than the units still in stock fails.

The original purchase row is not deleted and not edited. The return is a new row with `linked_id` pointing at it. Stock → **Returns / credits** lists these rows.

```js
await supabase.rpc("walda_record_purchase_return", {
  p_supplier: "One Stop",
  p_credit_ref: "CN-1",
  p_doc_date: "2026-11-10",
  p_lines: [{ kind: "material", item: "Copper pipe", qty: 10, amount: 2560 }],
  p_purchase_ref: "fnb-cu-19",
  p_source_ref: "cn-1",
});
```

```json
{ "result": "inserted", "id": "…", "kind": "return", "linked_id": "…", "credit_ref": "CN-1" }
```

Changing the lines after the credit is booked fails. Use a new source reference. A note or attachment on the same reference is an update.

## Direct delivery

`walda_record_direct_delivery`

| Name | Required | Meaning |
| --- | --- | --- |
| `p_supplier` | yes | Supplier, such as `RKP`. |
| `p_order_ref` | yes | Order reference, such as `21217`. |
| `p_client` | one of these | Client name. |
| `p_customer` | one of these | `customers.id`. |
| `p_job` | one of these | `jobs.id`. The timeline note is written here. |
| `p_project_house` | one of these | House. The installation job is used for the timeline when one is named on that house. |
| `p_units` | yes | JSON array of `{ "model": "24k", "qty": 1 }`. |
| `p_doc_date` | yes | Date. |
| `p_note` | no | Short note. |
| `p_attachment` | no | Private path to the slip. |
| `p_source_ref` | no | Idempotency key. |

```json
{ "result": "inserted", "id": "…", "kind": "direct_delivery", "stock": false, "cost": 0, "job_id": "…" }
```

`stock` is false and `cost` is 0. No `stock_movements` row is written. The job timeline shows **Direct delivery** and the sentence “Client paid the supplier. Not taken into stock.”

## Standard averages

Admins keep the standard use of the pool, per company, in `material_pool_averages`. Example: copper pipe, 12 m per install. Cabling can be per metre. Stock has a small table for this. Only an admin can add or change a row (`save_material_average`, `delete_material_average`).

WALDA reads them and must not change them:

`walda_read_material_averages()`

```json
{
  "company_id": "…",
  "averages": [{ "id": "…", "label": "Copper pipe", "per": "install", "qty": 12, "unit": "m" }]
}
```

There is no WALDA call that writes this table. Job costing still uses the pool’s average cost, as it did before.

## Errors

The call fails with no new stock when the message is an error. A `skipped` result is not an error.

| Message | When |
| --- | --- |
| `not allowed` | Not the accounts bot (for `walda_*`), or not an admin (for the desk calls). |
| `This company is not active` | The company cannot be written. |
| `Attachment must be a private file for this company` | The path is a public object URL. |
| `Attachment path must sit in this company's folder` | The path does not contain the company id. |
| `Bank line not found` | The id or reference is not a line of this company. |
| `More than one bank line matches that reference` | Send `p_bank_line` (the id). |
| `That source reference is already used for a different record` | The same `p_source_ref` was used for another kind of call. |
| `Original purchase not found` | The credit note’s `p_purchase_ref` does not match a purchase. |
| `This purchase is already used or credited. Book a return instead of changing it.` | A materials correction after use or a credit. |
| `These units have already moved. Book a return instead of changing the purchase.` | A unit correction after allocate, use, or a credit. |
| `Only N unallocated unit(s) match. Nothing was left half-done.` | Allocate asked for more free units than there are. |
