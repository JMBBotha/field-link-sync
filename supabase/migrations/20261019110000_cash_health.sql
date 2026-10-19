-- Cash-flow health phase 1 (Johan 19 Oct 2026): 13-week forecast, expected receipts per invoice part,
-- project commitments at supplier cost, stock on hand + stock-take + allocation, overheads, manual bank
-- balances, VAT settings. Owner/management only via public._cf_ok (same rule as /admin/cashflow:
-- admin role, never techs or sales reps). Hidden behind cf_settings.enabled (default false).
-- Supplier cost = list x unit_cost_factor (0.80). Any extra supplier discount is never stored.

-- ---------- tables ----------
CREATE TABLE IF NOT EXISTS public.cf_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  buffer_mode text NOT NULL DEFAULT 'overheads_month' CHECK (buffer_mode IN ('overheads_month','fixed')),
  buffer_amount numeric NOT NULL DEFAULT 0 CHECK (buffer_amount >= 0),
  unit_cost_factor numeric NOT NULL DEFAULT 0.8 CHECK (unit_cost_factor > 0 AND unit_cost_factor <= 1.5),
  default_leeway_days integer NOT NULL DEFAULT 7 CHECK (default_leeway_days BETWEEN 0 AND 120),
  conf_sent integer NOT NULL DEFAULT 90 CHECK (conf_sent BETWEEN 0 AND 100),
  conf_overdue integer NOT NULL DEFAULT 70 CHECK (conf_overdue BETWEEN 0 AND 100),
  conf_draft integer NOT NULL DEFAULT 60 CHECK (conf_draft BETWEEN 0 AND 100),
  conf_final_before_install integer NOT NULL DEFAULT 50 CHECK (conf_final_before_install BETWEEN 0 AND 100),
  vat_number text,
  vat_basis text NOT NULL DEFAULT 'invoice' CHECK (vat_basis IN ('invoice','payment')),
  vat_period_months integer NOT NULL DEFAULT 2 CHECK (vat_period_months IN (1,2,4,6,12)),
  vat_period_end date,               -- end of the current (or any) VAT period; others step by vat_period_months
  vat_due_day integer NOT NULL DEFAULT 25 CHECK (vat_due_day BETWEEN 1 AND 28),
  vat_rate numeric NOT NULL DEFAULT 15 CHECK (vat_rate >= 0 AND vat_rate <= 30),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cf_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (length(trim(label)) > 0),
  account_ref text,
  include boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_bank_accounts_company ON public.cf_bank_accounts(company_id);

CREATE TABLE IF NOT EXISTS public.cf_bank_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.cf_bank_accounts(id) ON DELETE CASCADE,
  balance numeric NOT NULL,
  as_of date NOT NULL DEFAULT current_date,
  entered_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_bank_balances_acc ON public.cf_bank_balances(account_id, as_of DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cf_overheads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  category text NOT NULL DEFAULT 'other',
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  frequency text NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','monthly','annual','once')),
  pay_day integer CHECK (pay_day IS NULL OR pay_day BETWEEN 1 AND 31), -- weekly: 1=Mon..7=Sun; monthly: day of month
  pay_date date,                     -- annual / once
  start_date date,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_overheads_company ON public.cf_overheads(company_id);

CREATE TABLE IF NOT EXISTS public.cf_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('field_lynk','manual','freshbooks')),
  source_key text,                   -- inv:<id>:<part> | q:<id>:<part>; null for manual rows
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
  ref text NOT NULL DEFAULT '',
  client text,
  part text NOT NULL DEFAULT 'full' CHECK (part IN ('deposit','progress','final','full')),
  amount_incl numeric NOT NULL DEFAULT 0 CHECK (amount_incl >= 0),
  vat_incl numeric NOT NULL DEFAULT 0 CHECK (vat_incl >= 0),
  expected_date date,
  leeway_days integer NOT NULL DEFAULT 7 CHECK (leeway_days BETWEEN 0 AND 120),
  confidence integer NOT NULL DEFAULT 60 CHECK (confidence BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','received','written_off')),
  received_date date,
  received_amount numeric,
  dates_edited boolean NOT NULL DEFAULT false,
  conf_edited boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_key)
);
CREATE INDEX IF NOT EXISTS cf_receipts_company ON public.cf_receipts(company_id, expected_date);

