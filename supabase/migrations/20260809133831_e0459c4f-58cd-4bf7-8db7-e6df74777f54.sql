-- 1. company_invoices: drop token-existence bypass policy
DROP POLICY IF EXISTS "customer_read_invoices" ON public.company_invoices;

-- 2. quotes / proposal_sections / visual_proposals: remove non-null token bypass policies
DROP POLICY IF EXISTS "Anon can view quote by specific token" ON public.quotes;
DROP POLICY IF EXISTS "Public can view proposal sections by token" ON public.proposal_sections;
DROP POLICY IF EXISTS "Anon can view visual proposal by token" ON public.visual_proposals;
DROP POLICY IF EXISTS "Anon can accept visual proposal by token" ON public.visual_proposals;

-- Secure token-scoped reader for public quote links
CREATE OR REPLACE FUNCTION public.get_public_quote(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE public_token = p_token;
  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'subtotal', v_quote.subtotal,
      'vat_rate', v_quote.vat_rate,
      'vat_amount', v_quote.vat_amount,
      'total', v_quote.total,
      'notes', v_quote.notes,
      'valid_until', v_quote.valid_until,
      'created_at', v_quote.created_at,
      'accepted_by', v_quote.accepted_by
    ),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qi.id,
        'item_name', qi.item_name,
        'description', qi.description,
        'quantity', qi.quantity,
        'unit_price', qi.unit_price,
        'total_price', qi.total_price,
        'sort_order', qi.sort_order
      ) ORDER BY qi.sort_order)
      FROM public.quote_items qi
      WHERE qi.quote_id = v_quote.id AND qi.parent_item_id IS NULL
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'section_type', ps.section_type,
        'title', ps.title,
        'content', ps.content,
        'sort_order', ps.sort_order
      ) ORDER BY ps.sort_order)
      FROM public.proposal_sections ps
      WHERE ps.quote_id = v_quote.id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_quote(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_quote(uuid) TO anon, authenticated;

-- 3. profiles: prevent non-admins from changing their own company_id (tenant escape)
CREATE OR REPLACE FUNCTION public.prevent_company_self_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.has_role(auth.uid(), 'platform_super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only administrators can change a profile company assignment';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_company_self_assignment ON public.profiles;
CREATE TRIGGER trg_prevent_company_self_assignment
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_company_self_assignment();

-- 4. spatial_ref_sys: enable RLS with read-only access (best effort; skip if not owner)
DO $$
BEGIN
  EXECUTE 'ALTER TABLE public.spatial_ref_sys ENABLE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS "spatial_ref_sys readable" ON public.spatial_ref_sys';
  EXECUTE 'CREATE POLICY "spatial_ref_sys readable" ON public.spatial_ref_sys FOR SELECT USING (true)';
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'spatial_ref_sys not owned by migration role; skipped';
END $$;

-- 5. SECURITY DEFINER functions: remove anonymous execute except public link endpoints,
--    and remove signed-in execute for internal/maintenance-only routines.
DO $$
DECLARE
  r record;
  allow_anon text[] := ARRAY[
    'validate_customer_token','get_quote_by_public_token','get_public_quote',
    'accept_quote_by_token','decline_quote_by_token','create_portal_booking'
  ];
  internal_only text[] := ARRAY[
    'backfill_leads_to_customers','generate_maintenance_schedules','mark_overdue_maintenance',
    'update_overdue_invoices','prevent_company_self_assignment'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname, p.prorettype
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname NOT LIKE 'st\_%'
      AND p.proname NOT LIKE '\_st%'
      AND p.proname NOT LIKE 'postgis%'
  LOOP
    IF NOT (r.proname = ANY(allow_anon)) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    END IF;

    IF r.prorettype = 'trigger'::regtype OR r.proname = ANY(internal_only) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', r.sig);
    END IF;
  END LOOP;
END $$;