-- Supplier documents live on the CLIENT (Johan 30 Oct 18:30/18:32): links are written straight as 'confirmed',
-- optional note (orange "check" chip), and per-line allocation so one document can be split between clients.
-- Re-runnable. Rollback: /workspace/supplier-docs-simplify-2026-10-30/rollback.sql

ALTER TABLE public.supplier_job_document_links ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE IF NOT EXISTS public.supplier_job_document_line_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  document_id uuid NOT NULL REFERENCES public.supplier_job_documents(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES public.supplier_job_document_links(id) ON DELETE CASCADE,
  line_id uuid NOT NULL REFERENCES public.supplier_job_document_lines(id) ON DELETE CASCADE,
  qty numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  serials text[],
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, line_id)
);
CREATE INDEX IF NOT EXISTS sjda_line_idx ON public.supplier_job_document_line_allocations(line_id);
CREATE INDEX IF NOT EXISTS sjda_doc_idx ON public.supplier_job_document_line_allocations(document_id);
ALTER TABLE public.supplier_job_document_line_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_job_document_line_allocations FROM anon;
DROP POLICY IF EXISTS sjd_office_all ON public.supplier_job_document_line_allocations;
CREATE POLICY sjd_office_all ON public.supplier_job_document_line_allocations FOR ALL TO authenticated
  USING (public.sjd_ok(company_id)) WITH CHECK (public.sjd_ok(company_id));
DO $$ BEGIN IF to_regprocedure('public.is_accounts_bot(uuid)') IS NOT NULL THEN
  EXECUTE 'DROP POLICY IF EXISTS zz_no_accounts_bot ON public.supplier_job_document_line_allocations';
  EXECUTE 'CREATE POLICY zz_no_accounts_bot ON public.supplier_job_document_line_allocations AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_accounts_bot())) WITH CHECK (NOT (SELECT public.is_accounts_bot()))';
END IF; END $$;

-- company + same-document + qty guard
CREATE OR REPLACE FUNCTION public.sjda_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; k record; used numeric;
BEGIN
  SELECT * INTO l FROM public.supplier_job_document_lines WHERE id=NEW.line_id;
  SELECT * INTO k FROM public.supplier_job_document_links WHERE id=NEW.link_id;
  IF l.id IS NULL OR k.id IS NULL OR l.document_id<>k.document_id THEN RAISE EXCEPTION 'line % is not on this document', NEW.line_id; END IF;
  NEW.document_id := l.document_id; NEW.company_id := l.company_id;
  SELECT coalesce(sum(qty),0) INTO used FROM public.supplier_job_document_line_allocations WHERE line_id=NEW.line_id AND id<>NEW.id;
  IF used + NEW.qty > coalesce(l.qty,1) THEN
    RAISE EXCEPTION 'Line % (%) has qty %, already allocated %, cannot allocate % more',
      coalesce(l.line_no::text,'?'), coalesce(l.model_number,l.description,'unit'), coalesce(l.qty,1), used, NEW.qty USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sjda_guard ON public.supplier_job_document_line_allocations;
CREATE TRIGGER sjda_guard BEFORE INSERT OR UPDATE ON public.supplier_job_document_line_allocations FOR EACH ROW EXECUTE FUNCTION public.sjda_guard();

