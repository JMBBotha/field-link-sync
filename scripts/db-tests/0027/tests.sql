\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION pg_temp.ok(c boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF c IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', name; END IF; RAISE NOTICE 'PASS: %', name; END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); END $$;

-- 1. Permissions
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.quote_delete(uuid,text,boolean)','EXECUTE'), 'anon cannot execute quote_delete');
SELECT pg_temp.ok(NOT has_function_privilege('anon','public.quote_archive(uuid,text)','EXECUTE'), 'anon cannot execute quote_archive');
SELECT pg_temp.ok(has_function_privilege('authenticated','public.quote_delete_check(uuid)','EXECUTE'), 'authenticated can execute quote_delete_check');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated','public._quote_delete_facts(uuid,uuid)','EXECUTE'), 'internal helper not callable by clients');

DO $$ DECLARE e text; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000d1'); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.quote_delete('22222222-0000-0000-0000-000000000001','x'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Only an admin%', 'non-admin refused delete ('||e||')');
  BEGIN PERFORM public.quote_archive('22222222-0000-0000-0000-000000000001','x'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Only an admin%', 'non-admin refused archive');
  BEGIN PERFORM public.quote_delete_check('22222222-0000-0000-0000-000000000001'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Only an admin%', 'non-admin refused check');
END $$;
DO $$ DECLARE e text; BEGIN
  PERFORM pg_temp.as_user('bbbbbbbb-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.quote_delete('22222222-0000-0000-0000-000000000001','x'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Not allowed: this quote belongs to another company%', 'other company admin refused delete');
  BEGIN PERFORM public.quote_archive('22222222-0000-0000-0000-000000000002','x'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Not allowed%', 'other company admin refused archive');
  BEGIN PERFORM public.quote_unarchive('22222222-0000-0000-0000-000000000002'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Not allowed%', 'other company admin refused unarchive');
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.quotes) = 5, 'refusals changed nothing');

-- 2. Check
DO $$ DECLARE c jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  c := public.quote_delete_check('22222222-0000-0000-0000-000000000001');
  PERFORM pg_temp.ok((c->>'can_delete')::boolean, 'Q1 draft can be deleted');
  PERFORM pg_temp.ok((c->'counts'->>'items')::int = 2 AND (c->'counts'->>'areas')::int = 1 AND (c->'counts'->>'notifications')::int = 3
       AND (c->'counts'->>'draft_invoices')::int = 1 AND (c->'counts'->>'send_approvals')::int = 1 AND (c->'counts'->>'visit_photos')::int = 1
       AND (c->>'photos_optional')::boolean, 'Q1 counts correct ('||(c->'counts')::text||')');
  PERFORM pg_temp.ok(NOT (c ? 'draft_invoice_ids'), 'check does not leak ids');
  c := public.quote_delete_check('22222222-0000-0000-0000-000000000002');
  PERFORM pg_temp.ok(NOT (c->>'can_delete')::boolean AND c->>'reasons' LIKE '%INV-T2 (sent)%' AND c->>'reasons' LIKE '%payment%', 'Q2 (issued invoice + payment) cannot be deleted: '||(c->>'reasons'));
  c := public.quote_delete_check('22222222-0000-0000-0000-000000000005');
  PERFORM pg_temp.ok(NOT (c->>'can_delete')::boolean AND c->>'reasons' LIKE '%job%', 'Q5 (has job) cannot be deleted');
  c := public.quote_delete_check('22222222-0000-0000-0000-000000000003');
  PERFORM pg_temp.ok((c->>'can_delete')::boolean AND NOT (c->>'photos_optional')::boolean, 'Q3 deletable, photos not offered (lead has another quote)');
END $$;

-- 3. Refusals of hard delete
DO $$ DECLARE e text; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.quote_delete('22222222-0000-0000-0000-000000000002','test'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'This quote cannot be deleted%Archive it instead.', 'Q2 hard delete refused: '||e);
  BEGIN PERFORM public.quote_delete('22222222-0000-0000-0000-000000000005','test'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE '%Has a job%', 'Q5 hard delete refused (job)');
  BEGIN PERFORM public.quote_delete('22222222-0000-0000-0000-000000000001','  '); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE 'Give a reason%', 'blank reason refused');
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.quotes) = 5 AND (SELECT count(*) FROM public.payments) = 1, 'refused deletes changed nothing');

