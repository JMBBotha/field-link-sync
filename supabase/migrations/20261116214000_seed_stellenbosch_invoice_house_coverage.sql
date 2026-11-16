-- GO-LIVE DATA SEED. Apply only when Johan says so (he chose this on 16 Nov 2026, 18:49 SAST).
-- Stellenbosch Village drafts stay whole. This file inserts coverage links and nothing else.
-- It does not change an invoice, a payment, a date, or a total.
-- 0010021 covers ERF 17528 and 17529, full system, R102,354.50 incl VAT each (2 x 102354.50 = 204709.00).
-- 0010023 covers ERF 17533, 17534, 17535 and 17536, labour extraction, R24,652.26 incl VAT each.
-- Four times R24,652.26 is R98,609.04. The draft total stays R98,609.05. The one cent is left on the invoice.
-- Lookup is by invoice number and ERF. A missing or ambiguous row stops the seed.
-- Undo: supabase/manual/20261116214000_seed_stellenbosch_invoice_house_coverage_rollback.sql

DO $seed$
DECLARE
  v_inv_before text;
  v_pay_before text;
  v_inv_after text;
  v_pay_after text;
  r record;
  v_invoice uuid;
  v_house uuid;
  v_n int;
  v_existing public.invoice_house_coverage%ROWTYPE;
  v_project constant uuid := 'b00dc016-822d-411f-bf72-26a05537018f';
BEGIN
  SELECT md5(coalesce(string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.id::text), ''))
    INTO v_inv_before
  FROM public.invoices i;
  SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id::text), ''))
    INTO v_pay_before
  FROM public.payments p;

  FOR r IN
    SELECT * FROM (VALUES
      ('0010021', '17528', 'full_system'::public.invoice_coverage_scope, 102354.50::numeric, 'Kept whole. Full system for this ERF.'),
      ('0010021', '17529', 'full_system'::public.invoice_coverage_scope, 102354.50::numeric, 'Kept whole. Full system for this ERF.'),
      ('0010023', '17533', 'labour_extraction'::public.invoice_coverage_scope, 24652.26::numeric, 'Labour extraction, kept whole. Units to be billed later.'),
      ('0010023', '17534', 'labour_extraction'::public.invoice_coverage_scope, 24652.26::numeric, 'Labour extraction, kept whole. Units to be billed later.'),
      ('0010023', '17535', 'labour_extraction'::public.invoice_coverage_scope, 24652.26::numeric, 'Labour extraction, kept whole. Units to be billed later.'),
      ('0010023', '17536', 'labour_extraction'::public.invoice_coverage_scope, 24652.26::numeric, 'Labour extraction, kept whole. Units to be billed later.')
    ) AS t(invoice_number, erf, scope, amount_incl, note)
  LOOP
    SELECT count(*) INTO v_n FROM public.invoices WHERE invoice_number = r.invoice_number;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Invoice % is missing or ambiguous (% rows with that number)', r.invoice_number, v_n;
    END IF;
    SELECT count(*) INTO v_n FROM public.invoices
    WHERE ltrim(regexp_replace(invoice_number, '\D', '', 'g'), '0')
        = ltrim(regexp_replace(r.invoice_number, '\D', '', 'g'), '0');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'Invoice % is ambiguous (% invoices share those digits)', r.invoice_number, v_n;
    END IF;
    SELECT id INTO v_invoice FROM public.invoices WHERE invoice_number = r.invoice_number;

    SELECT count(*) INTO v_n FROM public.project_houses
    WHERE ltrim(regexp_replace(house_no, '\D', '', 'g'), '0') = ltrim(r.erf, '0');
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'ERF % is missing or ambiguous (% houses)', r.erf, v_n;
    END IF;
    SELECT h.id INTO v_house FROM public.project_houses h
    WHERE ltrim(regexp_replace(h.house_no, '\D', '', 'g'), '0') = ltrim(r.erf, '0');

    IF (SELECT company_id FROM public.invoices WHERE id = v_invoice)
       IS DISTINCT FROM (SELECT company_id FROM public.project_houses WHERE id = v_house) THEN
      RAISE EXCEPTION 'Invoice % and ERF % are not in the same company', r.invoice_number, r.erf;
    END IF;
    IF (SELECT project_id FROM public.project_houses WHERE id = v_house) IS DISTINCT FROM v_project THEN
      RAISE EXCEPTION 'ERF % is not on Stellenbosch Village', r.erf;
    END IF;

    INSERT INTO public.invoice_house_coverage (invoice_id, project_house_id, scope, amount_incl, note, source_ref)
    VALUES (
      v_invoice, v_house, r.scope, r.amount_incl, r.note,
      'go-live:' || r.invoice_number || ':' || r.erf || ':' || r.scope::text
    )
    ON CONFLICT ON CONSTRAINT invoice_house_coverage_uniq DO NOTHING;

    SELECT * INTO v_existing
    FROM public.invoice_house_coverage
    WHERE invoice_id = v_invoice AND project_house_id = v_house AND scope = r.scope;
    IF v_existing.id IS NULL THEN
      RAISE EXCEPTION 'Coverage link for invoice % ERF % was not stored', r.invoice_number, r.erf;
    END IF;
    IF v_existing.amount_incl IS DISTINCT FROM r.amount_incl OR v_existing.note IS DISTINCT FROM r.note THEN
      RAISE EXCEPTION 'Coverage for invoice % ERF % already exists and does not match this seed', r.invoice_number, r.erf;
    END IF;
  END LOOP;

  SELECT md5(coalesce(string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.id::text), ''))
    INTO v_inv_after
  FROM public.invoices i;
  SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id::text), ''))
    INTO v_pay_after
  FROM public.payments p;
  IF v_inv_before IS DISTINCT FROM v_inv_after THEN
    RAISE EXCEPTION 'Seed changed invoice rows. Stopped.';
  END IF;
  IF v_pay_before IS DISTINCT FROM v_pay_after THEN
    RAISE EXCEPTION 'Seed changed payment rows. Stopped.';
  END IF;
END
$seed$;
