# Phase 1 screenshot checklist

Test harness only. These PNGs are the real admin and tech screens (`AdminSupplierDocsPage`, `ReceiveSupplierDocDialog`, `AdminStockCountPage`, `TechUnitSerials`) rendered from `src/harnessStock.tsx`. The harness stub answers inside the browser. No production SQL was run, nothing was deployed, and no live FWA, Fourways, or Massair supplier document was confirmed.

Open the harness with `harnessStock.html?v=01` (and `01d`, `02` … `09`) on a local dev server.

| Checklist | File | What it shows |
| --- | --- | --- |
| 1 | `01-supplier-docs-receive-stock.png` | Admin → Supplier documents, with Receive stock, on test delivery note TST-DN0001. The card has no client. |
| 1 | `01-receive-three-buckets-vat.png` | Confirm test invoice TST-INV0042. Indoor and outdoor are job-reserved on Install · job j1, the spare unit is general stock, gas is the materials pool. Unit cost is exclusive of VAT. |
| 2 | `02-delivery-note-qty-in-count.png` | After delivery note TST-DN-CU, Copper test quantity 4 is in the stock count at R40.00. |
| 3 | `03-matching-invoice-qty-unchanged.png` | After matching invoice TST-INV-CU, quantity stays 4. Value moves to the invoice cost, R48.00. |
| 4 | `04-invoice-awaiting-delivery.png` | Invoice TST-INV-W before the goods arrive. Widget × 3 is under Awaiting delivery and the on-hand count is empty. |
| 5 | `05-delivery-note-moves-qty-into-count.png` | The delivery note is linked. The same quantity 3 is in the count once (R60.00) and is no longer awaiting. |
| 6 | `06-credit-serial-refused-and-rereceive.png` | Credit TST-CN-SA for serial SA. Confirming a credit of 2 is refused: “Credit of 2 is more than the 1 still received”. Serial SA is entered again on a new delivery note. |
| 7 | `07-confirm-uses-jobs-on-file.png` | Confirm TST-DN0001. The dialog says confirming does not create a client. The job menu is only Install · job j1 and Service · job j2. |
| 8 | `08-tech-serial-and-value-before-finish.png` | Tech card “Units on this job” asks for a serial and shows no price. Stock value of that unit is R130.00 (R100 received + R30 invoice difference). |
| 8 | `08-after-finish-unit-left-stock.png` | After finish, that unit row is gone from on-hand. Copper test is still in the materials pool. |
| 9 | `09-allowance-stubs-inactive.png` | Add allowance stubs. The toast says they stay inactive until WALDA fills the quantities. |

## Gaps

Shots 2, 3, 4, 5 and 8 show the real Stock count page with the quantities the ledger test already checked. The harness did not post those movements again.

The credit refusal is the real toast. The harness returns the same error `sjd_receive` raises. It was not saved against a live credit note. Receiving serial SA again is shown as the receive row. The database rule that a returned serial can be received again is in the ledger test.

Finish job was not clicked. That writes a job status. Shot 8 is the tech serial card and the stock count before and after the unit leaves on-hand.

There is no separate allowance list. The stock-count button and its toast are the screen. Stubs were not seeded in production.

The red pair badge on TST-INV0042 is the existing “invoice higher than catalogue” warning on these test prices.
