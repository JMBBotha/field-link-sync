-- Enforce customer association on NEW/UPDATED quotes only.
-- Existing 152 orphan rows are preserved (no NOT NULL on the column).
-- FK quotes.customer_id -> customers(id) already exists.

CREATE OR REPLACE FUNCTION public.enforce_quote_customer_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN
    RAISE EXCEPTION 'A client must be associated with the quote before saving (quotes.customer_id cannot be NULL).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_quote_customer_id_trigger ON public.quotes;

CREATE TRIGGER enforce_quote_customer_id_trigger
BEFORE INSERT OR UPDATE OF customer_id ON public.quotes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quote_customer_id();