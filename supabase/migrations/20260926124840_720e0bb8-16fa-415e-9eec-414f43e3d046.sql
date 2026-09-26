CREATE TABLE public.install_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_btu integer NOT NULL,
  max_btu integer NOT NULL,
  unit_kind text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.install_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.install_templates(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('piping_kit','bracket','trunking_main','trunking_endcap','trunking_small','drain_pipe','drain_bend','cable_interconnect','cable_supply','other')),
  bundle_id uuid REFERENCES public.installation_bundles(id) ON DELETE SET NULL,
  product_code text,
  default_qty numeric NOT NULL DEFAULT 1,
  default_length_m numeric,
  included boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.install_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.install_template_items TO authenticated;
GRANT ALL ON public.install_templates TO service_role;
GRANT ALL ON public.install_template_items TO service_role;
ALTER TABLE public.install_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.install_template_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read install templates" ON public.install_templates FOR SELECT TO authenticated USING (public.is_staff_member(auth.uid()));
CREATE POLICY "Admins manage install templates" ON public.install_templates FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Staff read install template items" ON public.install_template_items FOR SELECT TO authenticated USING (public.is_staff_member(auth.uid()));
CREATE POLICY "Admins manage install template items" ON public.install_template_items FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_install_templates_updated BEFORE UPDATE ON public.install_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_install_template_items_updated BEFORE UPDATE ON public.install_template_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();