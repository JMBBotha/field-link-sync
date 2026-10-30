-- Accounts (bot) login for WALDA: company-scoped, read via column-limited RPCs, write only sjd_ingest (suggested links) + sjd_attach_file + own storage folder.
-- Deliberately NOT an app_role / user_roles / company_members / profiles.company_id entry, so no existing staff/office/company policy treats it as staff.
CREATE TABLE IF NOT EXISTS public.bot_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id),
  role text NOT NULL DEFAULT 'accounts_bot' CHECK (role IN ('accounts_bot')),
  display_name text NOT NULL DEFAULT 'WALDA (bot)',
  disabled boolean NOT NULL DEFAULT false,
  disabled_at timestamptz, disabled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bot_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_accounts FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_accounts_bot(_uid uuid DEFAULT auth.uid()) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT _uid IS NOT NULL AND EXISTS (SELECT 1 FROM public.bot_accounts b WHERE b.user_id=_uid);
$$;
-- company of an ENABLED bot caller, else NULL
CREATE OR REPLACE FUNCTION public.accounts_bot_company() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.company_id FROM public.bot_accounts b WHERE b.user_id=auth.uid() AND b.role='accounts_bot' AND NOT b.disabled;
$$;
REVOKE ALL ON FUNCTION public.is_accounts_bot(uuid), public.accounts_bot_company() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_accounts_bot(uuid), public.accounts_bot_company() TO authenticated;

-- Defence in depth: bot can never read/write any public table directly (all access via the RPCs below).
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_no_accounts_bot ON public.%I', t);
    EXECUTE format('CREATE POLICY zz_no_accounts_bot ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_accounts_bot())) WITH CHECK (NOT (SELECT public.is_accounts_bot()))', t);
  END LOOP; END $$;

