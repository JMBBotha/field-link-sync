
-- Add public_token and accepted_signature to quotes
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS public_token uuid DEFAULT gen_random_uuid();
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS accepted_signature jsonb;

-- Create unique index on public_token
CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_public_token ON public.quotes(public_token);

-- Allow anonymous/public access to quotes via public_token (read-only)
CREATE POLICY "Public can view quotes by token"
ON public.quotes
FOR SELECT
USING (public_token IS NOT NULL);

-- Allow public updates for acceptance via token (only status + signature fields)
CREATE POLICY "Public can accept quotes by token"
ON public.quotes
FOR UPDATE
USING (public_token IS NOT NULL)
WITH CHECK (public_token IS NOT NULL);

-- Allow public to view quote line items for public quotes
CREATE POLICY "Public can view quote line items by token"
ON public.quote_line_items
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.quotes q
  WHERE q.id = quote_line_items.quote_id
  AND q.public_token IS NOT NULL
));

-- Allow public to view proposal sections for public quotes
CREATE POLICY "Public can view proposal sections by token"
ON public.proposal_sections
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.quotes q
  WHERE q.id = proposal_sections.quote_id
  AND q.public_token IS NOT NULL
));

-- RPC to validate and fetch quote by public token
CREATE OR REPLACE FUNCTION public.get_quote_by_public_token(p_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT id INTO v_quote_id
  FROM public.quotes
  WHERE public_token = p_token;

  IF v_quote_id IS NOT NULL THEN
    -- Update viewed_at if not already set
    UPDATE public.quotes
    SET viewed_at = COALESCE(viewed_at, now()),
        status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
    WHERE id = v_quote_id AND viewed_at IS NULL;
  END IF;

  RETURN v_quote_id;
END;
$$;

-- RPC to accept quote via public token
CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT id INTO v_quote_id
  FROM public.quotes
  WHERE public_token = p_token
  AND status IN ('sent', 'viewed', 'draft');

  IF v_quote_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.quotes
  SET status = 'accepted',
      accepted_at = now(),
      accepted_by = p_accepted_by,
      accepted_signature = p_signature
  WHERE id = v_quote_id;

  RETURN true;
END;
$$;

-- RPC to decline quote via public token
CREATE OR REPLACE FUNCTION public.decline_quote_by_token(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quote_id uuid;
BEGIN
  SELECT id INTO v_quote_id
  FROM public.quotes
  WHERE public_token = p_token
  AND status IN ('sent', 'viewed', 'draft');

  IF v_quote_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.quotes
  SET status = 'declined',
      declined_at = now()
  WHERE id = v_quote_id;

  RETURN true;
END;
$$;
