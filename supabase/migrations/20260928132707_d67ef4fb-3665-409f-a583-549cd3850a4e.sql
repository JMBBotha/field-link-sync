ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS labour_cost_per_hour numeric NULL,
  ADD COLUMN IF NOT EXISTS gp_target_percent numeric NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS sales_commission_percent numeric NOT NULL DEFAULT 40;