-- Read RPC (column-limited, company-scoped, disabled-aware)
CREATE OR REPLACE FUNCTION public.walda_read(p_entity text, p_since timestamptz DEFAULT NULL, p_limit int DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid := public.accounts_bot_company(); lim int := greatest(1,least(coalesce(p_limit,500),2000)); s timestamptz := coalesce(p_since,'-infinity'); r jsonb;
BEGIN
  IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  CASE p_entity
  WHEN 'jobs' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT j.id,j.customer_id,j.quote_id,j.invoice_id,j.title,j.address,j.status,j.job_type,j.scheduled_for,j.started_at,j.completed_at,j.created_at,j.updated_at
      FROM jobs j WHERE j.company_id=co AND j.updated_at>=s ORDER BY j.updated_at DESC LIMIT lim) x;
  WHEN 'quotes' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT q.id,q.quote_number,q.customer_id,q.customer_name,q.lead_id,q.status,q.subtotal,q.vat_amount,q.total,q.accepted_at,q.accepted_version_id,q.reference_text,q.created_at,q.updated_at
      FROM quotes q WHERE q.company_id=co AND q.status='accepted' AND q.updated_at>=s ORDER BY q.updated_at DESC LIMIT lim) x;
  WHEN 'quote_lines' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT l.id,l.quote_id,l.quote_version_id,l.description,l.quantity,l.unit,l.unit_price,l.total,l.sort_order
      FROM quote_line_items l JOIN quotes q ON q.id=l.quote_id WHERE q.company_id=co AND q.status='accepted' AND q.updated_at>=s ORDER BY q.updated_at DESC, l.sort_order LIMIT lim) x;
  WHEN 'quote_items' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT i.id,i.quote_id,i.area_id,i.parent_item_id,i.is_bundle,i.item_type,i.item_name,i.item_number,i.description,i.quantity,i.unit_type,i.unit_price,i.total_price,i.sort_order
      FROM quote_items i JOIN quotes q ON q.id=i.quote_id WHERE q.company_id=co AND q.status='accepted' AND q.updated_at>=s ORDER BY q.updated_at DESC, i.sort_order LIMIT lim) x;
  WHEN 'invoices' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT i.id,i.invoice_number,i.customer_id,i.customer_name,i.customer_email,i.customer_phone,i.customer_address,i.billed_to_vat_number,i.quote_id,i.lead_id,i.status,i.issue_date,i.due_date,i.paid_date,i.subtotal,i.tax_amount,i.grand_total,i.deposit_amount,i.line_items,i.notes,i.created_at,i.updated_at
      FROM invoices i WHERE i.company_id=co AND i.updated_at>=s ORDER BY i.updated_at DESC LIMIT lim) x;
  WHEN 'payments' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT p.id,p.invoice_id,p.amount,p.payment_date,p.method,p.reference,p.gateway,p.status,p.currency,p.created_at
      FROM payments p WHERE p.company_id=co AND p.created_at>=s ORDER BY p.created_at DESC LIMIT lim) x;
  WHEN 'supplier_bill_payments' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT p.id,p.bill_id,p.amount,p.paid_date,p.method,p.reference,p.bank_line_id,p.created_at
      FROM supplier_bill_payments p WHERE p.company_id=co AND p.created_at>=s ORDER BY p.created_at DESC LIMIT lim) x;
  WHEN 'supplier_docs' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT d.id,d.supplier_id,d.supplier_name,d.doc_type,d.doc_number,d.po_number,d.doc_date,d.storage_path,d.file_name,d.mime_type,d.notes,d.source,d.source_ref,d.created_by,d.created_at
      FROM supplier_job_documents d WHERE d.company_id=co AND d.created_at>=s ORDER BY d.created_at DESC LIMIT lim) x;
  WHEN 'supplier_doc_lines' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT l.* FROM supplier_job_document_lines l WHERE l.company_id=co AND l.created_at>=s ORDER BY l.created_at DESC LIMIT lim) x;
  WHEN 'supplier_doc_links' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT k.* FROM supplier_job_document_links k WHERE k.company_id=co AND k.created_at>=s ORDER BY k.created_at DESC LIMIT lim) x;
  WHEN 'job_units' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT u.id,u.job_id,u.unit_label,u.position,u.brand,u.model,u.serial_number,u.occurred_at,u.created_at
      FROM job_unit_details u WHERE u.company_id=co AND u.created_at>=s ORDER BY u.created_at DESC LIMIT lim) x;
  WHEN 'customers' THEN SELECT jsonb_agg(x) INTO r FROM (SELECT c.id,c.name,c.company_name,c.is_company,c.address,c.primary_address_line1,c.primary_address_line2,c.city,c.postal_code,c.area,c.vat_number,c.payment_terms_basis,c.payment_terms_days
      FROM customers c WHERE c.company_id=co AND c.updated_at>=s ORDER BY c.updated_at DESC LIMIT lim) x;
  ELSE RAISE EXCEPTION 'unknown entity %', p_entity;
  END CASE;
  RETURN coalesce(r,'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.walda_read(text,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_read(text,timestamptz,int) TO authenticated;

-- sjd_ingest: allow enabled bot for its own company; source 'assistant', links stay 'suggested'.
CREATE OR REPLACE FUNCTION public.sjd_ingest(p_company_id uuid, p_doc jsonb, p_lines jsonb DEFAULT '[]'::jsonb, p_source_ref text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d uuid; ln jsonb; lid uuid; i int := 0; s record; nsug int := 0; is_svc boolean := coalesce(auth.role(),'')='service_role';
  is_bot boolean := coalesce(p_company_id IS NOT NULL AND public.accounts_bot_company() = p_company_id, false); is_asst boolean;
BEGIN
  is_asst := is_svc OR is_bot;
  IF NOT is_asst AND NOT public.sjd_ok(p_company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF p_source_ref IS NOT NULL THEN
    SELECT id INTO d FROM public.supplier_job_documents WHERE company_id=p_company_id AND source_ref=p_source_ref;
    IF d IS NOT NULL THEN RETURN jsonb_build_object('document_id',d,'duplicate',true,'suggested',0); END IF;
  END IF;
  IF is_bot AND nullif(p_doc->>'storage_path','') IS NOT NULL AND split_part(p_doc->>'storage_path','/',1) <> p_company_id::text THEN
    RAISE EXCEPTION 'storage_path must be inside your company folder' USING ERRCODE='42501'; END IF;
  INSERT INTO public.supplier_job_documents(company_id,supplier_id,supplier_name,doc_type,doc_number,po_number,doc_date,storage_path,file_name,mime_type,notes,source,source_ref,created_by)
  VALUES (p_company_id, nullif(p_doc->>'supplier_id','')::uuid, p_doc->>'supplier_name', coalesce(nullif(p_doc->>'doc_type',''),'delivery_note'),
    p_doc->>'doc_number', p_doc->>'po_number', nullif(p_doc->>'doc_date','')::date, p_doc->>'storage_path', p_doc->>'file_name', p_doc->>'mime_type', p_doc->>'notes',
    CASE WHEN is_asst THEN 'assistant' ELSE 'manual' END, p_source_ref, auth.uid())
  RETURNING id INTO d;
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    i := i + 1;
    INSERT INTO public.supplier_job_document_lines(document_id,company_id,line_no,description,model_number,serial_number,qty)
    VALUES (d, p_company_id, i, ln->>'description', nullif(trim(ln->>'model_number'),''), nullif(trim(ln->>'serial_number'),''), coalesce(nullif(ln->>'qty','')::numeric,1))
    RETURNING id INTO lid;
    FOR s IN SELECT * FROM public.sjd_suggest_for_model(p_company_id, ln->>'model_number') LOOP
      INSERT INTO public.supplier_job_document_links(document_id,company_id,job_id,customer_id,quote_id,line_id,status,confidence,reason,suggested_by)
      VALUES (d,p_company_id,s.job_id,s.customer_id,s.quote_id,lid,'suggested',s.confidence,s.reason||' ('||coalesce(ln->>'model_number','')||')',
              CASE WHEN is_bot THEN 'WALDA (bot)' WHEN is_svc THEN 'assistant' ELSE 'auto-match' END)
      ON CONFLICT DO NOTHING;
      nsug := nsug + 1;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('document_id',d,'duplicate',false,'suggested',nsug);
END $$;
REVOKE ALL ON FUNCTION public.sjd_ingest(uuid,jsonb,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_ingest(uuid,jsonb,jsonb,text) TO authenticated, service_role;

-- Attach a file to a doc that has none. Bot: only 'assistant' docs of its company; office/admin: any doc of its company.
-- Path must be <company_id>/<document_id>/<file>.
CREATE OR REPLACE FUNCTION public.sjd_attach_file(p_document_id uuid, p_storage_path text, p_file_name text DEFAULT NULL, p_mime_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; is_bot boolean;
BEGIN
  SELECT * INTO r FROM public.supplier_job_documents WHERE id=p_document_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  is_bot := coalesce(public.accounts_bot_company() = r.company_id, false);
  IF NOT (coalesce(public.sjd_ok(r.company_id),false) OR (is_bot AND r.source='assistant')) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  IF r.storage_path IS NOT NULL THEN RAISE EXCEPTION 'document already has a file' USING ERRCODE='42501'; END IF;
  IF p_storage_path IS NULL OR p_storage_path NOT LIKE r.company_id::text||'/'||r.id::text||'/%' OR p_storage_path LIKE '%..%' THEN
    RAISE EXCEPTION 'path must be %/%/<file>', r.company_id, r.id USING ERRCODE='42501'; END IF;
  UPDATE public.supplier_job_documents SET storage_path=p_storage_path, file_name=coalesce(p_file_name, regexp_replace(p_storage_path,'^.*/','')),
    mime_type=coalesce(p_mime_type,mime_type), updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('document_id',r.id,'storage_path',p_storage_path);
END $$;
REVOKE ALL ON FUNCTION public.sjd_attach_file(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_attach_file(uuid,text,text,text) TO authenticated;

-- Storage: bot may upload/read (no update/delete) in its own company folder of the private bucket.
DROP POLICY IF EXISTS sjd_obj_bot_read ON storage.objects;
CREATE POLICY sjd_obj_bot_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='supplier-job-docs' AND (storage.foldername(name))[1] = (public.accounts_bot_company())::text);
DROP POLICY IF EXISTS sjd_obj_bot_insert ON storage.objects;
CREATE POLICY sjd_obj_bot_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='supplier-job-docs' AND (storage.foldername(name))[1] = (public.accounts_bot_company())::text);

-- One-click disable (admin of same company or platform owner). Also bans/unbans the auth login.
CREATE OR REPLACE FUNCTION public.admin_bot_accounts() RETURNS TABLE(user_id uuid, display_name text, email text, disabled boolean, disabled_at timestamptz, last_sign_in_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT b.user_id, b.display_name, u.email::text, b.disabled, b.disabled_at, u.last_sign_in_at
  FROM public.bot_accounts b JOIN auth.users u ON u.id=b.user_id
  WHERE b.company_id = public.caller_company_id() AND NOT public.is_sales_rep(auth.uid())
    AND (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'platform_super_admin'::app_role));
$$;
CREATE OR REPLACE FUNCTION public.admin_set_bot_disabled(p_user_id uuid, p_disabled boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE co uuid;
BEGIN
  SELECT company_id INTO co FROM public.bot_accounts WHERE user_id=p_user_id;
  IF co IS NULL OR co <> public.caller_company_id() OR public.is_sales_rep(auth.uid()) OR public.is_accounts_bot(auth.uid())
     OR NOT (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'platform_super_admin'::app_role)) THEN
    RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF;
  UPDATE public.bot_accounts SET disabled=p_disabled, disabled_at=CASE WHEN p_disabled THEN now() END, disabled_by=CASE WHEN p_disabled THEN auth.uid() END WHERE user_id=p_user_id;
  UPDATE auth.users SET banned_until = CASE WHEN p_disabled THEN 'infinity'::timestamptz ELSE NULL END WHERE id=p_user_id;
  IF p_disabled THEN DELETE FROM auth.refresh_tokens WHERE user_id::text=p_user_id::text; DELETE FROM auth.sessions WHERE user_id=p_user_id; END IF;
  RETURN p_disabled;
END $$;
REVOKE ALL ON FUNCTION public.admin_bot_accounts(), public.admin_set_bot_disabled(uuid,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_bot_accounts(), public.admin_set_bot_disabled(uuid,boolean) TO authenticated;