-- shared worker (no permission check: callers check). p_lines NULL/[] = whole document (allocations cleared).
CREATE OR REPLACE FUNCTION public._sjd_link_apply(co uuid, p_document_id uuid, p_job_id uuid, p_customer_id uuid, p_line_id uuid, p_note text, p_lines jsonb, p_by text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE k uuid; cust uuid := p_customer_id; e jsonb; lid uuid; q numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supplier_job_documents WHERE id=p_document_id AND company_id=co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jobs WHERE id=p_job_id AND company_id=co) THEN RAISE EXCEPTION 'job not found' USING ERRCODE='42501'; END IF;
  IF cust IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customers WHERE id=cust AND company_id=co) THEN RAISE EXCEPTION 'client not found' USING ERRCODE='42501'; END IF;
  IF p_job_id IS NULL AND cust IS NULL THEN RAISE EXCEPTION 'pick a job or a client'; END IF;
  IF p_job_id IS NOT NULL AND cust IS NULL THEN SELECT customer_id INTO cust FROM jobs WHERE id=p_job_id; END IF;
  IF p_line_id IS NOT NULL AND (p_lines IS NULL OR jsonb_array_length(p_lines)=0) THEN p_lines := jsonb_build_array(jsonb_build_object('line_id',p_line_id,'qty',1)); END IF;
  SELECT id INTO k FROM supplier_job_document_links WHERE document_id=p_document_id
    AND coalesce(job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND (p_job_id IS NOT NULL OR customer_id=cust) LIMIT 1;
  IF k IS NULL THEN
    INSERT INTO supplier_job_document_links(document_id,company_id,job_id,customer_id,status,confirmed_by,confirmed_at,suggested_by,note)
    VALUES (p_document_id,co,p_job_id,cust,'confirmed',auth.uid(),now(),p_by,nullif(trim(p_note),'')) RETURNING id INTO k;
  ELSE
    UPDATE supplier_job_document_links SET status='confirmed', confirmed_by=auth.uid(), confirmed_at=now(),
      customer_id=coalesce(customer_id,cust), note=nullif(trim(p_note),'') WHERE id=k;
  END IF;
  DELETE FROM supplier_job_document_line_allocations WHERE link_id=k;
  IF p_lines IS NOT NULL AND jsonb_typeof(p_lines)='array' THEN
    FOR e IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      lid := nullif(e->>'line_id','')::uuid; q := coalesce(nullif(e->>'qty','')::numeric, 1);
      IF lid IS NULL OR NOT EXISTS (SELECT 1 FROM supplier_job_document_lines WHERE id=lid AND document_id=p_document_id) THEN
        RAISE EXCEPTION 'line % not found on this document', e->>'line_id'; END IF;
      INSERT INTO supplier_job_document_line_allocations(company_id,document_id,link_id,line_id,qty,serials,created_by)
      VALUES (co,p_document_id,k,lid,q,
        CASE WHEN jsonb_typeof(e->'serials')='array' THEN ARRAY(SELECT jsonb_array_elements_text(e->'serials')) END, auth.uid());
      IF p_job_id IS NOT NULL THEN UPDATE supplier_job_document_lines SET job_id=p_job_id WHERE id=lid; END IF;
    END LOOP;
  END IF;
  IF p_job_id IS NOT NULL THEN PERFORM public.sjd_match_units(p_document_id); END IF;
  RETURN k;
END $$;
REVOKE ALL ON FUNCTION public._sjd_link_apply(uuid,uuid,uuid,uuid,uuid,text,jsonb,text) FROM PUBLIC, anon, authenticated;

-- office
DROP FUNCTION IF EXISTS public.sjd_link(uuid,uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION public.sjd_link(p_document_id uuid, p_job_id uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_line_id uuid DEFAULT NULL, p_note text DEFAULT NULL, p_lines jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid;
BEGIN
  SELECT company_id INTO co FROM public.supplier_job_documents WHERE id=p_document_id;
  IF NOT coalesce(public.sjd_ok(co),false) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN public._sjd_link_apply(co, p_document_id, p_job_id, p_customer_id, p_line_id, p_note, p_lines, 'office');
END $$;
REVOKE ALL ON FUNCTION public.sjd_link(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_link(uuid,uuid,uuid,uuid,text,jsonb) TO authenticated;

-- WALDA (audited)
DROP FUNCTION IF EXISTS public.walda_sjd_link(uuid,uuid,uuid,uuid);
CREATE OR REPLACE FUNCTION public.walda_sjd_link(p_document_id uuid, p_job_id uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_line_id uuid DEFAULT NULL, p_note text DEFAULT NULL, p_lines jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); k uuid; b jsonb;
BEGIN
  SELECT to_jsonb(x) INTO b FROM supplier_job_document_links x WHERE document_id=p_document_id
    AND ((p_job_id IS NOT NULL AND job_id=p_job_id) OR (p_job_id IS NULL AND job_id IS NULL AND customer_id=p_customer_id)) LIMIT 1;
  k := public._sjd_link_apply(co, p_document_id, p_job_id, p_customer_id, p_line_id, p_note, p_lines, 'WALDA (bot)');
  PERFORM public._bot_audit(co, 'sjd_link', 'supplier_job_document_links', k, b,
    (SELECT to_jsonb(x) || jsonb_build_object('allocations',(SELECT coalesce(jsonb_agg(jsonb_build_object('line_id',a.line_id,'qty',a.qty,'serials',a.serials)),'[]') FROM supplier_job_document_line_allocations a WHERE a.link_id=k))
       FROM supplier_job_document_links x WHERE x.id=k));
  RETURN k;
END $$;
REVOKE ALL ON FUNCTION public.walda_sjd_link(uuid,uuid,uuid,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_sjd_link(uuid,uuid,uuid,uuid,text,jsonb) TO authenticated;

-- kept for compatibility; nothing in the UI uses it
CREATE OR REPLACE FUNCTION public.walda_sjd_confirm(p_link_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public._walda_co(); x public.supplier_job_document_links%ROWTYPE;
BEGIN
  SELECT * INTO x FROM supplier_job_document_links WHERE id=p_link_id;
  IF x.id IS NULL OR x.company_id IS DISTINCT FROM co THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  RETURN public.walda_sjd_link(x.document_id, x.job_id, x.customer_id, NULL, x.note,
    (SELECT jsonb_agg(jsonb_build_object('line_id',a.line_id,'qty',a.qty)) FROM supplier_job_document_line_allocations a WHERE a.link_id=x.id));
END $$;

-- Client page: confirmed docs for one client, only that client's lines, no other client names.
CREATE OR REPLACE FUNCTION public.sjd_client_docs(p_customer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH c AS (SELECT id, company_id FROM customers WHERE id=p_customer_id AND public.sjd_ok(company_id)),
  ks AS (SELECT k.* FROM supplier_job_document_links k JOIN c ON c.id=k.customer_id AND k.company_id=c.company_id WHERE k.status='confirmed'),
  dd AS (SELECT DISTINCT document_id FROM ks)
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'doc_date' DESC NULLS LAST),'[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'id', d.id, 'supplier', coalesce(s.name, d.supplier_name), 'doc_type', d.doc_type, 'doc_number', d.doc_number, 'po_number', d.po_number,
      'doc_date', d.doc_date, 'storage_path', d.storage_path, 'file_name', d.file_name,
      'notes', (SELECT array_agg(k.note) FROM ks k WHERE k.document_id=d.id AND k.note IS NOT NULL),
      'whole', EXISTS (SELECT 1 FROM ks k WHERE k.document_id=d.id AND NOT EXISTS (SELECT 1 FROM supplier_job_document_line_allocations a WHERE a.link_id=k.id)),
      'shared_with', (SELECT count(DISTINCT coalesce(o.customer_id, j.customer_id)) FROM supplier_job_document_links o LEFT JOIN jobs j ON j.id=o.job_id
                       WHERE o.document_id=d.id AND o.status='confirmed' AND coalesce(o.customer_id, j.customer_id) IS DISTINCT FROM p_customer_id),
      'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('line_no',l.line_no,'description',l.description,'model',coalesce(u.model,l.model_number),
                   'serial',coalesce(nullif(array_to_string(al.serials,', '),''), u.serial_number, l.serial_number),'qty',coalesce(al.qty,l.qty)) ORDER BY l.line_no),'[]')
                FROM supplier_job_document_lines l
                LEFT JOIN LATERAL (SELECT sum(a.qty) qty, array_agg(sr) FILTER (WHERE sr IS NOT NULL) serials
                    FROM supplier_job_document_line_allocations a JOIN ks k ON k.id=a.link_id LEFT JOIN LATERAL unnest(a.serials) sr ON true
                    WHERE a.line_id=l.id) al ON true
                LEFT JOIN job_unit_details u ON u.id=l.unit_detail_id
                WHERE l.document_id=d.id AND (al.qty IS NOT NULL OR EXISTS (SELECT 1 FROM ks k WHERE k.document_id=d.id AND NOT EXISTS (SELECT 1 FROM supplier_job_document_line_allocations a WHERE a.link_id=k.id))))
    ) x
    FROM dd JOIN supplier_job_documents d ON d.id=dd.document_id LEFT JOIN suppliers s ON s.id=d.supplier_id
  ) t;
$$;
REVOKE ALL ON FUNCTION public.sjd_client_docs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_client_docs(uuid) TO authenticated;
