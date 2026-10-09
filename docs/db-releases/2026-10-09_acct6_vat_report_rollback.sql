-- acct6 rollback (the old v_vat_summary view was never changed).
DROP FUNCTION IF EXISTS public.vat_report_lines(date, date);
