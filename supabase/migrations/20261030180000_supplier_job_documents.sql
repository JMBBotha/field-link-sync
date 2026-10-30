-- Private supplier documents (delivery notes, supplier invoices, POs) linked to many jobs/clients.
-- Office only: company admin or dispatcher of the same company, never sales reps, techs, clients or anon.
CREATE OR REPLACE FUNCTION public.sjd_ok(_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND _company IS NOT NULL AND _company = public.caller_company_id()
    AND NOT public.is_sales_rep(auth.uid())
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'dispatcher'::app_role)
         OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=auth.uid() AND cm.company_id=_company AND cm.role='admin'));
$$;

CREATE TABLE IF NOT EXISTS public.supplier_job_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  doc_type text NOT NULL DEFAULT 'delivery_note' CHECK (doc_type IN ('delivery_note','supplier_invoice','purchase_order','supplier_quote','credit_note','warranty','other')),
  doc_number text, po_number text, doc_date date,
  storage_path text, file_name text, mime_type text,
  notes text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','assistant')),
  source_ref text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sjd_source_ref_uq ON public.supplier_job_documents(company_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS sjd_company_idx ON public.supplier_job_documents(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.supplier_job_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.supplier_job_documents(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  line_no int, description text, model_number text, serial_number text, qty numeric DEFAULT 1,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  unit_detail_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sjdl_doc_idx ON public.supplier_job_document_lines(document_id);
CREATE INDEX IF NOT EXISTS sjdl_model_idx ON public.supplier_job_document_lines(company_id, lower(model_number));
CREATE INDEX IF NOT EXISTS sjdl_serial_idx ON public.supplier_job_document_lines(company_id, lower(serial_number));

CREATE TABLE IF NOT EXISTS public.supplier_job_document_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.supplier_job_documents(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  job_id uuid REFERENCES public.jobs(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  line_id uuid REFERENCES public.supplier_job_document_lines(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested','confirmed')),
  confidence numeric, reason text, suggested_by text,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (job_id IS NOT NULL OR customer_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS sjdk_uq ON public.supplier_job_document_links(document_id, coalesce(job_id,'00000000-0000-0000-0000-000000000000'::uuid), coalesce(customer_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS sjdk_job_idx ON public.supplier_job_document_links(job_id);
CREATE INDEX IF NOT EXISTS sjdk_cust_idx ON public.supplier_job_document_links(customer_id);

ALTER TABLE public.supplier_job_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_job_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_job_document_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.supplier_job_documents, public.supplier_job_document_lines, public.supplier_job_document_links FROM anon;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_job_documents','supplier_job_document_lines','supplier_job_document_links'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS sjd_office_all ON public.%I', t);
    EXECUTE format('CREATE POLICY sjd_office_all ON public.%I FOR ALL TO authenticated USING (public.sjd_ok(company_id)) WITH CHECK (public.sjd_ok(company_id))', t);
  END LOOP; END $$;

-- keep company_id of children equal to parent
CREATE OR REPLACE FUNCTION public.sjd_child_company() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  SELECT company_id INTO NEW.company_id FROM public.supplier_job_documents WHERE id=NEW.document_id;
  IF NEW.job_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE id=NEW.job_id AND company_id=NEW.company_id) THEN
    RAISE EXCEPTION 'job not in this company'; END IF;
  IF TG_TABLE_NAME='supplier_job_document_links' THEN
    IF NEW.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.customers WHERE id=NEW.customer_id AND company_id=NEW.company_id) THEN
      RAISE EXCEPTION 'client not in this company'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sjd_lines_co ON public.supplier_job_document_lines;
CREATE TRIGGER sjd_lines_co BEFORE INSERT OR UPDATE ON public.supplier_job_document_lines FOR EACH ROW EXECUTE FUNCTION public.sjd_child_company();
DROP TRIGGER IF EXISTS sjd_links_co ON public.supplier_job_document_links;
CREATE TRIGGER sjd_links_co BEFORE INSERT OR UPDATE ON public.supplier_job_document_links FOR EACH ROW EXECUTE FUNCTION public.sjd_child_company();

-- link a line's serial/model to the job's installed unit record (job_unit_details) when present
CREATE OR REPLACE FUNCTION public.sjd_match_units(_doc uuid) RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int := 0;
BEGIN
  IF to_regclass('public.job_unit_details') IS NULL THEN RETURN 0; END IF;
  EXECUTE $q$
    UPDATE public.supplier_job_document_lines l SET unit_detail_id = u.id
    FROM public.job_unit_details u
    WHERE l.document_id = $1 AND l.job_id = u.job_id AND l.unit_detail_id IS NULL
      AND ((l.serial_number IS NOT NULL AND lower(trim(u.serial_number)) = lower(trim(l.serial_number)))
        OR (l.serial_number IS NULL AND l.model_number IS NOT NULL AND lower(trim(u.model)) = lower(trim(l.model_number))))$q$ USING _doc;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

-- model-number matching against open jobs (via unit details and quote lines)
CREATE OR REPLACE FUNCTION public.sjd_suggest_for_model(_company uuid, _model text)
RETURNS TABLE(job_id uuid, customer_id uuid, quote_id uuid, confidence numeric, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH m AS (SELECT lower(regexp_replace(coalesce(_model,''),'[^A-Za-z0-9]','','g')) k)
  SELECT DISTINCT ON (j.id) j.id, j.customer_id, j.quote_id, x.conf, x.why
  FROM public.jobs j, m,
  LATERAL (
    SELECT 0.9::numeric conf, 'model on job unit record'::text why WHERE to_regclass('public.job_unit_details') IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.job_unit_details u WHERE u.job_id=j.id AND lower(regexp_replace(coalesce(u.model,''),'[^A-Za-z0-9]','','g'))=m.k)
    UNION ALL
    SELECT 0.75, 'model on accepted quote line' WHERE j.quote_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.quote_line_items q WHERE q.quote_id=j.quote_id
        AND lower(regexp_replace(coalesce(q.description,''),'[^A-Za-z0-9]','','g')) LIKE '%'||m.k||'%')
  ) x
  WHERE length(m.k) >= 5 AND j.company_id=_company
    AND coalesce(j.status::text,'') NOT IN ('cancelled','canceled')
    AND (j.completed_at IS NULL OR j.completed_at > now() - interval '60 days')
  ORDER BY j.id, x.conf DESC;
$$;
REVOKE ALL ON FUNCTION public.sjd_suggest_for_model(uuid,text) FROM PUBLIC, anon, authenticated;

-- CONTRACT for the accounting assistant (server-side, service role) and admin UI.
-- sjd_ingest(p_company_id uuid, p_doc jsonb, p_lines jsonb DEFAULT '[]', p_source_ref text DEFAULT NULL) -> jsonb
-- p_doc keys: supplier_name, supplier_id, doc_type, doc_number, po_number, doc_date (YYYY-MM-DD), storage_path, file_name, mime_type, notes
-- p_lines: [{description, model_number, serial_number, qty}]
-- Idempotent on (company, source_ref). Creates links with status 'suggested' by model match. Returns {document_id, suggested, duplicate}.
CREATE OR REPLACE FUNCTION public.sjd_ingest(p_company_id uuid, p_doc jsonb, p_lines jsonb DEFAULT '[]'::jsonb, p_source_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d uuid; ln jsonb; lid uuid; i int := 0; s record; nsug int := 0; is_svc boolean := coalesce(auth.role(),'')='service_role';
BEGIN
  IF NOT is_svc AND NOT public.sjd_ok(p_company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_source_ref IS NOT NULL THEN
    SELECT id INTO d FROM public.supplier_job_documents WHERE company_id=p_company_id AND source_ref=p_source_ref;
    IF d IS NOT NULL THEN RETURN jsonb_build_object('document_id',d,'duplicate',true,'suggested',0); END IF;
  END IF;
  INSERT INTO public.supplier_job_documents(company_id,supplier_id,supplier_name,doc_type,doc_number,po_number,doc_date,storage_path,file_name,mime_type,notes,source,source_ref,created_by)
  VALUES (p_company_id, nullif(p_doc->>'supplier_id','')::uuid, p_doc->>'supplier_name', coalesce(nullif(p_doc->>'doc_type',''),'delivery_note'),
    p_doc->>'doc_number', p_doc->>'po_number', nullif(p_doc->>'doc_date','')::date, p_doc->>'storage_path', p_doc->>'file_name', p_doc->>'mime_type', p_doc->>'notes',
    CASE WHEN is_svc THEN 'assistant' ELSE 'manual' END, p_source_ref, auth.uid())
  RETURNING id INTO d;
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    i := i + 1;
    INSERT INTO public.supplier_job_document_lines(document_id,company_id,line_no,description,model_number,serial_number,qty)
    VALUES (d, p_company_id, i, ln->>'description', nullif(trim(ln->>'model_number'),''), nullif(trim(ln->>'serial_number'),''), coalesce(nullif(ln->>'qty','')::numeric,1))
    RETURNING id INTO lid;
    FOR s IN SELECT * FROM public.sjd_suggest_for_model(p_company_id, ln->>'model_number') LOOP
      INSERT INTO public.supplier_job_document_links(document_id,company_id,job_id,customer_id,quote_id,line_id,status,confidence,reason,suggested_by)
      VALUES (d,p_company_id,s.job_id,s.customer_id,s.quote_id,lid,'suggested',s.confidence,s.reason||' ('||coalesce(ln->>'model_number','')||')',
              CASE WHEN is_svc THEN 'assistant' ELSE 'auto-match' END)
      ON CONFLICT DO NOTHING;
      nsug := nsug + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('document_id',d,'duplicate',false,'suggested',nsug);
END $$;
REVOKE ALL ON FUNCTION public.sjd_ingest(uuid,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_ingest(uuid,jsonb,jsonb,text) TO authenticated, service_role;

-- Admin: add/confirm a link (job and/or client). Confirming a job link also sets the job on matching lines.
CREATE OR REPLACE FUNCTION public.sjd_link(p_document_id uuid, p_job_id uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_line_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid; k uuid; cust uuid := p_customer_id;
BEGIN
  SELECT company_id INTO co FROM public.supplier_job_documents WHERE id=p_document_id;
  IF NOT public.sjd_ok(co) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_job_id IS NOT NULL AND cust IS NULL THEN SELECT customer_id INTO cust FROM public.jobs WHERE id=p_job_id AND company_id=co; END IF;
  SELECT id INTO k FROM public.supplier_job_document_links WHERE document_id=p_document_id
    AND coalesce(job_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(p_job_id,'00000000-0000-0000-0000-000000000000'::uuid)
    AND (p_job_id IS NOT NULL OR customer_id=cust);
  IF k IS NULL THEN
    INSERT INTO public.supplier_job_document_links(document_id,company_id,job_id,customer_id,line_id,status,confirmed_by,confirmed_at,suggested_by)
    VALUES (p_document_id,co,p_job_id,cust,p_line_id,'confirmed',auth.uid(),now(),'admin') RETURNING id INTO k;
  ELSE
    UPDATE public.supplier_job_document_links SET status='confirmed', confirmed_by=auth.uid(), confirmed_at=now(),
      customer_id=coalesce(customer_id,cust), line_id=coalesce(p_line_id,line_id) WHERE id=k;
  END IF;
  IF p_job_id IS NOT NULL THEN
    UPDATE public.supplier_job_document_lines SET job_id=p_job_id
      WHERE document_id=p_document_id AND (id=p_line_id OR id IN (SELECT line_id FROM public.supplier_job_document_links WHERE id=k));
    PERFORM public.sjd_match_units(p_document_id);
  END IF;
  RETURN k;
END $$;
REVOKE ALL ON FUNCTION public.sjd_link(uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_link(uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.sjd_unlink(p_link_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.supplier_job_document_links WHERE id=p_link_id;
  IF r IS NULL OR NOT public.sjd_ok(r.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  DELETE FROM public.supplier_job_document_links WHERE id=p_link_id;
  IF r.job_id IS NOT NULL THEN
    UPDATE public.supplier_job_document_lines SET job_id=NULL, unit_detail_id=NULL WHERE document_id=r.document_id AND job_id=r.job_id
      AND NOT EXISTS (SELECT 1 FROM public.supplier_job_document_links WHERE document_id=r.document_id AND job_id=r.job_id);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.sjd_unlink(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_unlink(uuid) TO authenticated;

-- Warranty search: model, serial, supplier, doc/PO number, client name, job title.
CREATE OR REPLACE FUNCTION public.sjd_search(p_q text, p_limit int DEFAULT 50)
RETURNS TABLE(document_id uuid, supplier text, doc_type text, doc_number text, po_number text, doc_date date, file_name text,
              needs_linking boolean, matched text, clients text, jobs text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH me AS (SELECT public.caller_company_id() co), q AS (SELECT '%'||lower(trim(coalesce(p_q,'')))||'%' k)
  SELECT d.id, coalesce(s.name,d.supplier_name), d.doc_type, d.doc_number, d.po_number, d.doc_date, d.file_name,
    (NOT EXISTS (SELECT 1 FROM public.supplier_job_document_links k WHERE k.document_id=d.id AND k.status='confirmed')),
    (SELECT string_agg(DISTINCT concat_ws(' / ', l.model_number, l.serial_number), ', ') FROM public.supplier_job_document_lines l
       WHERE l.document_id=d.id AND (lower(coalesce(l.model_number,'')) LIKE q.k OR lower(coalesce(l.serial_number,'')) LIKE q.k)),
    (SELECT string_agg(DISTINCT c.name, ', ') FROM public.supplier_job_document_links k JOIN public.customers c ON c.id=k.customer_id WHERE k.document_id=d.id),
    (SELECT string_agg(DISTINCT j.title, ', ') FROM public.supplier_job_document_links k JOIN public.jobs j ON j.id=k.job_id WHERE k.document_id=d.id)
  FROM public.supplier_job_documents d CROSS JOIN me CROSS JOIN q
  LEFT JOIN public.suppliers s ON s.id=d.supplier_id
  WHERE public.sjd_ok(d.company_id) AND d.company_id=me.co AND (
    q.k='%%' OR lower(coalesce(s.name,d.supplier_name,'')) LIKE q.k OR lower(coalesce(d.doc_number,'')) LIKE q.k OR lower(coalesce(d.po_number,'')) LIKE q.k
    OR lower(coalesce(d.file_name,'')) LIKE q.k
    OR EXISTS (SELECT 1 FROM public.supplier_job_document_lines l WHERE l.document_id=d.id AND (lower(coalesce(l.model_number,'')) LIKE q.k OR lower(coalesce(l.serial_number,'')) LIKE q.k OR lower(coalesce(l.description,'')) LIKE q.k))
    OR EXISTS (SELECT 1 FROM public.supplier_job_document_links k JOIN public.customers c ON c.id=k.customer_id WHERE k.document_id=d.id AND lower(coalesce(c.name,'')) LIKE q.k))
  ORDER BY d.created_at DESC LIMIT greatest(1,least(coalesce(p_limit,50),200));
$$;
REVOKE ALL ON FUNCTION public.sjd_search(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_search(text,int) TO authenticated;

-- Private storage bucket, path: <company_id>/<document_id or uuid>/<file>
INSERT INTO storage.buckets(id,name,public) VALUES ('supplier-job-docs','supplier-job-docs',false) ON CONFLICT (id) DO UPDATE SET public=false;
DROP POLICY IF EXISTS sjd_obj_all ON storage.objects;
CREATE POLICY sjd_obj_all ON storage.objects FOR ALL TO authenticated
  USING (bucket_id='supplier-job-docs' AND (storage.foldername(name))[1] = (public.caller_company_id())::text AND public.sjd_ok(public.caller_company_id()))
  WITH CHECK (bucket_id='supplier-job-docs' AND (storage.foldername(name))[1] = (public.caller_company_id())::text AND public.sjd_ok(public.caller_company_id()));