-- 4. Cron filters before archive: Q2 + Q3 due
TRUNCATE public._test_nudges;
SELECT public.process_quote_followups();
SELECT pg_temp.ok((SELECT count(*) FROM public._test_nudges WHERE id = '22222222-0000-0000-0000-000000000003') = 1, 'before archive: Q3 gets follow-up nudge');
SELECT pg_temp.ok(public.quotes_followup_due_count() = 2, 'before archive: follow-up count 2');
TRUNCATE public._test_nudges;
SELECT public.process_sales_escalations();
SELECT pg_temp.ok((SELECT count(*) FROM public._test_nudges WHERE id = '22222222-0000-0000-0000-000000000002') >= 1, 'before archive: Q2 gets deposit nudge');

-- 5. Archive Q2 (locked, accepted) and Q3
DO $$ DECLARE r jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  r := public.quote_archive('22222222-0000-0000-0000-000000000002','Client went elsewhere');
  PERFORM pg_temp.ok((r->>'archived')::boolean AND (r->>'notifications_marked_read')::int = 1, 'Q2 archived, its alert marked read');
  r := public.quote_archive('22222222-0000-0000-0000-000000000003','Duplicate');
END $$;
SELECT pg_temp.ok(archived_at IS NOT NULL AND archived_by = 'aaaaaaaa-0000-0000-0000-0000000000a1' AND archive_reason = 'Client went elsewhere', 'Q2 archive columns set')
  FROM public.quotes WHERE id = '22222222-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT count(*) FROM public.invoices WHERE id='44444444-0000-0000-0000-000000000002') = 1 AND (SELECT count(*) FROM public.payments) = 1, 'archive keeps invoice and payment');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.audit_log WHERE action='archive' AND record_id='22222222-0000-0000-0000-000000000002'
   AND company_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a1'
   AND new_data->>'reason'='Client went elsewhere' AND jsonb_array_length(old_data->'items') = 1), 'archive audit row with quote+items snapshot');
DO $$ DECLARE e text; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  BEGIN PERFORM public.quote_archive('22222222-0000-0000-0000-000000000002','again'); e := 'none'; EXCEPTION WHEN others THEN e := SQLERRM; END;
  PERFORM pg_temp.ok(e LIKE '%already archived%', 'double archive refused');
END $$;
TRUNCATE public._test_nudges;
SELECT public.process_quote_followups();
SELECT public.process_sales_escalations();
SELECT pg_temp.ok((SELECT count(*) FROM public._test_nudges WHERE id IN ('22222222-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000003')) = 0, 'after archive: no nudges for archived quotes');
SELECT pg_temp.ok(public.quotes_followup_due_count() = 0, 'after archive: follow-up count 0');

-- 6. Unarchive Q2
DO $$ DECLARE r jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  r := public.quote_unarchive('22222222-0000-0000-0000-000000000002');
  PERFORM pg_temp.ok(NOT (r->>'archived')::boolean, 'Q2 unarchived');
END $$;
SELECT pg_temp.ok(archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL, 'Q2 archive columns cleared') FROM public.quotes WHERE id = '22222222-0000-0000-0000-000000000002';
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.audit_log WHERE action='unarchive' AND record_id='22222222-0000-0000-0000-000000000002' AND company_id IS NOT NULL), 'unarchive audit row');
TRUNCATE public._test_nudges;
SELECT public.process_sales_escalations();
SELECT pg_temp.ok((SELECT count(*) FROM public._test_nudges WHERE id = '22222222-0000-0000-0000-000000000002') >= 1, 'after unarchive: Q2 nudges resume');

