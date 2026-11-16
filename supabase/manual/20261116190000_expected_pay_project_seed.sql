-- MANUAL SEED - DO NOT RUN AGAINST THE LIVE DATABASE FROM THE PREVIEW PR.
-- Preview data only. It writes pay_expect_project rows and nothing else.
-- It does not change invoices, payments, houses, or draft invoices.
--
-- Stellenbosch Village (Cape Estates, b00dc016-822d-411f-bf72-26a05537018f):
-- the 15th of the month after the invoice. Invoices go in on the 15th and are due on the 15th of the next month.
--
-- AVEC: the last day of the invoice's own month (offset 0).
-- Johan still has to confirm that offset before this seed is applied.

INSERT INTO public.pay_expect_project (project_id, company_id, timing, date_mode, day_of_month, month_offset)
SELECT p.id, p.company_id, 'project', 'day_of_month', 15, 1
FROM public.projects p
WHERE p.id = 'b00dc016-822d-411f-bf72-26a05537018f'
ON CONFLICT (project_id) DO UPDATE SET
  timing = EXCLUDED.timing,
  date_mode = EXCLUDED.date_mode,
  day_of_month = EXCLUDED.day_of_month,
  month_offset = EXCLUDED.month_offset,
  updated_at = now();

WITH avec AS (
  SELECT p.id, p.company_id
  FROM public.projects p
  WHERE p.company_id = (
    SELECT s.company_id FROM public.projects s WHERE s.id = 'b00dc016-822d-411f-bf72-26a05537018f'
  )
    AND (
      upper(btrim(coalesce(p.code, ''))) = 'AVEC'
      OR upper(btrim(p.name)) = 'AVEC'
      OR upper(btrim(p.name)) LIKE 'AVEC %'
    )
)
INSERT INTO public.pay_expect_project (project_id, company_id, timing, date_mode, month_offset)
SELECT id, company_id, 'project', 'month_end', 0
FROM avec
WHERE (SELECT count(*) FROM avec) = 1
ON CONFLICT (project_id) DO UPDATE SET
  timing = EXCLUDED.timing,
  date_mode = EXCLUDED.date_mode,
  month_offset = EXCLUDED.month_offset,
  updated_at = now();