CREATE TABLE IF NOT EXISTS public.cf_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  source_key text,                   -- inv:<id>:<line> | po:<item id> | q:<quote item id>; null for manual rows
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  project text NOT NULL DEFAULT '',
  item text NOT NULL CHECK (length(trim(item)) > 0),
  kind text NOT NULL DEFAULT 'unit' CHECK (kind IN ('unit','material','other')),
  qty numeric NOT NULL DEFAULT 1 CHECK (qty > 0),
  supplier text,
  unit_cost_excl numeric NOT NULL DEFAULT 0 CHECK (unit_cost_excl >= 0),
  vat_rate numeric NOT NULL DEFAULT 15,
  status text NOT NULL DEFAULT 'needed' CHECK (status IN ('needed','ordered_paid','in_stock','installed')),
  pay_date date,
  edited boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, source_key)
);
CREATE INDEX IF NOT EXISTS cf_commitments_company ON public.cf_commitments(company_id, status);

CREATE TABLE IF NOT EXISTS public.cf_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (length(trim(item)) > 0),
  model_code text,
  qty_on_hand numeric NOT NULL DEFAULT 0 CHECK (qty_on_hand >= 0),
  unit_cost_excl numeric NOT NULL DEFAULT 0 CHECK (unit_cost_excl >= 0),
  location text,
  last_counted_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_stock_items_company ON public.cf_stock_items(company_id);

CREATE TABLE IF NOT EXISTS public.cf_stock_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES public.cf_stock_items(id) ON DELETE CASCADE,
  commitment_id uuid NOT NULL REFERENCES public.cf_commitments(id) ON DELETE CASCADE,
  qty numeric NOT NULL CHECK (qty > 0),
  drawn_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cf_stock_alloc_item ON public.cf_stock_allocations(stock_item_id);
CREATE INDEX IF NOT EXISTS cf_stock_alloc_commit ON public.cf_stock_allocations(commitment_id);

-- ---------- RLS: owner/management of that company only ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cf_settings','cf_bank_accounts','cf_bank_balances','cf_overheads','cf_receipts','cf_commitments','cf_stock_items','cf_stock_allocations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_mgmt', t);
    IF t = 'cf_stock_allocations' THEN
      -- allocations change only through cf_allocate_stock / cf_unallocate_stock (keeps stock maths consistent)
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public._cf_ok(company_id))', t || '_mgmt', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id))', t || '_mgmt', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- enabled flag is switched by the platform only (SQL), never from the browser
CREATE OR REPLACE FUNCTION public._cf_settings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN NEW.enabled := false;
    ELSIF NEW.enabled IS DISTINCT FROM OLD.enabled THEN NEW.enabled := OLD.enabled; END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cf_settings_guard ON public.cf_settings;
CREATE TRIGGER cf_settings_guard BEFORE INSERT OR UPDATE ON public.cf_settings FOR EACH ROW EXECUTE FUNCTION public._cf_settings_guard();

-- touch updated_at; user edits of dates / confidence / cost stick (sync won't overwrite them)
CREATE OR REPLACE FUNCTION public._cf_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL AND TG_OP = 'UPDATE' AND coalesce(current_setting('cf.sync', true), '') <> '1' THEN
    IF TG_TABLE_NAME = 'cf_receipts' THEN
      IF NEW.expected_date IS DISTINCT FROM OLD.expected_date OR NEW.leeway_days IS DISTINCT FROM OLD.leeway_days THEN NEW.dates_edited := true; END IF;
      IF NEW.confidence IS DISTINCT FROM OLD.confidence THEN NEW.conf_edited := true; END IF;
    ELSIF TG_TABLE_NAME = 'cf_commitments' THEN
      IF NEW.unit_cost_excl IS DISTINCT FROM OLD.unit_cost_excl OR NEW.qty IS DISTINCT FROM OLD.qty
         OR NEW.pay_date IS DISTINCT FROM OLD.pay_date OR NEW.supplier IS DISTINCT FROM OLD.supplier THEN NEW.edited := true; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cf_overheads','cf_receipts','cf_commitments','cf_stock_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_touch', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._cf_touch()', t || '_touch', t);
  END LOOP;