-- 7. Hard delete Q1 with photos
DO $$ DECLARE r jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  r := public.quote_delete('22222222-0000-0000-0000-000000000001','Test quote', true);
  PERFORM pg_temp.ok((r->>'deleted')::boolean AND (r->>'notifications_deleted')::int = 3 AND (r->>'draft_invoices_deleted')::int = 1
     AND (r->>'visit_photos_deleted')::int = 1, 'Q1 deleted: '||r::text);
  PERFORM pg_temp.ok(r->'storage'->'quote-photos' = '["q1/photo.jpg"]' AND r->'storage'->'quote-documents' = '["q1/doc.pdf"]'
     AND r->'storage'->'job-photos' @> '["l1/a.jpg","l1/a-annot.jpg"]', 'storage paths returned for cleanup after commit');
END $$;
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.quotes WHERE id='22222222-0000-0000-0000-000000000001'), 'Q1 row gone');
SELECT pg_temp.ok((SELECT count(*) FROM public.quote_items WHERE quote_id='22222222-0000-0000-0000-000000000001') = 0
   AND (SELECT count(*) FROM public.quote_areas WHERE quote_id='22222222-0000-0000-0000-000000000001') = 0
   AND (SELECT count(*) FROM public.quote_attachments WHERE quote_id='22222222-0000-0000-0000-000000000001') = 0
   AND (SELECT count(*) FROM public.quote_documents WHERE quote_id='22222222-0000-0000-0000-000000000001') = 0, 'Q1 children cascaded');
SELECT pg_temp.ok((SELECT count(*) FROM public.invoices WHERE id='44444444-0000-0000-0000-000000000001') = 0
   AND (SELECT count(*) FROM public.invoice_send_approvals) = 0 AND (SELECT count(*) FROM public.invoice_send_events) = 0, 'draft invoice + approval + events removed');
SELECT pg_temp.ok((SELECT count(*) FROM public.notifications WHERE title IN ('Q1 viewed','INV-T1 ready','Q1 nudge')) = 0
   AND (SELECT count(*) FROM public.notifications WHERE title IN ('Unrelated','Q2 accepted')) = 2, 'Q1 notifications cleaned, others kept');
SELECT pg_temp.ok((SELECT quote_ids FROM public.quote_bundles) = ARRAY['22222222-0000-0000-0000-000000000003']::uuid[], 'bundle no longer lists Q1');
SELECT pg_temp.ok((SELECT count(*) FROM public.job_photos WHERE lead_id='11111111-0000-0000-0000-000000000002') = 1, 'other lead photos kept');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.audit_log WHERE action='delete' AND table_name='quotes' AND record_id='22222222-0000-0000-0000-000000000001'
   AND company_id='aaaaaaaa-0000-0000-0000-000000000001' AND user_id='aaaaaaaa-0000-0000-0000-0000000000a1' AND new_data->>'reason'='Test quote'
   AND old_data->'quote'->>'quote_number'='Q-T-0001' AND jsonb_array_length(old_data->'items') = 2), 'delete audit row with full snapshot + company');
SELECT pg_temp.ok((SELECT count(*) FROM public.customers) = 1, 'client record kept');

-- 8. Delete archived Q3 without photos (lead shared): photos stay
DO $$ DECLARE r jsonb; BEGIN
  PERFORM pg_temp.as_user('aaaaaaaa-0000-0000-0000-0000000000a1'); SET LOCAL ROLE authenticated;
  r := public.quote_delete('22222222-0000-0000-0000-000000000003','Duplicate', true);
  PERFORM pg_temp.ok((r->>'visit_photos_deleted')::int = 0, 'Q3 deleted; shared-lead photos not deleted even when ticked');
END $$;
SELECT pg_temp.ok((SELECT count(*) FROM public.job_photos) = 1 AND (SELECT count(*) FROM public.quotes) = 3, 'final: 3 quotes, 1 photo left');
SELECT 'ALL TESTS PASSED' AS result;
