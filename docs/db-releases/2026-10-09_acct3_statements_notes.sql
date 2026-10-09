-- acct3: client statements (running balance + client link) and internal client notes.
-- 1) Internal client notes: author + date, archive instead of delete, never shown to clients.
CREATE TABLE IF NOT EXISTS public.customer_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  author_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by uuid
);
CREATE INDEX IF NOT EXISTS customer_notes_customer_idx ON public.customer_notes(customer_id, created_at DESC);
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_notes FROM anon;
GRANT SELECT, INSERT ON public.customer_notes TO authenticated;
-- Read: same-company members who can see the customer (customers RLS applies in the subquery); techs never.
CREATE POLICY cnotes_read ON public.customer_notes FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), company_id) AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = customer_notes.company_id));
CREATE POLICY cnotes_insert ON public.customer_notes FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND archived_at IS NULL AND public.is_company_member(auth.uid(), company_id)
              AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = customer_notes.company_id));
CREATE POLICY tech_lockdown_all ON public.customer_notes AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_field_tech_only(auth.uid())) WITH CHECK (NOT public.is_field_tech_only(auth.uid()));
CREATE POLICY p4_company_scope ON public.customer_notes AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.p4_co_ok(company_id)) WITH CHECK (public.p4_co_ok(company_id));

