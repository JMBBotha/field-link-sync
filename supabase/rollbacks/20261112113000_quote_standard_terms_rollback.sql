-- Rollback for 20261112113000_quote_standard_terms.
-- Restores the 28 Oct guard. Does not wipe terms_text already stored on quotes.

CREATE OR REPLACE FUNCTION public.fl_quote_terms_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.terms_text := NULL; NEW.relocation_clause := NULL;
  ELSIF NEW.terms_text IS DISTINCT FROM OLD.terms_text OR NEW.relocation_clause IS DISTINCT FROM OLD.relocation_clause THEN
    RAISE EXCEPTION 'Terms and conditions are company-wide and can only be changed by an admin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS public.fl_standard_terms_for_company(uuid);
ALTER TABLE public.company_terms DROP COLUMN IF EXISTS standard_text;
