-- Massair CT only (361bf031): settings (flag OFF), FNB account, overheads, AVEC assumed dates. Idempotent.
DO $$
DECLARE c uuid := '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
BEGIN
  PERFORM public._cf_sync_core(c);
  UPDATE public.cf_settings SET enabled = false, vat_number = '4630313080', vat_basis = 'invoice', vat_period_months = 2,
    vat_period_end = coalesce(vat_period_end, DATE '2026-10-31'), vat_due_day = 25 WHERE company_id = c;
  INSERT INTO public.cf_bank_accounts (company_id, label, account_ref, sort)
    SELECT c, 'FNB Business', '…563591', 0 WHERE NOT EXISTS (SELECT 1 FROM public.cf_bank_accounts WHERE company_id = c);
  IF NOT EXISTS (SELECT 1 FROM public.cf_overheads WHERE company_id = c) THEN
    INSERT INTO public.cf_overheads (company_id, name, category, amount, frequency, pay_day, sort, note) VALUES
      (c, 'Wages', 'salaries', 6500, 'weekly', 5, 1, 'About R6,500 a week, paid Fridays – confirm'),
      (c, 'Petrol', 'vehicle', 1000, 'weekly', 1, 2, 'Average per week'),
      (c, 'Rent', 'rent', 4500, 'monthly', 1, 3, NULL),
      (c, 'Owner''s salary', 'salaries', 35000, 'monthly', 25, 4, NULL);
  END IF;
  -- AVEC (Cape Estates) 50% deposits, staggered installs: 4 houses finish in Oct, 3 in Nov, then 3 + 3. All editable.
  UPDATE public.cf_receipts r SET expected_date = d.dt, dates_edited = true, note = 'Assumed date (AVEC stagger) – change when you know'
  FROM (VALUES
    ('0010004','deposit',DATE '2026-10-26'),('0010005','deposit',DATE '2026-10-26'),('0010006','deposit',DATE '2026-10-26'),('0010007','deposit',DATE '2026-10-26'),
    ('0010004','final',DATE '2026-11-06'),('0010005','final',DATE '2026-11-06'),('0010006','final',DATE '2026-11-06'),('0010007','final',DATE '2026-11-06'),
    ('0010008','deposit',DATE '2026-11-09'),('0010009','deposit',DATE '2026-11-09'),('0010010','deposit',DATE '2026-11-09'),
    ('0010008','final',DATE '2026-12-04'),('0010009','final',DATE '2026-12-04'),('0010010','final',DATE '2026-12-04'),
    ('0010011','deposit',DATE '2026-12-07'),('0010012','deposit',DATE '2026-12-07'),('0010013','deposit',DATE '2026-12-07'),
    ('0010011','final',DATE '2027-01-15'),('0010012','final',DATE '2027-01-15'),('0010013','final',DATE '2027-01-15'),
    ('0010014','deposit',DATE '2027-01-11'),('0010015','deposit',DATE '2027-01-11'),('0010016','deposit',DATE '2027-01-11'),
    ('0010014','final',DATE '2027-02-19'),('0010015','final',DATE '2027-02-19'),('0010016','final',DATE '2027-02-19')
  ) AS d(ref, part, dt)
  WHERE r.company_id = c AND r.source = 'field_lynk' AND r.ref = d.ref AND r.part = d.part AND NOT r.dates_edited;
  -- re-sync so unit order (pay-on-order) dates follow the deposit dates
  PERFORM public._cf_sync_core(c);
END $$;