END $$;

-- installed -> draw allocated stock down; back from installed -> put it back
CREATE OR REPLACE FUNCTION public._cf_commitment_drawdown() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record;
BEGIN
  IF NEW.status = 'installed' AND OLD.status IS DISTINCT FROM 'installed' THEN
    FOR a IN SELECT * FROM public.cf_stock_allocations WHERE commitment_id = NEW.id AND drawn_at IS NULL FOR UPDATE LOOP
      UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - a.qty), updated_at = now() WHERE id = a.stock_item_id;
      UPDATE public.cf_stock_allocations SET drawn_at = now() WHERE id = a.id;
    END LOOP;
  ELSIF OLD.status = 'installed' AND NEW.status IS DISTINCT FROM 'installed' THEN
    FOR a IN SELECT * FROM public.cf_stock_allocations WHERE commitment_id = NEW.id AND drawn_at IS NOT NULL FOR UPDATE LOOP
      UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand + a.qty, updated_at = now() WHERE id = a.stock_item_id;
      UPDATE public.cf_stock_allocations SET drawn_at = NULL WHERE id = a.id;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._cf_commitment_drawdown() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS cf_commitment_drawdown ON public.cf_commitments;
CREATE TRIGGER cf_commitment_drawdown AFTER UPDATE OF status ON public.cf_commitments FOR EACH ROW EXECUTE FUNCTION public._cf_commitment_drawdown();

