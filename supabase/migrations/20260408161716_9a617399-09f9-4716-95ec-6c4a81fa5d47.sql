-- Add status column to companies
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

-- Add validation trigger
CREATE OR REPLACE FUNCTION public.validate_company_status()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('active', 'on_hold', 'archived') THEN
    RAISE EXCEPTION 'Invalid company status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_company_status
BEFORE INSERT OR UPDATE ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.validate_company_status();