# Accepted quote -> approve deposit invoice (Step 2, NOT live)

On accept: draft deposit invoice (unchanged) + one in-app alert "<Client> accepted Q-xxxx" to the quote's rep and that company's admins (admins only if no rep), with Send invoice now / Edit / Hold.
If nobody acts, cron `invoice-send-approvals` (every minute) sends the invoice (existing email incl. "deposit due") after `company_settings.invoice_auto_send_minutes` (default 15, 0 = never).
Hold stops auto-send until someone sends manually. Edit = hold ("Opened to edit") + open invoice. Every action is logged in `invoice_send_events`.

- Migration: drizzle/migrations/0025_accept_invoice_approval.sql (idempotent)
- Rollback: drizzle/rollback/0025_accept_invoice_approval_rollback.sql (+ delete the 0025 row from drizzle.__drizzle_migrations)
- DB proof (local Postgres 17, stubbed Supabase, no network): scripts/db-tests/0025/run.sh
- UI tests: src/test/invoiceSendApproval.test.tsx

Deploy (only after Johan approves): apply 0025 to Massair CT, insert drizzle row (sha256 of file, when from journal), verify read-only, test on a TEST quote with a test client email only.
