CREATE OR REPLACE FUNCTION public.my_company_contract_status(p_company_id uuid)
RETURNS TABLE(name text, plan_status text, contract_signed_at timestamptz, plan_base_price_zar numeric, plan_included_users integer, plan_extra_user_price_zar numeric, plan_contract_months integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.name::text, c.plan_status::text, c.contract_signed_at, c.plan_base_price_zar::numeric, c.plan_included_users::int, c.plan_extra_user_price_zar::numeric, c.plan_contract_months::int
  FROM public.companies c
  WHERE c.id = p_company_id
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.company_id = c.id);
$$;
REVOKE ALL ON FUNCTION public.my_company_contract_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_company_contract_status(uuid) TO authenticated;