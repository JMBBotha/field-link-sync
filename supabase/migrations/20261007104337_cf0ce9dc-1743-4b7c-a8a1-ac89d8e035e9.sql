CREATE TABLE IF NOT EXISTS public.supplier_specials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid,
  model_number text NOT NULL,
  supplier_product_id uuid NULL REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  special_cost numeric NOT NULL CHECK (special_cost >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  specials_pdf_path text NULL,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supplier_specials_dates CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS supplier_specials_model_lower_idx ON public.supplier_specials (lower(model_number));
CREATE INDEX IF NOT EXISTS supplier_specials_dates_idx ON public.supplier_specials (start_date, end_date);
CREATE INDEX IF NOT EXISTS supplier_specials_product_idx ON public.supplier_specials (supplier_product_id);

GRANT SELECT, INSERT, UPDATE ON public.supplier_specials TO authenticated;
GRANT ALL ON public.supplier_specials TO service_role;
ALTER TABLE public.supplier_specials ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_read_specials(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND public.can_read_master_catalog(_uid) AND NOT public.is_field_tech_only(_uid)
$$;
CREATE OR REPLACE FUNCTION public.can_write_specials(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.can_read_specials(_uid)
     AND (public.has_role(_uid, 'admin'::app_role) OR public.is_office_staff(_uid))
     AND NOT public.is_sales_rep(_uid)
$$;

CREATE POLICY "specials_read" ON public.supplier_specials FOR SELECT TO authenticated
  USING (public.can_read_specials(auth.uid()));
CREATE POLICY "specials_insert" ON public.supplier_specials FOR INSERT TO authenticated
  WITH CHECK (public.can_write_specials(auth.uid()));
CREATE POLICY "specials_update" ON public.supplier_specials FOR UPDATE TO authenticated
  USING (public.can_write_specials(auth.uid())) WITH CHECK (public.can_write_specials(auth.uid()));

CREATE TRIGGER supplier_specials_updated_at BEFORE UPDATE ON public.supplier_specials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "specials_pdfs_read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'specials-pdfs' AND public.can_read_specials(auth.uid()));
CREATE POLICY "specials_pdfs_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'specials-pdfs' AND public.can_write_specials(auth.uid()));