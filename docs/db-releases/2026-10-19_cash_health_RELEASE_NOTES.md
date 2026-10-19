# Cash-flow health – phase 1 (19 Oct 2026, SAST)

Johan's request via WALDA (07:42 + 07:47 update). Hidden: `cf_settings.enabled = false` until Johan approves screenshots.

## What's in it
- Route `/admin/cash-health` (admin role, never sales reps; server rule `_cf_ok` = owner/management of that company; techs/reps never see costs). When the flag is off it redirects to `/admin/cashflow`, and the "Cash-flow health" link (More → Money) is hidden.
- Tabs: Overview (health light, bank balance entry, lowest point, cash after 13 weeks + runway, 13-week expected vs cautious chart, alerts, money in vs out bars, VAT panel, overheads, week-by-week table), Money in, Projects, Stock (stock-take), Settings (bank accounts, overheads, VAT, forecast rules).
- Tables (all company-scoped, RLS `_cf_ok`): `cf_settings`, `cf_bank_accounts`, `cf_bank_balances`, `cf_overheads`, `cf_receipts`, `cf_commitments`, `cf_stock_items`, `cf_stock_allocations` (writes only via RPC).
- RPCs: `cf_sync` (invoices → deposit/final parts, POs or invoice unit lines → commitments at list × 0.80, accepted-not-invoiced quotes, completed jobs → installed), `cf_allocate_stock`, `cf_unallocate_stock`, `cf_stock_take`, `cf_vat_actuals`. Trigger draws allocated stock down when a line is marked installed.
- User edits to dates / confidence / cost / pay date stick; sync never overwrites them.
- Never stored or shown: any supplier discount beyond list × 0.80.

## Massair CT seed (docs/db-releases/2026-10-19_cash_health_massair_seed.sql)
FNB Business …563591 (no balance), overheads (wages R6,500/wk Fri, petrol R1,000/wk, rent R4,500 on the 1st, owner's salary R35,000 on the 25th), VAT 4630313080 invoice basis, 2-monthly, period ending 31 Oct, due 25th. AVEC 0010004–0010016 assumed dates: deposits 26 Oct (0004–0007), 9 Nov (0008–0010), 7 Dec (0011–0013), 11 Jan (0014–0016); finals 6 Nov, 4 Dec, 15 Jan, 19 Feb.

## Switch on (after Johan approves)
`UPDATE public.cf_settings SET enabled = true WHERE company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';`  (browser users cannot change `enabled`; trigger `_cf_settings_guard`).

## Rollback
Switch off: same UPDATE with `false`. Full: `git revert <commit>` + `docs/db-releases/2026-10-19_cash_health_rollback.sql` (drops only cf_* objects).
