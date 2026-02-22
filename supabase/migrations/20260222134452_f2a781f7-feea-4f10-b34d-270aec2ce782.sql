-- Add company isolation RLS to company_invoices using existing is_company_member function
-- First drop the permissive public policies that were copied from fb_invoices
DROP POLICY IF EXISTS "public_insert" ON public.company_invoices;
DROP POLICY IF EXISTS "public_read" ON public.company_invoices;

-- Ensure RLS is enabled
ALTER TABLE public.company_invoices ENABLE ROW LEVEL SECURITY;

-- Company member isolation (replaces broad public policies)
CREATE POLICY "company_isolation_invoices"
  ON public.company_invoices FOR ALL
  USING (is_company_member(auth.uid(), company_id))
  WITH CHECK (is_company_member(auth.uid(), company_id));

-- Customer portal read access via customer_tokens (no auth_user_id needed)
CREATE POLICY "customer_read_invoices"
  ON public.company_invoices FOR SELECT
  USING (
    customer_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.customer_tokens ct
      WHERE ct.customer_id = company_invoices.customer_id
        AND (ct.expires_at IS NULL OR ct.expires_at > now())
    )
  );