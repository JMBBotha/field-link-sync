-- Name a salesperson on a sales lead. No visit time.
-- Not applied to the live database by this PR.
-- Caller must be office (admin or non-sales dispatcher) in the lead's company.
-- Target must be an active same-company sales-lane profile.
-- A plain UPDATE so enforce_company_writable and the lead triggers still run.
-- The log row is inserted first; trg_z_lead_assign_log then sees it and does not write a second row.

CREATE OR REPLACE FUNCTION public.assign_sales_lead(p_lead_id uuid, p_rep_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  l public.leads%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 401, 'message', 'Sign in first');
  END IF;

  SELECT * INTO l
    FROM public.leads
   WHERE id = p_lead_id
     AND deleted_at IS NULL
     AND merged_into_id IS NULL
   FOR UPDATE;
  IF l.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 404, 'message', 'Lead not found');
  END IF;

  -- Admin or office dispatcher in this company. Sales reps are not office (_lead_office).
  IF NOT public._lead_office(v_uid, l.company_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'Only an admin or dispatcher in this company can assign a sales lead');
  END IF;

  IF l.primary_intent IS DISTINCT FROM 'sales' THEN
    RETURN jsonb_build_object('ok', false, 'code', 409, 'message', 'Only sales leads are assigned to a salesperson here');
  END IF;

  IF p_rep_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.profiles p
     WHERE p.id = p_rep_id
       AND p.company_id = l.company_id
       AND p.archived_at IS NULL
       AND p.dispatch_active IS TRUE
       AND p.dispatch_role IN ('sales', 'sales_engineer')
       AND COALESCE(p.participant_type, '') <> 'independent_tech'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 403, 'message', 'That person is not an active salesperson in this company');
  END IF;

  IF l.assigned_agent_id IS NOT DISTINCT FROM p_rep_id THEN
    RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'rep_id', p_rep_id, 'unchanged', true);
  END IF;

  INSERT INTO public.lead_assignment_log (
    lead_id, company_id, tech_id, previous_agent_id, assigned_by, by_role
  ) VALUES (
    l.id, l.company_id, p_rep_id, l.assigned_agent_id, v_uid, 'office'
  );

  UPDATE public.leads
     SET assigned_agent_id = p_rep_id,
         assignment_method = 'manual_dispatch'
   WHERE id = l.id;

  RETURN jsonb_build_object('ok', true, 'lead_id', l.id, 'rep_id', p_rep_id);
END;
$$;

COMMENT ON FUNCTION public.assign_sales_lead(uuid, uuid) IS
  'Office assigns or reassigns a sales lead to an active same-company salesperson. No visit time. Logs lead_assignment_log. Does not bypass triggers.';

REVOKE ALL ON FUNCTION public.assign_sales_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_sales_lead(uuid, uuid) TO authenticated;