-- ---------- sync from Field Lynk invoices / POs / accepted quotes ----------
CREATE OR REPLACE FUNCTION public._cf_sync_core(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.cf_settings; inv record; q record; ln record; poi record;
  v_paid numeric; v_left numeric; v_dep numeric; v_parts jsonb; pt jsonb; v_amt numeric; v_rec boolean;
  v_job_id uuid; v_job_date date; v_job_done boolean; v_base date; v_exp date; v_conf int; v_part text;
  v_dep_date date; v_has_po boolean; v_cost numeric; v_ord int; v_qty numeric; v_terms int;
  n_rec int := 0; n_com int := 0; v_vat numeric; v_dep_pct numeric; v_label text;
BEGIN
  PERFORM set_config('cf.sync', '1', true);
  INSERT INTO public.cf_settings (company_id, vat_number)
    VALUES (p_company, (SELECT cs.vat_number FROM public.company_settings cs WHERE cs.company_id = p_company ORDER BY cs.is_primary DESC NULLS LAST LIMIT 1))
    ON CONFLICT (company_id) DO NOTHING;
  SELECT * INTO s FROM public.cf_settings WHERE company_id = p_company;
  SELECT coalesce(max(cs.default_payment_terms_days), 0), coalesce(max(cs.default_deposit_percentage), 70)
    INTO v_terms, v_dep_pct FROM public.company_settings cs WHERE cs.company_id = p_company;

  -- void invoices: drop their synced rows
  DELETE FROM public.cf_receipts r USING public.invoices i WHERE r.company_id = p_company AND r.invoice_id = i.id AND r.source = 'field_lynk' AND i.status IN ('void','cancelled');
  DELETE FROM public.cf_commitments c USING public.invoices i WHERE c.company_id = p_company AND c.invoice_id = i.id AND c.source_key IS NOT NULL AND c.status = 'needed' AND i.status IN ('void','cancelled');

  FOR inv IN
    SELECT i.*, coalesce((SELECT sum(p.amount) FROM public.payments p WHERE p.invoice_id = i.id AND coalesce(p.status,'paid') IN ('paid','completed','succeeded')), 0) AS paid_sum,
      (SELECT max(p.payment_date) FROM public.payments p WHERE p.invoice_id = i.id AND coalesce(p.status,'paid') IN ('paid','completed','succeeded')) AS last_paid
    FROM public.invoices i
    WHERE i.company_id = p_company AND i.status NOT IN ('void','cancelled')
      AND (i.status <> 'paid'
        OR EXISTS (SELECT 1 FROM public.jobs j WHERE (j.invoice_id = i.id OR (i.quote_id IS NOT NULL AND j.quote_id = i.quote_id)) AND j.status NOT IN ('completed','cancelled'))
        OR EXISTS (SELECT 1 FROM public.cf_receipts r WHERE r.invoice_id = i.id AND r.status = 'expected'))
  LOOP
    SELECT j.id, (j.scheduled_for AT TIME ZONE 'Africa/Johannesburg')::date, false INTO v_job_id, v_job_date, v_job_done
      FROM public.jobs j WHERE (j.invoice_id = inv.id OR (inv.quote_id IS NOT NULL AND j.quote_id = inv.quote_id)) AND j.status NOT IN ('completed','cancelled')
      ORDER BY j.scheduled_for NULLS LAST LIMIT 1;
    IF v_job_id IS NULL THEN
      v_job_done := EXISTS (SELECT 1 FROM public.jobs j WHERE (j.invoice_id = inv.id OR (inv.quote_id IS NOT NULL AND j.quote_id = inv.quote_id)) AND j.status = 'completed');
    END IF;

    v_label := coalesce(inv.invoice_number,'') || ' ' || coalesce(
      (SELECT nullif(trim(split_part(x->>'description', E'\n', 1)),'') FROM jsonb_array_elements(coalesce(inv.line_items,'[]'::jsonb)) x
        WHERE coalesce((x->>'amount')::numeric,0) = 0 AND coalesce(x->>'description','') ~* 'house|unit|site|block|flat|room' LIMIT 1),
      inv.customer_name, '');
    v_dep := CASE WHEN coalesce(inv.deposit_amount,0) > 0 AND inv.deposit_amount < inv.grand_total - 0.01 THEN round(inv.deposit_amount, 2) END;
    v_parts := CASE WHEN v_dep IS NULL THEN jsonb_build_array(jsonb_build_object('part','full','amt',inv.grand_total))
      ELSE jsonb_build_array(jsonb_build_object('part','deposit','amt',v_dep), jsonb_build_object('part','final','amt',round(inv.grand_total - v_dep, 2))) END;
    v_left := inv.paid_sum;
    v_base := CASE WHEN inv.status = 'draft' THEN current_date + 7 ELSE coalesce(inv.due_date, inv.issue_date + 7, current_date + 7) END;
    v_dep_date := NULL;

    FOR pt IN SELECT * FROM jsonb_array_elements(v_parts) LOOP
      v_part := pt->>'part'; v_amt := (pt->>'amt')::numeric;
      v_rec := v_left >= v_amt - 0.01; v_left := greatest(0, v_left - v_amt);
      v_exp := CASE WHEN v_part = 'final' THEN coalesce(v_job_date + v_terms, v_base + 30) ELSE v_base END;
      v_conf := CASE WHEN v_rec THEN 100
        WHEN v_part = 'final' AND NOT coalesce(v_job_done, false) THEN s.conf_final_before_install
        WHEN inv.status = 'draft' THEN s.conf_draft
        WHEN v_exp < current_date THEN s.conf_overdue ELSE s.conf_sent END;
      v_vat := CASE WHEN inv.grand_total > 0 THEN round(coalesce(inv.tax_amount,0) * v_amt / inv.grand_total, 2) ELSE 0 END;
      INSERT INTO public.cf_receipts AS r (company_id, source, source_key, invoice_id, quote_id, ref, client, part, amount_incl, vat_incl, expected_date, leeway_days, confidence, status, received_date, received_amount)
      VALUES (p_company, 'field_lynk', 'inv:' || inv.id || ':' || v_part, inv.id, inv.quote_id, coalesce(inv.invoice_number,''), inv.customer_name, v_part, v_amt, v_vat, v_exp, s.default_leeway_days, v_conf,
              CASE WHEN v_rec THEN 'received' ELSE 'expected' END, CASE WHEN v_rec THEN coalesce(inv.last_paid, inv.paid_date, current_date) END, CASE WHEN v_rec THEN v_amt END)
      ON CONFLICT (company_id, source_key) DO UPDATE SET
        amount_incl = excluded.amount_incl, vat_incl = excluded.vat_incl, ref = excluded.ref, client = excluded.client,
        status = CASE WHEN excluded.status = 'received' THEN 'received' WHEN r.status = 'received' THEN 'expected' ELSE r.status END,
        received_date = CASE WHEN excluded.status = 'received' THEN coalesce(r.received_date, excluded.received_date) END,
        received_amount = CASE WHEN excluded.status = 'received' THEN excluded.received_amount END,
        expected_date = CASE WHEN r.dates_edited THEN r.expected_date ELSE excluded.expected_date END,
        confidence = CASE WHEN excluded.status = 'received' THEN 100 WHEN r.conf_edited THEN r.confidence ELSE excluded.confidence END;
      n_rec := n_rec + 1;
      IF v_part IN ('deposit','full') THEN
        SELECT CASE WHEN r.status = 'received' THEN current_date ELSE r.expected_date END INTO v_dep_date FROM public.cf_receipts r
          WHERE r.company_id = p_company AND r.source_key = 'inv:' || inv.id || ':' || v_part;
      END IF;
    END LOOP;

    -- commitments: units still to buy (skip invoices whose install is done)
    IF NOT (v_job_id IS NULL AND coalesce(v_job_done,false)) THEN
      v_has_po := EXISTS (SELECT 1 FROM public.purchase_orders po WHERE po.invoice_id = inv.id AND po.status <> 'cancelled');
      IF v_has_po THEN
        FOR poi IN SELECT it.*, po.status AS po_status, coalesce(sp.trading_name, sp.name) AS sup_name
          FROM public.purchase_order_items it JOIN public.purchase_orders po ON po.id = it.po_id LEFT JOIN public.suppliers sp ON sp.id = po.supplier_id
          WHERE po.invoice_id = inv.id AND po.status <> 'cancelled' LOOP
          INSERT INTO public.cf_commitments AS c (company_id, source_key, invoice_id, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
          VALUES (p_company, 'po:' || poi.id, inv.id, inv.quote_id, v_job_id, v_label,
                  coalesce(nullif(trim(poi.model_code),''), nullif(trim(poi.description),''), 'Unit'), 'unit', greatest(coalesce(poi.qty,1), 0.01), trim(poi.sup_name), coalesce(poi.unit_cost_excl_vat, 0),
                  CASE WHEN poi.po_status = 'received' THEN 'in_stock' WHEN poi.po_status IN ('ordered','sent') THEN 'ordered_paid' ELSE 'needed' END, coalesce(v_dep_date, current_date))
          ON CONFLICT (company_id, source_key) DO UPDATE SET
            job_id = coalesce(excluded.job_id, c.job_id), project = excluded.project,
            qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
            unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END,
            pay_date = CASE WHEN c.edited THEN c.pay_date ELSE excluded.pay_date END,
            status = CASE WHEN c.status = 'needed' AND excluded.status <> 'needed' THEN excluded.status
                          WHEN c.status = 'ordered_paid' AND excluded.status = 'in_stock' THEN 'in_stock' ELSE c.status END;
          n_com := n_com + 1;
        END LOOP;
        -- a PO replaces the estimate from invoice lines
        DELETE FROM public.cf_commitments c WHERE c.company_id = p_company AND c.invoice_id = inv.id AND c.source_key LIKE 'inv:%' AND c.status = 'needed'
          AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id);
      ELSE
        v_ord := 0;
        FOR ln IN SELECT x, o FROM jsonb_array_elements(coalesce(inv.line_items,'[]'::jsonb)) WITH ORDINALITY AS t(x, o) LOOP
          v_ord := ln.o;
          IF (coalesce(ln.x->>'name','') || ' ' || coalesce(ln.x->>'description','')) ~* '(btu|inverter|wall ?mounted|split|cassette|ducted|samsung|midea|daikin|\mlg\M|mitsubishi|carrier|gree|hisense|alliance)'
             AND coalesce(ln.x->>'name','') !~* '(install|labour|labor|service|regas|re-gas|removal|remove|repair|kit|pipe|bracket|isolator|travel|callout|call-out|maintenance|clean)'
             AND coalesce((ln.x->>'amount')::numeric, 0) > 0 THEN
            v_qty := greatest(coalesce(nullif(ln.x->>'quantity','')::numeric, 1), 1);
            v_cost := round(coalesce(nullif(ln.x->>'rate','')::numeric, (ln.x->>'amount')::numeric / v_qty) * s.unit_cost_factor, 2);
            INSERT INTO public.cf_commitments AS c (company_id, source_key, invoice_id, quote_id, job_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
            VALUES (p_company, 'inv:' || inv.id || ':' || v_ord, inv.id, inv.quote_id, v_job_id, v_label,
                    left(coalesce(substring(coalesce(ln.x->>'description','') from '([A-Z]{2}[0-9]{2}[A-Z0-9]+/?[A-Z]*)') || ' · ', '') || regexp_replace(coalesce(nullif(trim(ln.x->>'name'),''), 'Unit'), '^NEW\s+', '', 'i'), 120), 'unit', v_qty,
                    CASE WHEN (coalesce(ln.x->>'name','') || ' ' || coalesce(ln.x->>'description','')) ~* 'samsung' THEN 'Samsung / Fourways' ELSE NULL END, v_cost, 'needed', coalesce(v_dep_date, current_date))
            ON CONFLICT (company_id, source_key) DO UPDATE SET
              job_id = coalesce(excluded.job_id, c.job_id), project = excluded.project,
              qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
              unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END,
              pay_date = CASE WHEN c.edited THEN c.pay_date ELSE excluded.pay_date END,
              item = CASE WHEN c.edited THEN c.item ELSE excluded.item END;
            n_com := n_com + 1;
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  -- accepted quotes not invoiced yet: expected deposit/final + units at cost
  DELETE FROM public.cf_receipts r WHERE r.company_id = p_company AND r.source_key LIKE 'q:%'
    AND (EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = r.quote_id AND i.status NOT IN ('void','cancelled'))
         OR NOT EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = r.quote_id AND qq.status = 'accepted'));
  DELETE FROM public.cf_commitments c WHERE c.company_id = p_company AND c.source_key LIKE 'q:%' AND c.status = 'needed'
    AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id)
    AND (EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = c.quote_id AND i.status NOT IN ('void','cancelled'))
         OR NOT EXISTS (SELECT 1 FROM public.quotes qq WHERE qq.id = c.quote_id AND qq.status = 'accepted'));
  FOR q IN SELECT qq.* FROM public.quotes qq WHERE qq.company_id = p_company AND qq.status = 'accepted' AND coalesce(qq.is_variation, false) = false
      AND coalesce(qq.total, 0) > 0 AND qq.superseded_by IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = qq.id AND i.status NOT IN ('void','cancelled')) LOOP
    v_dep := round(q.total * v_dep_pct / 100, 2);
    v_base := greatest(current_date, coalesce((q.accepted_at AT TIME ZONE 'Africa/Johannesburg')::date, current_date) + 7);
    FOR pt IN SELECT * FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object('part','deposit','amt',v_dep), jsonb_build_object('part','final','amt',round(q.total - v_dep,2)))) LOOP
      v_part := pt->>'part'; v_amt := (pt->>'amt')::numeric;
      CONTINUE WHEN v_amt <= 0;
      INSERT INTO public.cf_receipts AS r (company_id, source, source_key, quote_id, ref, client, part, amount_incl, vat_incl, expected_date, leeway_days, confidence)
      VALUES (p_company, 'field_lynk', 'q:' || q.id || ':' || v_part, q.id, coalesce(q.quote_number,''), q.customer_name, v_part, v_amt,
              CASE WHEN q.total > 0 THEN round(coalesce(q.vat_amount,0) * v_amt / q.total, 2) ELSE 0 END,
              CASE WHEN v_part = 'final' THEN v_base + 30 ELSE v_base END, s.default_leeway_days,
              CASE WHEN v_part = 'final' THEN s.conf_final_before_install ELSE s.conf_draft END)
      ON CONFLICT (company_id, source_key) DO UPDATE SET amount_incl = excluded.amount_incl, vat_incl = excluded.vat_incl, ref = excluded.ref, client = excluded.client;
      n_rec := n_rec + 1;
    END LOOP;
    FOR ln IN SELECT qi.*, sp.cost_excl_vat AS sp_cost, sp.brand AS sp_brand, sp.product_type AS sp_type
      FROM public.quote_items qi LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
      WHERE qi.quote_id = q.id AND (sp.product_type = 'ac_unit' OR qi.item_type = 'Air Conditioning') LOOP
      INSERT INTO public.cf_commitments AS c (company_id, source_key, quote_id, project, item, kind, qty, supplier, unit_cost_excl, status, pay_date)
      VALUES (p_company, 'q:' || ln.id, q.id, coalesce(q.quote_number,'') || ' ' || coalesce(q.customer_name,''), left(coalesce(nullif(ln.item_number,''), ln.item_name, 'Unit'),120), 'unit',
              greatest(coalesce(ln.quantity,1), 0.01), coalesce(ln.supplier, ln.sp_brand),
              round(coalesce(nullif(ln.sp_cost,0), coalesce(ln.unit_price,0) * s.unit_cost_factor), 2), 'needed', v_base)
      ON CONFLICT (company_id, source_key) DO UPDATE SET
        qty = CASE WHEN c.edited THEN c.qty ELSE excluded.qty END,
        unit_cost_excl = CASE WHEN c.edited THEN c.unit_cost_excl ELSE excluded.unit_cost_excl END;
      n_com := n_com + 1;
    END LOOP;
  END LOOP;

  -- jobs completed -> units installed (allocated stock is drawn down by the trigger)
  UPDATE public.cf_commitments c SET status = 'installed'
    FROM public.jobs j WHERE c.company_id = p_company AND c.job_id = j.id AND j.status = 'completed' AND c.status <> 'installed';

  PERFORM set_config('cf.sync', '', true);
  RETURN jsonb_build_object('receipts', n_rec, 'commitments', n_com);
