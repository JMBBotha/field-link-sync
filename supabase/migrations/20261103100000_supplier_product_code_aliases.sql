-- Supplier / superseded codes per catalogue item, used by Receive stock to match delivery notes and invoices
-- when a supplier ships a revised machine under a new code (same model name). Data, not code: no deploy per code change.
CREATE TABLE IF NOT EXISTS public.supplier_product_code_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.supplier_products(id) ON DELETE CASCADE,
  supplier_code text NOT NULL,                       -- as printed by the supplier, e.g. indoor or outdoor half code
  half text CHECK (half IN ('indoor','outdoor')),    -- null for single-piece items
  supplier_name text,
  kind text NOT NULL DEFAULT 'alias' CHECK (kind IN ('alias','superseded')),
  note text,
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  added_by uuid DEFAULT auth.uid()
);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_product_code_aliases_uq
  ON public.supplier_product_code_aliases (company_id, upper(regexp_replace(supplier_code, '[\s_/.-]+', '', 'g')));
CREATE INDEX IF NOT EXISTS supplier_product_code_aliases_product ON public.supplier_product_code_aliases (product_id);
ALTER TABLE public.supplier_product_code_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spca_office_all ON public.supplier_product_code_aliases;
CREATE POLICY spca_office_all ON public.supplier_product_code_aliases FOR ALL TO authenticated
  USING (public.sjd_ok(company_id)) WITH CHECK (public.sjd_ok(company_id));
