CREATE OR REPLACE FUNCTION public.get_owner_money_flow(p_company_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_co uuid; v_master uuid; v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  v_co := COALESCE(p_company_id, (SELECT company_id FROM public.company_members
            WHERE user_id = v_uid AND role = 'admin' AND is_owner ORDER BY created_at LIMIT 1));
  IF v_co IS NULL OR NOT public.is_company_owner(v_uid, v_co) THEN RETURN NULL; END IF;
  v_master := (SELECT id FROM public.companies WHERE is_master ORDER BY created_at LIMIT 1);

  WITH qs AS (
    SELECT qt.id, qt.quote_number, COALESCE(qt.accepted_at, qt.created_at) AS basis_at,
           public._earnings_for_quote(qt.id, v_uid) AS e,
           (SELECT COALESCE(sum(round(COALESCE(i.quantity,0)::numeric * COALESCE(i.unit_price,0)::numeric, 2)),0)
              FROM public.quote_items i WHERE i.quote_id = qt.id AND i.parent_item_id IS NULL) AS gross
      FROM public.quotes qt
     WHERE COALESCE(qt.company_id, v_master) = v_co
       AND (qt.status = 'accepted' OR EXISTS (SELECT 1 FROM public.invoices iv WHERE iv.quote_id = qt.id))
  ), f AS (
    SELECT id, quote_number, e,
           CASE WHEN (e->>'paid_in_full')::boolean THEN 'earned' ELSE 'pending' END AS bucket,
           to_char(COALESCE((e->>'paid_at')::date, basis_at::date), 'YYYY-MM') AS month,
           round(gross - COALESCE((e->'company'->>'discount')::numeric, 0), 2) AS revenue,
           COALESCE((e->'sales'->>'items_sell_ex_vat')::numeric, 0) AS items_sell,
           COALESCE((e->'tech'->>'labour_sell_ex_vat')::numeric, 0) AS labour_sell
      FROM qs WHERE e IS NOT NULL AND (e->'viewer'->>'is_owner')::boolean
  ), seg AS (
    SELECT f.id, f.bucket, f.month, s.key, s.grp, s.label, s.ord, s.amount
      FROM f, LATERAL (VALUES
        ('items_cost',       'cost',    'Physical item cost',                     1, COALESCE((f.e->'sales'->>'items_cost')::numeric,0)),
        ('sales_commission', 'sales',   'Sales commission',                       2, COALESCE((f.e->'sales'->>'commission')::numeric,0)),
        ('company_items',    'company', 'Company keeps · items',                 20, COALESCE((f.e->'company'->>'items_keep')::numeric,0)),
        ('company_labour',   'company', 'Company keeps · labour',                21, COALESCE((f.e->'company'->>'labour_keep')::numeric,0)),
        ('company_other',    'company', 'Company keeps · services & uncosted lines', 22, round(f.revenue - f.items_sell - f.labour_sell, 2))
      ) s(key, grp, label, ord, amount)
    UNION ALL
    SELECT f.id, f.bucket, f.month,
           CASE WHEN p.part->>'kind' = 'tools' THEN 'company_tools' ELSE 'tech_' || (p.part->>'kind') END,
           CASE WHEN p.part->>'kind' = 'tools' THEN 'company' ELSE 'tech' END,
           CASE WHEN p.part->>'kind' = 'tools' THEN 'Company keeps · tools share'
                ELSE 'Tech labour share · ' || (p.part->>'kind') END,
           CASE WHEN p.part->>'kind' = 'tools' THEN 23 ELSE 10 + p.n::int END,
           round(f.labour_sell * (p.part->>'percent')::numeric / 100, 2)
      FROM f, jsonb_array_elements(f.e->'tech'->'rule'->'parts') WITH ORDINALITY p(part, n)
  ), defs AS (
    SELECT key, min(grp) grp, min(label) label, min(ord) ord FROM seg GROUP BY key
  ), people_raw AS (
    SELECT f.bucket, 'sales' AS role, (f.e->'sales'->>'rep_id')::uuid AS pid,
           COALESCE((f.e->'sales'->>'commission')::numeric,0) AS amount, f.id
      FROM f WHERE f.e ? 'sales'
    UNION ALL
    SELECT f.bucket, 'tech', (t.v->>'profile_id')::uuid, COALESCE((t.v->>'amount')::numeric,0), f.id
      FROM f, jsonb_array_elements(COALESCE(f.e->'tech'->'techs','[]'::jsonb)) t(v)
    UNION ALL
    SELECT f.bucket, 'tech', NULL, COALESCE((f.e->'tech'->>'pool')::numeric,0), f.id
      FROM f WHERE jsonb_array_length(COALESCE(f.e->'tech'->'techs','[]'::jsonb)) = 0 AND COALESCE((f.e->'tech'->>'pool')::numeric,0) <> 0
  )
  SELECT jsonb_build_object(
    'api_version', 1, 'company_id', v_co, 'generated_at', now(),
    'segments', (SELECT COALESCE(jsonb_agg(jsonb_build_object('key',key,'group',grp,'label',label,'order',ord) ORDER BY ord, key),'[]') FROM defs),
    'totals', (SELECT jsonb_object_agg(b.bucket, jsonb_build_object(
        'quotes', (SELECT count(*) FROM f WHERE f.bucket = b.bucket),
        'revenue_ex_vat', (SELECT COALESCE(sum(revenue),0) FROM f WHERE f.bucket = b.bucket),
        'segments', (SELECT COALESCE(jsonb_object_agg(d.key, (SELECT COALESCE(sum(s.amount),0) FROM seg s WHERE s.key = d.key AND s.bucket = b.bucket)),'{}') FROM defs d)))
      FROM (VALUES ('earned'),('pending')) b(bucket)),
    'months', (SELECT COALESCE(jsonb_agg(m ORDER BY m->>'month', m->>'bucket'),'[]') FROM (
        SELECT jsonb_build_object('month', f.month, 'bucket', f.bucket, 'revenue_ex_vat', sum(f.revenue),
          'segments', (SELECT COALESCE(jsonb_object_agg(x.key, x.amt),'{}') FROM
                        (SELECT s.key, sum(s.amount) amt FROM seg s WHERE s.month = f.month AND s.bucket = f.bucket GROUP BY s.key) x)) m
          FROM f GROUP BY f.month, f.bucket) mm),
    'people', (SELECT COALESCE(jsonb_agg(p ORDER BY p->>'role', (p->>'earned')::numeric + (p->>'pending')::numeric DESC),'[]') FROM (
        SELECT jsonb_build_object('role', r.role, 'profile_id', r.pid,
          'name', COALESCE((SELECT pr.full_name FROM public.profiles pr WHERE pr.id = r.pid),
                           CASE WHEN r.pid IS NULL AND r.role = 'sales' THEN 'No rep on file'
                                WHEN r.pid IS NULL THEN 'Unassigned (no tech yet)' ELSE 'Unknown' END),
          'earned', COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'earned'),0),
          'pending', COALESCE(sum(r.amount) FILTER (WHERE r.bucket = 'pending'),0),
          'quotes', count(DISTINCT r.id)) p
          FROM people_raw r GROUP BY r.role, r.pid) pp)
  ) INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.get_owner_money_flow(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_owner_money_flow(uuid) TO authenticated;