END $$;
REVOKE ALL ON FUNCTION public._cf_sync_core(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._cf_sync_core(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.cf_sync(p_company uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cf_sync:' || p_company::text));
  RETURN public._cf_sync_core(p_company);
END $$;
REVOKE ALL ON FUNCTION public.cf_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cf_sync(uuid) TO authenticated, service_role;

-- ---------- stock ----------
CREATE OR REPLACE FUNCTION public.cf_allocate_stock(p_commitment uuid, p_stock_item uuid, p_qty numeric) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.cf_commitments; si public.cf_stock_items; v_free numeric; v_covered numeric; v_id uuid;
BEGIN
  SELECT * INTO c FROM public.cf_commitments WHERE id = p_commitment FOR UPDATE;
  SELECT * INTO si FROM public.cf_stock_items WHERE id = p_stock_item FOR UPDATE;
  IF c.id IS NULL OR si.id IS NULL OR c.company_id <> si.company_id OR NOT public._cf_ok(c.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF c.status = 'installed' THEN RAISE EXCEPTION 'This line is already installed'; END IF;
  IF coalesce(p_qty,0) <= 0 THEN RAISE EXCEPTION 'Quantity must be more than 0'; END IF;
  v_free := si.qty_on_hand - coalesce((SELECT sum(qty) FROM public.cf_stock_allocations WHERE stock_item_id = si.id AND drawn_at IS NULL), 0);
  v_covered := coalesce((SELECT sum(qty) FROM public.cf_stock_allocations WHERE commitment_id = c.id AND drawn_at IS NULL), 0);
  IF p_qty > v_free + 0.0001 THEN RAISE EXCEPTION 'Only % free in stock', v_free; END IF;
  IF p_qty > c.qty - v_covered + 0.0001 THEN RAISE EXCEPTION 'This line only needs % more', c.qty - v_covered; END IF;
  INSERT INTO public.cf_stock_allocations (company_id, stock_item_id, commitment_id, qty) VALUES (c.company_id, si.id, c.id, p_qty) RETURNING id INTO v_id;
  IF v_covered + p_qty >= c.qty - 0.0001 AND c.status = 'needed' THEN
    UPDATE public.cf_commitments SET status = 'in_stock' WHERE id = c.id;
  END IF;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.cf_unallocate_stock(p_allocation uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.cf_stock_allocations;
BEGIN
  SELECT * INTO a FROM public.cf_stock_allocations WHERE id = p_allocation FOR UPDATE;
  IF a.id IS NULL OR NOT public._cf_ok(a.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF a.drawn_at IS NOT NULL THEN RAISE EXCEPTION 'Already installed, cannot un-allocate'; END IF;
  DELETE FROM public.cf_stock_allocations WHERE id = a.id;
  UPDATE public.cf_commitments c SET status = 'needed' WHERE c.id = a.commitment_id AND c.status = 'in_stock'
    AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations x WHERE x.commitment_id = c.id AND x.drawn_at IS NULL);
END $$;

-- stock-take: p_rows = [{id?, item, model_code, qty, unit_cost_excl, location}]; p_clean = items not in the list go to 0
CREATE OR REPLACE FUNCTION public.cf_stock_take(p_company uuid, p_rows jsonb, p_clean boolean DEFAULT false) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb; v_ids uuid[] := '{}'; v_id uuid; n int := 0;
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    CONTINUE WHEN coalesce(trim(r->>'item'),'') = '' OR nullif(r->>'qty','') IS NULL;
    IF (r->>'qty')::numeric < 0 THEN RAISE EXCEPTION 'Count cannot be negative (%)', r->>'item'; END IF;
    v_id := NULL;
    IF nullif(r->>'id','') IS NOT NULL THEN
      UPDATE public.cf_stock_items SET item = trim(r->>'item'), model_code = nullif(trim(r->>'model_code'),''), qty_on_hand = (r->>'qty')::numeric,
        unit_cost_excl = coalesce(nullif(r->>'unit_cost_excl','')::numeric, unit_cost_excl), location = nullif(trim(r->>'location'),''), last_counted_at = now(), active = true
      WHERE id = (r->>'id')::uuid AND company_id = p_company RETURNING id INTO v_id;
    END IF;
    IF v_id IS NULL THEN
      INSERT INTO public.cf_stock_items (company_id, item, model_code, qty_on_hand, unit_cost_excl, location, last_counted_at)
      VALUES (p_company, trim(r->>'item'), nullif(trim(r->>'model_code'),''), (r->>'qty')::numeric, coalesce(nullif(r->>'unit_cost_excl','')::numeric, 0), nullif(trim(r->>'location'),''), now())
      RETURNING id INTO v_id;
    END IF;
    v_ids := v_ids || v_id; n := n + 1;
  END LOOP;
  IF p_clean THEN
    UPDATE public.cf_stock_items SET qty_on_hand = 0, last_counted_at = now() WHERE company_id = p_company AND NOT (id = ANY (v_ids));
  END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.cf_allocate_stock(uuid, uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cf_unallocate_stock(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cf_stock_take(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cf_allocate_stock(uuid, uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cf_unallocate_stock(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cf_stock_take(uuid, jsonb, boolean) TO authenticated, service_role;

-- ---------- VAT actuals for a period (output on invoices / payments, input on supplier bills + expenses) ----------
CREATE OR REPLACE FUNCTION public.cf_vat_actuals(p_company uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN jsonb_build_object(
    'output_invoice', coalesce((SELECT sum(i.tax_amount) FROM public.invoices i WHERE i.company_id = p_company AND i.status NOT IN ('draft','void','cancelled')
        AND coalesce(i.issue_date, (i.sent_at AT TIME ZONE 'Africa/Johannesburg')::date) BETWEEN p_from AND p_to), 0),
    'output_payment', coalesce((SELECT sum(CASE WHEN i.grand_total > 0 THEN p.amount * i.tax_amount / i.grand_total ELSE 0 END) FROM public.payments p JOIN public.invoices i ON i.id = p.invoice_id
        WHERE i.company_id = p_company AND i.status NOT IN ('void','cancelled') AND p.payment_date BETWEEN p_from AND p_to
          AND coalesce(p.status,'paid') IN ('paid','completed','succeeded')), 0),
    'input', coalesce((SELECT sum(b.vat_amount) FROM public.supplier_bills b WHERE b.company_id = p_company AND b.status <> 'void' AND b.bill_date BETWEEN p_from AND p_to), 0)
           + coalesce((SELECT sum(e.vat_amount) FROM public.expenses e WHERE e.company_id = p_company AND coalesce(e.vat_claimable, true) AND e.archived_at IS NULL AND e.expense_date BETWEEN p_from AND p_to), 0)
  );
END $$;
REVOKE ALL ON FUNCTION public.cf_vat_actuals(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cf_vat_actuals(uuid, date, date) TO authenticated, service_role;
