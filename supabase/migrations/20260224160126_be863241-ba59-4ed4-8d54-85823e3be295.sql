
-- Make quote_number nullable (it may already be, but ensure it)
ALTER TABLE public.quotes ALTER COLUMN quote_number DROP NOT NULL;
ALTER TABLE public.quotes ALTER COLUMN quote_number DROP DEFAULT;

-- Create trigger function: auto-assign quote_number when customer_id goes from NULL to a value
CREATE OR REPLACE FUNCTION public.auto_assign_quote_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only fire when customer_id changes from NULL to non-NULL and quote_number is still NULL
  IF OLD.customer_id IS NULL 
     AND NEW.customer_id IS NOT NULL 
     AND (NEW.quote_number IS NULL OR NEW.quote_number = '') THEN
    NEW.quote_number := generate_quote_number();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on quotes table
DROP TRIGGER IF EXISTS trg_auto_assign_quote_number ON public.quotes;
CREATE TRIGGER trg_auto_assign_quote_number
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_quote_number();
