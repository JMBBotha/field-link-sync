-- Tech job sheet packing list (2026-09-30). Rollback: DROP FUNCTION public.get_job_packing_list(uuid);
-- Who: the tech assigned to the job, or an admin/dispatcher (office) of the job's company. Everyone else: error 42501.
-- What: name, code, quantity and area only (no price/cost fields). Piping kits are expanded from metadata.kit.items.
CREATE OR REPLACE FUNCTION public.get_job_packing_list(p_job_id uuid)
RETURNS TABLE(area_name text, area_sort integer, kit_name text, item_code text, item_name text, quantity numeric, line_sort integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_quote uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  SELECT j.company_id, j.quote_id INTO v_company, v_quote FROM public.jobs j WHERE j.id = p_job_id;
  IF NOT FOUND OR NOT (
       public.user_is_assigned_to_job(v_uid, p_job_id)
    OR (v_company IS NOT NULL AND v_company = public.caller_company_id()
        AND (public.has_role(v_uid, 'admin'::app_role) OR public.has_role(v_uid, 'dispatcher'::app_role)
             OR EXISTS (SELECT 1 FROM public.company_members cm
                        WHERE cm.user_id = v_uid AND cm.company_id = v_company AND cm.role = 'admin')))
  ) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  IF v_quote IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH li AS (
    SELECT qi.item_name AS nm, qi.item_number AS code, qi.quantity AS qty, qi.metadata AS md,
           COALESCE(qi.sort_order, 0) AS srt,
           COALESCE(qa.name, 'General') AS a_name, COALESCE(qa.sort_order, 9999) AS a_sort
    FROM public.quote_items qi
    LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id AND qa.quote_id = qi.quote_id
    WHERE qi.quote_id = v_quote
      AND COALESCE(qi.item_type, '') <> 'labour'
      AND (qi.metadata->>'labour') IS DISTINCT FROM 'true'
  )
  SELECT li.a_name, li.a_sort, NULL::text, li.code, li.nm, li.qty, li.srt
  FROM li WHERE jsonb_typeof(li.md->'kit'->'items') IS DISTINCT FROM 'array'
  UNION ALL
  SELECT li.a_name, li.a_sort, li.nm, k->>'code', COALESCE(k->>'name', k->>'code'),
         COALESCE(NULLIF(k->>'quantity', '')::numeric, 1) * COALESCE(li.qty, 1), li.srt
  FROM li CROSS JOIN LATERAL jsonb_array_elements(li.md->'kit'->'items') k
  WHERE jsonb_typeof(li.md->'kit'->'items') = 'array'
  ORDER BY 2, 1, 7, 3 NULLS FIRST, 5;
END $$;

REVOKE ALL ON FUNCTION public.get_job_packing_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_job_packing_list(uuid) TO authenticated;