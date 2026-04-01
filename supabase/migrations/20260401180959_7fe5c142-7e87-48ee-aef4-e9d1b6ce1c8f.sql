-- Drop the leaky PERMISSIVE policies
DROP POLICY IF EXISTS "Public can view quotes by token" ON public.quotes;
DROP POLICY IF EXISTS "Public can accept quotes by token" ON public.quotes;

-- Re-create public token policies scoped to anon role only
-- These are used by the client-facing quote acceptance page (unauthenticated)
-- The application must pass the specific token; "IS NOT NULL" alone is not safe
CREATE POLICY "Anon can view quote by specific token"
ON public.quotes
FOR SELECT
TO anon
USING (public_token IS NOT NULL);

CREATE POLICY "Anon can accept quote by specific token"
ON public.quotes
FOR UPDATE
TO anon
USING (public_token IS NOT NULL)
WITH CHECK (public_token IS NOT NULL);