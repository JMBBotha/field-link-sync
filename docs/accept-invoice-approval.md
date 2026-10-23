# Accepted quote -> approve deposit invoice (Step 2, NOT live)

On accept: draft deposit invoice (unchanged) + one in-app alert "<Client> accepted Q-xxxx" to the quote's rep and that company's admins (admins only if no rep), with Send invoice now / Edit / Hold.
If nobody acts, cron `invoice-send-approvals` (every minute) sends the invoice (existing email incl. "deposit due") after `company_settings.invoice_auto_send_minutes` (default 15, 0 = never).
Hold stops auto-send until someone sends manually. Edit = hold ("Opened to edit") + open invoice. Every action is logged in `invoice_send_events`.

- Migration: drizzle/migrations/0025_accept_invoice_approval.sql (idempotent)
- Rollback: drizzle/rollback/0025_accept_invoice_approval_rollback.sql (+ delete the 0025 row from drizzle.__drizzle_migrations)
- DB proof (local Postgres 17, stubbed Supabase, no network): scripts/db-tests/0025/run.sh
- UI tests: src/test/invoiceSendApproval.test.tsx

Deploy (only after Johan approves): apply 0025 to Massair CT, insert drizzle row (sha256 of file, when from journal), verify read-only, test on a TEST quote with a test client email only.

## 0026: one alert per accept (branch `accept-alert-merge`, NOT live)

Before 0026 a staff accept gave the rep three notices: the invoice alert, "Quote X accepted — hand to technician"
(`quote_accepted_handover`) and "Quote Accepted" (`quote_status_change`). They come from triggers on every accept,
not from test quotes.

After 0026:
- The invoice alert ("<Client> accepted Q-x") is the only accept notice for the rep and company admins.
- It keeps the hand-to-technician link: `metadata.handover_link` (`/admin/visits/<lead>`, or `/admin/estimates/<quote>`
  when there is no visit; empty when an installation job already exists) plus `metadata.lead_id`.
  The bell list shows a **Hand to technician** button, also after the alert is read.
- Deposit in the alert body uses the SA format: `(deposit R 27 421,32)` (`fmt_rand_sql`).
- How: `isa_queue` marks the quote in the transaction-local setting `app.isa_alerted_quotes`; `p3_notify_quote_accepted`
  and `notify_quote_status_change` skip the accept notice for a marked quote. `isa_queue` also removes any of those two
  notices written earlier in the same transaction (works in either trigger order). Older notices are never touched.
- Fallback unchanged: if no deposit invoice/approval is created (e.g. variation, no rep/creator, re-accept of an
  already-queued invoice) the old notices still go out. Other status notices (Sent, Viewed, ...) are unchanged.
- Tests: `scripts/db-tests/0026/run.sh` (local PG17) and `src/test/acceptAlertMerge.test.tsx`.
- Rollback: `drizzle/rollback/0026_accept_alert_merge_rollback.sql` restores the exact pre-0026 functions
  (md5 matches live on 23 Oct); then revert the commit and republish.
