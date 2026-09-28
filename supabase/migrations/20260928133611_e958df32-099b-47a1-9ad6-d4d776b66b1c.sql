ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;
UPDATE public.companies SET is_master = (id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd');
UPDATE public.companies SET units_markup_percent = 25 WHERE id = 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd' AND units_markup_percent IS NULL;

CREATE TABLE public.company_network_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  member_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  UNIQUE (master_company_id, member_company_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_network_members TO authenticated;
GRANT ALL ON public.company_network_members TO service_role;
ALTER TABLE public.company_network_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_master_company_user(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = public.get_user_company_id(_uid) AND c.is_master)
$$;
CREATE OR REPLACE FUNCTION public.is_approved_network_member(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.company_network_members m JOIN public.companies c ON c.id = m.master_company_id AND c.is_master
    WHERE m.member_company_id = public.get_user_company_id(_uid) AND m.status = 'approved')
$$;
CREATE OR REPLACE FUNCTION public.can_read_master_catalog(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master_company_user(_uid) OR public.is_approved_network_member(_uid)
$$;
CREATE OR REPLACE FUNCTION public.can_write_master_catalog(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_master_company_user(_uid) AND public.has_role(_uid, 'admin'::app_role)
$$;

CREATE TRIGGER company_network_members_touch BEFORE UPDATE ON public.company_network_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Master admins manage network" ON public.company_network_members FOR ALL TO authenticated
  USING (public.can_write_master_catalog(auth.uid())) WITH CHECK (public.can_write_master_catalog(auth.uid()));
CREATE POLICY "Members see own membership" ON public.company_network_members FOR SELECT TO authenticated
  USING (member_company_id = public.get_user_company_id(auth.uid()));

-- Catalogue tables: drop open/any-admin policies, replace with master catalogue rules
DROP POLICY IF EXISTS "Admins can manage brand discounts" ON public.brand_discounts;
DROP POLICY IF EXISTS "Authenticated users can view brand discounts" ON public.brand_discounts;
DROP POLICY IF EXISTS "Authenticated users can create bundle items" ON public.bundle_items;
DROP POLICY IF EXISTS "Authenticated users can delete bundle items" ON public.bundle_items;
DROP POLICY IF EXISTS "Authenticated users can update bundle items" ON public.bundle_items;
DROP POLICY IF EXISTS "Authenticated users can view bundle items" ON public.bundle_items;
DROP POLICY IF EXISTS "Authenticated users can delete dismissed regions" ON public.dismissed_pdf_regions;
DROP POLICY IF EXISTS "Authenticated users can insert dismissed regions" ON public.dismissed_pdf_regions;
DROP POLICY IF EXISTS "Authenticated users can view dismissed regions" ON public.dismissed_pdf_regions;
DROP POLICY IF EXISTS "Authenticated users can create bundles" ON public.installation_bundles;
DROP POLICY IF EXISTS "Authenticated users can delete bundles" ON public.installation_bundles;
DROP POLICY IF EXISTS "Authenticated users can update bundles" ON public.installation_bundles;
DROP POLICY IF EXISTS "Authenticated users can view bundles" ON public.installation_bundles;
DROP POLICY IF EXISTS "Admins can create inventory items" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can delete inventory items" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can update inventory items" ON public.inventory_items;
DROP POLICY IF EXISTS "Authenticated users can view inventory" ON public.inventory_items;
DROP POLICY IF EXISTS "Admins can manage pdf regions" ON public.pdf_product_regions;
DROP POLICY IF EXISTS "Authenticated users can view pdf regions" ON public.pdf_product_regions;
DROP POLICY IF EXISTS "Admins can manage pdf_uploads" ON public.pdf_uploads;
DROP POLICY IF EXISTS "Authenticated users can view pdf_uploads" ON public.pdf_uploads;
DROP POLICY IF EXISTS "Admins can manage uploads" ON public.price_list_uploads;
DROP POLICY IF EXISTS "Admins can manage brochures" ON public.product_brochures;
DROP POLICY IF EXISTS "Anyone authenticated can view active brochures" ON public.product_brochures;
DROP POLICY IF EXISTS "Admins can manage pdf pages" ON public.supplier_pdf_pages;
DROP POLICY IF EXISTS "Authenticated users can view pdf pages" ON public.supplier_pdf_pages;
DROP POLICY IF EXISTS "Admins can manage supplier products" ON public.supplier_products;
DROP POLICY IF EXISTS "Authenticated users can view supplier products" ON public.supplier_products;
DROP POLICY IF EXISTS "Admins can manage suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Authenticated users can view suppliers" ON public.suppliers;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['brand_discounts','bundle_items','dismissed_pdf_regions','installation_bundles','inventory_items','pdf_product_regions','pdf_uploads','price_list_uploads','product_brochures','supplier_pdf_pages','supplier_products','suppliers']
  LOOP
    EXECUTE format('CREATE POLICY "Master catalogue read" ON public.%I FOR SELECT TO authenticated USING (public.can_read_master_catalog(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Master catalogue insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write_master_catalog(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Master catalogue update" ON public.%I FOR UPDATE TO authenticated USING (public.can_write_master_catalog(auth.uid())) WITH CHECK (public.can_write_master_catalog(auth.uid()))', t);
    EXECUTE format('CREATE POLICY "Master catalogue delete" ON public.%I FOR DELETE TO authenticated USING (public.can_write_master_catalog(auth.uid()))', t);
  END LOOP;
END $$;

-- Storage: catalogue buckets
DROP POLICY IF EXISTS "Authenticated users can upload pdf pages" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete pdf pages" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update pdf page files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload supplier pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read supplier pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update supplier pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete supplier pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to supplier-pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads from supplier-pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from supplier-pdfs" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload pdf page temps" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete pdf page temps" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete product brochures" ON storage.objects;
DROP POLICY IF EXISTS "Signed-in users can list public assets" ON storage.objects;

CREATE POLICY "Signed-in users can list public assets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['company-logos','product-images','quote-photos']));
CREATE POLICY "Master catalogue files read" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = ANY (ARRAY['supplier-pdfs','supplier-pdf-pages','product-brochures','pdfs','pdf-page-temps']) AND public.can_read_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue files insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = ANY (ARRAY['supplier-pdfs','supplier-pdf-pages','product-brochures','pdfs','pdf-page-temps']) AND public.can_write_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue files update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = ANY (ARRAY['supplier-pdfs','supplier-pdf-pages','product-brochures','pdfs','pdf-page-temps']) AND public.can_write_master_catalog(auth.uid()));
CREATE POLICY "Master catalogue files delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = ANY (ARRAY['supplier-pdfs','supplier-pdf-pages','product-brochures','pdfs','pdf-page-temps']) AND public.can_write_master_catalog(auth.uid()));