-- Archive (no edits, no deletes): author or office staff.
CREATE OR REPLACE FUNCTION public.archive_customer_note(p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE n public.customer_notes%ROWTYPE;
BEGIN
  SELECT * INTO n FROM public.customer_notes WHERE id = p_id;
  IF n.id IS NULL THEN RAISE EXCEPTION 'Note not found'; END IF;
  IF auth.uid() IS NULL OR public.is_field_tech_only(auth.uid()) OR n.company_id IS DISTINCT FROM public.caller_company_id() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;
  IF n.author_id <> auth.uid() AND (public.is_sales_rep(auth.uid()) OR NOT public.is_ops_user(auth.uid())) THEN
    RAISE EXCEPTION 'Only the author or office staff can archive this note' USING ERRCODE = '42501'; END IF;
  UPDATE public.customer_notes SET archived_at = now(), archived_by = auth.uid() WHERE id = p_id AND archived_at IS NULL;
END $f$;
REVOKE ALL ON FUNCTION public.archive_customer_note(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.archive_customer_note(uuid) TO authenticated;

-- 2) Statement builder (internal, no auth; not executable by API roles).
CREATE OR REPLACE FUNCTION public._customer_statement_build(p_customer uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE c public.customers%ROWTYPE; v_open numeric; v_rows jsonb; v_close numeric; s record;
BEGIN
  SELECT * INTO c FROM public.customers WHERE id = p_customer;
  IF c.id IS NULL THEN RETURN NULL; END IF;
  WITH inv AS (
    SELECT i.* FROM public.invoices i
    WHERE i.company_id IS NOT DISTINCT FROM c.company_id
      AND (i.customer_id = c.id OR (i.customer_id IS NULL AND lower(btrim(i.customer_name)) = lower(btrim(c.name))))
      AND COALESCE(i.status, 'draft') NOT IN ('draft', 'void', 'cancelled')
  ), tx AS (
    SELECT COALESCE(i.issue_date, i.created_at::date) d, 1 k, 'invoice' t, i.invoice_number ref,
           COALESCE(NULLIF(i.line_items->0->>'description', ''), 'Invoice') descr, COALESCE(i.grand_total, 0) debit, 0::numeric credit, i.id inv_id, i.created_at ts
      FROM inv i
    UNION ALL
    SELECT COALESCE(p.payment_date, p.created_at::date), 2, 'payment', inv.invoice_number,
           'Payment' || COALESCE(' (' || NULLIF(p.method, '') || ')', ''), 0, COALESCE(p.amount, 0), inv.id, p.created_at
      FROM public.payments p JOIN inv ON inv.id = p.invoice_id
     WHERE p.status IN ('paid', 'succeeded', 'completed')
    UNION ALL
    SELECT cn.issue_date, 3, 'credit_note', cn.credit_note_number,
           'Credit note on ' || inv.invoice_number || COALESCE(' — ' || NULLIF(cn.description, ''), ''), 0, cn.total, inv.id, cn.created_at
      FROM public.credit_notes cn JOIN inv ON inv.id = cn.invoice_id
     WHERE cn.status = 'issued'
  ), ord AS (
    SELECT tx.*, SUM(debit - credit) OVER (ORDER BY d, k, ts, ref ROWS UNBOUNDED PRECEDING) run FROM tx
  )
  SELECT COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d < p_from), 0),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('date', d, 'type', t, 'ref', ref, 'description', descr, 'debit', debit, 'credit', credit, 'balance', ROUND(run, 2), 'invoice_id', inv_id) ORDER BY d, k, ts, ref) FROM ord WHERE d BETWEEN p_from AND p_to), '[]'::jsonb),
         COALESCE((SELECT SUM(debit - credit) FROM tx WHERE d <= p_to), 0)
    INTO v_open, v_rows, v_close;
  SELECT company_name, physical_address, vat_number, banking_details INTO s FROM public.company_settings
   ORDER BY (company_id IS NOT DISTINCT FROM c.company_id) DESC, updated_at DESC NULLS LAST, id LIMIT 1;
  RETURN jsonb_build_object(
    'customer', jsonb_build_object('id', c.id, 'name', COALESCE(NULLIF(btrim(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), c.name),
      'company_name', c.company_name, 'address', COALESCE(c.primary_address_line1, c.address), 'vat_number', c.vat_number),
    'company', jsonb_build_object('company_name', s.company_name, 'physical_address', s.physical_address, 'vat_number', s.vat_number, 'banking_details', s.banking_details),
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'opening_balance', ROUND(v_open, 2), 'closing_balance', ROUND(v_close, 2), 'rows', v_rows);
END $f$;
REVOKE ALL ON FUNCTION public._customer_statement_build(uuid, date, date) FROM public, anon, authenticated;

-- Office-only statement (admins/dispatch; not sales reps, not techs; own company).
CREATE OR REPLACE FUNCTION public.customer_statement(p_customer uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.customers WHERE id = p_customer;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  PERFORM public._acct_office_check(v_co);
  RETURN public._customer_statement_build(p_customer, COALESCE(p_from, (CURRENT_DATE - interval '12 months')::date), COALESCE(p_to, CURRENT_DATE));
END $f$;
REVOKE ALL ON FUNCTION public.customer_statement(uuid, date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.customer_statement(uuid, date, date) TO authenticated;

-- 3) Client statement links (a link the office copies and shares itself; nothing is sent).
CREATE TABLE IF NOT EXISTS public.statement_links (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  revoked_at timestamptz
);
ALTER TABLE public.statement_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.statement_links FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_statement_link(p_customer uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_co uuid; v_tok uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.customers WHERE id = p_customer;
  IF v_co IS NULL THEN RAISE EXCEPTION 'Customer not found'; END IF;
  PERFORM public._acct_office_check(v_co);
  SELECT token INTO v_tok FROM public.statement_links
   WHERE customer_id = p_customer AND revoked_at IS NULL AND expires_at > now() + interval '7 days' ORDER BY created_at DESC LIMIT 1;
  IF v_tok IS NULL THEN
    INSERT INTO public.statement_links(company_id, customer_id, created_by) VALUES (v_co, p_customer, auth.uid()) RETURNING token INTO v_tok;
  END IF;
  RETURN v_tok;
END $f$;
REVOKE ALL ON FUNCTION public.create_statement_link(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_statement_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_statement_links(p_customer uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_co uuid; n integer;
BEGIN
  SELECT company_id INTO v_co FROM public.customers WHERE id = p_customer;
  PERFORM public._acct_office_check(v_co);
  UPDATE public.statement_links SET revoked_at = now() WHERE customer_id = p_customer AND revoked_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.revoke_statement_links(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.revoke_statement_links(uuid) TO authenticated;

-- Public (token) statement: last 12 months; no internal notes, no internal ids beyond what the client sees.
CREATE OR REPLACE FUNCTION public.get_public_statement(p_token uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE l public.statement_links%ROWTYPE; r jsonb;
BEGIN
  IF p_token IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO l FROM public.statement_links WHERE token = p_token AND revoked_at IS NULL AND expires_at > now();
  IF l.token IS NULL THEN RETURN NULL; END IF;
  r := public._customer_statement_build(l.customer_id, (CURRENT_DATE - interval '12 months')::date, CURRENT_DATE);
  r := jsonb_set(r, '{customer}', (r->'customer') - 'id');
  r := jsonb_set(r, '{rows}', COALESCE((SELECT jsonb_agg(x - 'invoice_id') FROM jsonb_array_elements(r->'rows') x), '[]'::jsonb));
  RETURN r || jsonb_build_object('expires_at', l.expires_at);
END $f$;
GRANT EXECUTE ON FUNCTION public.get_public_statement(uuid) TO anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.customer_notes FROM authenticated, anon;
