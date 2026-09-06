# QA Test Log — Lead → Quote → Invoice → Payment

**Date:** 2026-09-06  
**Tester:** jmbbotha  
**Environment:** Preview / sandbox (dummy data only)  
**Status:** PASSED

---

## Scope

End-to-end validation of the commercial sales spine using synthetic test data only. No real customer data or live emails were used.

## Test Data

| Field | Value |
|-------|-------|
| Lead name | Test Dummy Lead QA |
| Phone | 0821234567 |
| Address | 10a Gladstone Street, Durbanville |
| Email | qa-test@example.com (sandbox, no real emails sent) |
| Quote | Q-2026-0005 |
| Product | Daikin 11.9K INV MW split unit |
| Quote total | R14,109.12 incl. VAT |
| Deposit invoice | INV-016 |
| Deposit amount | R9,876.38 (70%) |

## Steps Performed

1. **Create lead** — Used the New Lead form to create "Test Dummy Lead QA" with phone 0821234567 and address 10a Gladstone Street, Durbanville.
2. **Create estimate** — Built estimate Q-2026-0005 for the lead using an existing catalog product (Daikin 11.9K INV MW split unit). Total: R14,109.12 incl. VAT. Saved as draft.
3. **Accept quote** — Marked Q-2026-0005 as Accepted, simulating client acceptance via the public quote link. This auto-generated a 70% deposit invoice INV-016 for R9,876.38.
4. **Invoice lifecycle** — Marked INV-016 as Sent, then as Paid.

## Result

The full lead → quote → approval → deposit invoice → payment workflow completed successfully end-to-end with no real emails triggered.

## Notes

- All data used was dummy/sandbox data.
- No production or real customer data was accessed or modified.
- Email sending was not triggered; the test email address is a placeholder.
