-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION
-- Undo for 20261116190000_expected_pay_dates.sql.
-- Drops the expected-date settings only. Invoices and payments are not changed.
-- If the preview seed was applied, those project rows go away with the table.

DROP FUNCTION IF EXISTS public.walda_read_expected_money(date);
DROP FUNCTION IF EXISTS public.save_pay_expect_invoice(uuid, text, date);
DROP FUNCTION IF EXISTS public.save_pay_expect_project(uuid, boolean, text, text, int, int, int, int, int);
DROP FUNCTION IF EXISTS public.save_pay_expect_defaults(uuid, int, int, int, int, int, int);
DROP FUNCTION IF EXISTS public._pay_expect_admin(uuid);
DROP FUNCTION IF EXISTS public._pay_expect_project_for(uuid, uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public._pay_expect_deposit_pct(jsonb, numeric);
DROP FUNCTION IF EXISTS public._pay_expect_on(date, text, int, int, int);
DROP FUNCTION IF EXISTS public._pay_expect_names_house(text, text);
DROP FUNCTION IF EXISTS public._pay_expect_day_text(date);

DROP TRIGGER IF EXISTS pay_expect_invoice_guard_t ON public.pay_expect_invoice;
DROP TRIGGER IF EXISTS pay_expect_project_guard_t ON public.pay_expect_project;
DROP FUNCTION IF EXISTS public.pay_expect_invoice_guard();
DROP FUNCTION IF EXISTS public.pay_expect_project_guard();

DROP TABLE IF EXISTS public.pay_expect_invoice;
DROP TABLE IF EXISTS public.pay_expect_project;
DROP TABLE IF EXISTS public.pay_expect_defaults;
