-- Security gaps release (2026-09-29). Additive + one policy swap + companies column grants. No data changes.

CREATE OR REPLACE FUNCTION public.is_office_staff(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = _uid AND ur.role IN ('dispatcher','platform_super_admin','platform_ops'))
     AND NOT EXISTS (SELECT 1 FROM public.profiles p
                     WHERE p.id = _uid AND p.dispatch_role IN ('sales','sales_engineer'));
$$;

DROP POLICY IF EXISTS "Users can view their quote items" ON public.quote_items;
CREATE POLICY "Scoped read of quote items" ON public.quote_items
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.quotes q
                 WHERE q.id = quote_items.quote_id
                   AND (public.has_role(auth.uid(), 'admin'::app_role)
                        OR q.sales_engineer_id = auth.uid()
                        OR q.owner_id = auth.uid()
                        OR q.created_by = auth.uid()
                        OR (q.company_id = public.get_user_company_id(auth.uid()) AND public.is_office_staff(auth.uid())))));

CREATE OR REPLACE FUNCTION public.fill_used_part_cost()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.product_id IS NOT NULL AND (NEW.unit_cost IS NULL OR NEW.unit_cost = 0) THEN
    SELECT sp.cost_price INTO NEW.unit_cost FROM public.supplier_products sp WHERE sp.id = NEW.product_id;
  END IF;
  NEW.unit_cost := COALESCE(NEW.unit_cost, 0);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_fill_used_part_cost ON public.job_used_parts;
CREATE TRIGGER trg_fill_used_part_cost BEFORE INSERT ON public.job_used_parts
  FOR EACH ROW EXECUTE FUNCTION public.fill_used_part_cost();

CREATE OR REPLACE FUNCTION public.get_product_sell_options()
RETURNS TABLE(id uuid, product_code text, short_name text, description text, category text, is_pinned boolean, sell_excl_vat numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH p AS (
    SELECT sp.id, sp.product_code, sp.short_name, sp.description, sp.category, sp.is_pinned, sp.cost_price,
           CASE WHEN sp.default_markup_percent IS NOT NULL AND sp.default_markup_percent <> 0 THEN sp.default_markup_percent
                WHEN sp.markup_percent IS NOT NULL AND sp.markup_percent <> 0 THEN sp.markup_percent
                ELSE NULL END AS raw_mk
    FROM public.supplier_products sp
    WHERE sp.is_active = true AND auth.uid() IS NOT NULL AND public.can_read_master_catalog(auth.uid())
  ), m AS (
    SELECT p.*, LEAST(GREATEST(CASE WHEN raw_mk IS NULL THEN 35
                                    WHEN raw_mk > 0 AND raw_mk <= 1 THEN round(raw_mk * 100, 2)
                                    WHEN raw_mk <= 0 THEN 35
                                    ELSE raw_mk END, -50), 500) AS mk
    FROM p
  )
  SELECT m.id, m.product_code, m.short_name, m.description, m.category, COALESCE(m.is_pinned, false),
         round(LEAST(GREATEST(COALESCE(m.cost_price, 0), 0), 10000000) * (1 + m.mk / 100), 2)
  FROM m
  ORDER BY COALESCE(m.is_pinned, false) DESC, m.description;
$$;

CREATE OR REPLACE FUNCTION public.get_field_deposit_chips(p_lead_ids uuid[])
RETURNS TABLE(lead_id uuid, invoice_id uuid, chip_state text, remaining numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT l.id, inv.id,
         CASE WHEN COALESCE(inv.grand_total, 0) > 0 AND GREATEST(COALESCE(inv.grand_total, 0) - paid.amt, 0) <= 0 THEN 'paid'
              WHEN paid.amt > 0 AND GREATEST(COALESCE(inv.grand_total, 0) - paid.amt, 0) > 0 THEN 'partial'
              ELSE 'due' END,
         GREATEST(COALESCE(inv.grand_total, 0) - paid.amt, 0)
  FROM unnest(COALESCE(p_lead_ids, '{}'::uuid[])) AS x(id)
  JOIN public.leads l ON l.id = x.id
  JOIN LATERAL (
    SELECT i.id, i.grand_total
    FROM public.jobs jb
    JOIN public.invoices i ON (i.id = jb.invoice_id OR (jb.invoice_id IS NULL AND jb.quote_id IS NOT NULL AND i.quote_id = jb.quote_id))
    WHERE jb.lead_id = l.id AND jb.job_type = 'installation'
    ORDER BY (jb.invoice_id IS NOT NULL) DESC, i.created_at ASC
    LIMIT 1
  ) inv ON TRUE
  CROSS JOIN LATERAL (SELECT public.invoice_amount_paid(inv.id) AS amt) paid
  WHERE auth.uid() IS NOT NULL
    AND (public.is_ops_user(auth.uid())
         OR l.assigned_agent_id = auth.uid()
         OR EXISTS (SELECT 1 FROM public.jobs j2 JOIN public.assignments a ON a.job_id = j2.id
                    WHERE j2.lead_id = l.id AND a.profile_id = auth.uid()))
    AND (l.company_id IS NULL OR l.company_id = public.get_user_company_id(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role));
$$;

REVOKE SELECT ON public.companies FROM authenticated;
REVOKE SELECT ON public.companies FROM anon;
GRANT SELECT (id, name, logo_url, created_at, slug, onboarding_completed, services, default_rate, vat_rate, updated_at, status,
              units_markup_percent, materials_markup_percent, is_master, custom_service_limit) ON public.companies TO authenticated;

CREATE OR REPLACE FUNCTION public.get_company_margin_settings(p_company_id uuid)
RETURNS TABLE(company_id uuid, labour_cost_per_hour numeric, gp_target_percent numeric, sales_commission_percent numeric, labour_tech_share_percent numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT c.id, c.labour_cost_per_hour, c.gp_target_percent, c.sales_commission_percent, c.labour_tech_share_percent
  FROM public.companies c
  WHERE c.id = p_company_id
    AND auth.uid() IS NOT NULL
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_company_admin(auth.uid(), c.id));
$$;

REVOKE ALL ON FUNCTION public.get_company_margin_settings(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.get_product_sell_options() FROM anon, public;
REVOKE ALL ON FUNCTION public.get_field_deposit_chips(uuid[]) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_company_margin_settings(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_product_sell_options() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_field_deposit_chips(uuid[]) TO authenticated;