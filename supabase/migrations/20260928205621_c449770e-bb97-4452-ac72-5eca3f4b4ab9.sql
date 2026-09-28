ALTER TABLE public.companies
  ALTER COLUMN sales_commission_percent SET DEFAULT 50;

UPDATE public.companies
SET sales_commission_percent = 50
WHERE sales_commission_percent = 40;

ALTER TABLE public.companies
  ADD COLUMN labour_tech_share_percent numeric NOT NULL DEFAULT 60
  CHECK (labour_tech_share_percent >= 0 AND labour_tech_share_percent <= 100);

-- Rollback SQL:
-- ALTER TABLE public.companies ALTER COLUMN sales_commission_percent SET DEFAULT 40;
-- UPDATE public.companies SET sales_commission_percent = 40 WHERE sales_commission_percent = 50;
-- ALTER TABLE public.companies DROP COLUMN labour_tech_share_percent;