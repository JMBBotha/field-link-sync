-- Impersonation tests (each in a transaction that is rolled back). Returns one JSON row.
DO $t$ DECLARE r jsonb := '{}'; v_tech uuid; v_sales uuid; c int; b boolean;
BEGIN
  SELECT ur.user_id INTO v_tech FROM user_roles ur JOIN profiles p ON p.id=ur.user_id
   WHERE ur.role='field_agent' AND p.company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND public.is_field_tech_only(ur.user_id) LIMIT 1;
  PERFORM set_config('role','authenticated',true);
  -- Massair admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub','1e795a9b-f8bd-4af5-8f28-5e0426101daa','role','authenticated')::text, true);
  SELECT public.is_platform_owner() INTO b; r := r || jsonb_build_object('massair_admin_platform', b);
  SELECT count(*) INTO c FROM leads WHERE status='pending' AND assigned_agent_id IS NULL AND deleted_at IS NULL; r := r || jsonb_build_object('admin_unassigned_pending', c);
  -- Partner admin (AB Refrigeration)
  PERFORM set_config('request.jwt.claims', json_build_object('sub','420c7731-e8a4-4355-80ca-51c684b42a2c','role','authenticated')::text, true);
  SELECT public.is_platform_owner() INTO b; r := r || jsonb_build_object('partner_admin_platform', b);
  SELECT count(*) INTO c FROM companies; r := r || jsonb_build_object('partner_companies_visible', c);
  -- Tech
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_tech,'role','authenticated')::text, true);
  SELECT public.is_platform_owner() INTO b; r := r || jsonb_build_object('tech_platform', b);
  SELECT count(*) INTO c FROM leads WHERE status='pending' AND assigned_agent_id IS NULL AND deleted_at IS NULL; r := r || jsonb_build_object('tech_unassigned_pending', c);
  SELECT count(*) INTO c FROM leads WHERE status='pending' AND assigned_agent_id IS NULL AND deleted_at IS NULL AND (primary_intent='sales' OR service_type ~* 'sales|consult|quote|install'); r := r || jsonb_build_object('tech_sees_sales_leads', c);
  RAISE EXCEPTION 'RESULT %', r;
END $t$;
