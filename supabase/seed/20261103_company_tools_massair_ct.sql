-- SEED (NOT a migration, do not auto-apply). Needs Johan's OK. Massair CT only.
-- 3 × Max Cool flaring kits bought 3 Nov 2026. Cost to be confirmed (~R2,7xx in total) until the invoice arrives,
-- so cost_cents stays NULL and cost_tbc = true. When the invoice lands: update_tool(id, '{"cost_cents": <total/3>, "cost_tbc": false}') per kit.
-- Runs as SQL editor / service role (auth.uid() is NULL), so it inserts directly and writes the 'added' history itself.
DO $$
DECLARE co uuid := '361bf031-9cdb-4d7f-9bde-9eb95fa4725e'; ty uuid; b uuid := gen_random_uuid(); t record; l text; i int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = co AND name ILIKE 'Massair CT%') THEN RAISE EXCEPTION 'Massair CT company not found'; END IF;
  SELECT id INTO ty FROM public.tool_types WHERE company_id IS NULL AND name = 'Flaring kit';
  FOREACH l IN ARRAY ARRAY['FK-01','FK-02','FK-03'] LOOP
    i := i + 1;
    IF EXISTS (SELECT 1 FROM public.tools WHERE company_id = co AND upper(label) = l) THEN CONTINUE; END IF;
    INSERT INTO public.tools (company_id, label, name, tool_type_id, supplier_name, purchase_date, cost_cents, cost_tbc, notes, purchase_batch_id)
    VALUES (co, l, 'Flaring kit', ty, 'Max Cool', DATE '2026-11-03', NULL, true, 'Cost TBC: ~R2,7xx for 3, split per kit when the invoice arrives', b)
    RETURNING id, company_id, status INTO t;
    INSERT INTO public.tool_events (company_id, tool_id, event, to_status, done_by_name, note)
    VALUES (t.company_id, t.id, 'added', t.status, 'Setup', format('Bought as %s of 3', i));
  END LOOP;
END $$;
