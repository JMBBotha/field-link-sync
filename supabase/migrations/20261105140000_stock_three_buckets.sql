-- Phase 1 stock receiving: WALDA three buckets (5 Nov 2026). NOT applied by this change.
-- Accounting invariants (do not relax):
--  1. stock_movements is append-only. receive / allocate / use / adjust each insert a row. Never UPDATE or DELETE.
--  2. Receipt lines store cost excl VAT (unit_cost_excl) and vat_amount. Supplier cost is not granted to client or tech reads.
--  3. Materials use a weighted average (material_avg_cost). Units keep the actual cost on stock_units (one row per physical unit).
--  4. material_allowances: job type and/or unit size, item, qty, effective dates. Tech close posts one use at the current average.
--  5. A stock count snapshots system qty and posts one adjust per item that differs, with a reason. Past movements stay.
--  6. stock_value_as_of(company, timestamp) and job_stock_cost are the as-of value and the job cost (units + materials).
--  7. A unit is job-received OR moved general → job. Never both. Enforced on insert.
--  8. supplier_doc_bank_links is an empty M:N stub for bank line ↔ supplier document recon. No payments are written.
--  9. WALDA reads via walda_read_accounting. Adjustments she wants are propose_change('stock_adjust'); an admin posts the movement.
-- Company scope: every new table has company_id. Mutations are admin (_cf_ok) except tech serial confirm and allowance post
-- for an assigned tech. inventory_stock was dropped in 0031; this ledger does not revive it.
-- cf_stock_items.qty_on_hand stays the cash-health cache. The ledger is the accounting balance.
-- Rollback: supabase/rollbacks/20261105140000_stock_three_buckets_rollback.sql

-- ---------- receipt VAT + bucket (supplier docs are already office-only via sjd_ok) ----------
ALTER TABLE public.supplier_job_document_lines
  ADD COLUMN IF NOT EXISTS vat_rate numeric,
  ADD COLUMN IF NOT EXISTS vat_amount numeric,
  ADD COLUMN IF NOT EXISTS receive_bucket text;

ALTER TABLE public.supplier_job_document_lines
  DROP CONSTRAINT IF EXISTS supplier_job_document_lines_receive_bucket_chk;
ALTER TABLE public.supplier_job_document_lines
  ADD CONSTRAINT supplier_job_document_lines_receive_bucket_chk
  CHECK (receive_bucket IS NULL OR receive_bucket IN ('material_pool','job_unit','general_unit'));

COMMENT ON COLUMN public.supplier_job_document_lines.unit_cost_excl IS
  'Supplier cost excl VAT per purchased pack. Office/admin and WALDA only (sjd_ok / walda_read). Never selected on client or tech screens.';
COMMENT ON COLUMN public.supplier_job_document_lines.vat_amount IS
  'VAT amount for the line (qty × unit cost excl × rate). Same visibility as unit_cost_excl.';

-- ---------- physical units (actual cost, one path onto a job) ----------
CREATE TABLE IF NOT EXISTS public.stock_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES public.cf_stock_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  supplier_code text,
  half text CHECK (half IS NULL OR half IN ('indoor','outdoor')),
  serial_no text,
  origin text NOT NULL CHECK (origin IN ('job_received','general_stock')),
  received_job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  unit_cost_excl numeric NOT NULL CHECK (unit_cost_excl >= 0),
  vat_amount numeric,
  supplier_document_id uuid REFERENCES public.supplier_job_documents(id) ON DELETE RESTRICT,
  supplier_document_line_id uuid REFERENCES public.supplier_job_document_lines(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (origin = 'job_received' AND received_job_id IS NOT NULL)
    OR (origin = 'general_stock' AND received_job_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS stock_units_company_idx ON public.stock_units(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS stock_units_job_idx ON public.stock_units(received_job_id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_units_serial_uq
  ON public.stock_units(company_id, lower(serial_no))
  WHERE serial_no IS NOT NULL AND length(trim(serial_no)) > 0;
COMMENT ON TABLE public.stock_units IS
  'One physical unit. origin is fixed: job_received (booked to that job on the invoice) or general_stock (later allocated). Actual cost, not an average.';

-- ---------- append-only ledger ----------
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('receive','allocate','use','adjust')),
  bucket text NOT NULL CHECK (bucket IN ('material_pool','job_unit','general_unit')),
  stock_item_id uuid REFERENCES public.cf_stock_items(id) ON DELETE RESTRICT,
  product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  item_label text NOT NULL,
  qty numeric NOT NULL,
  unit_cost_excl numeric NOT NULL,
  vat_amount numeric,
  job_id uuid REFERENCES public.jobs(id) ON DELETE RESTRICT,
  supplier_document_id uuid REFERENCES public.supplier_job_documents(id) ON DELETE RESTRICT,
  supplier_document_line_id uuid REFERENCES public.supplier_job_document_lines(id) ON DELETE RESTRICT,
  serial_no text,
  unit_id uuid REFERENCES public.stock_units(id) ON DELETE RESTRICT,
  reason text,
  allowance_id uuid,
  count_line_id uuid,
  transfer_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'adjust' OR (reason IS NOT NULL AND length(trim(reason)) > 0)),
  CHECK (kind <> 'receive' OR supplier_document_id IS NOT NULL),
  CHECK (NOT (kind = 'receive' AND bucket = 'material_pool' AND job_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS stock_movements_company_at ON public.stock_movements(company_id, created_at);
CREATE INDEX IF NOT EXISTS stock_movements_item ON public.stock_movements(stock_item_id, bucket, created_at);
CREATE INDEX IF NOT EXISTS stock_movements_job ON public.stock_movements(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS stock_movements_unit ON public.stock_movements(unit_id) WHERE unit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_allowance_once
  ON public.stock_movements(job_id, allowance_id)
  WHERE kind = 'use' AND allowance_id IS NOT NULL AND job_id IS NOT NULL;
COMMENT ON TABLE public.stock_movements IS
  'Append-only. qty is signed: receive +, use −, adjust = counted − system, allocate is a pair (general −1, job +1) sharing transfer_id. unit_cost_excl is the cost at posting: receipt cost, average at use, or actual serial cost.';

-- ---------- allowances (stubs are inactive until WALDA fills qty) ----------
CREATE TABLE IF NOT EXISTS public.material_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  job_type text,
  unit_size text,
  product_id uuid REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  item_label text NOT NULL,
  stock_unit text NOT NULL DEFAULT 'each' CHECK (stock_unit IN ('each','m','kg','l','roll')),
  qty numeric NOT NULL DEFAULT 0 CHECK (qty >= 0),
  rate_note text,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CHECK (job_type IS NOT NULL OR unit_size IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS material_allowances_company ON public.material_allowances(company_id, active, effective_from);
COMMENT ON TABLE public.material_allowances IS
  'Standard install allowance per job type and/or unit size (BTU). qty is per installed system. Inactive stubs are not costed. WALDA fills qty; posting uses the materials-pool average, not a rate stored here.';

-- ---------- monthly count ----------
CREATE TABLE IF NOT EXISTS public.stock_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  counted_on date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  posted_by uuid
);
CREATE INDEX IF NOT EXISTS stock_counts_company ON public.stock_counts(company_id, counted_on DESC);

CREATE TABLE IF NOT EXISTS public.stock_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  stock_item_id uuid NOT NULL REFERENCES public.cf_stock_items(id) ON DELETE RESTRICT,
  bucket text NOT NULL CHECK (bucket IN ('material_pool','job_unit','general_unit')),
  system_qty numeric NOT NULL,
  counted_qty numeric NOT NULL CHECK (counted_qty >= 0),
  reason text,
  movement_id uuid,
  UNIQUE (count_id, stock_item_id, bucket)
);
CREATE INDEX IF NOT EXISTS stock_count_lines_count ON public.stock_count_lines(count_id);

-- ---------- bank line ↔ supplier document (stub, unused) ----------
CREATE TABLE IF NOT EXISTS public.supplier_doc_bank_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  supplier_document_id uuid NOT NULL REFERENCES public.supplier_job_documents(id) ON DELETE CASCADE,
  bank_line_id uuid,
  amount_excl numeric,
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS supplier_doc_bank_links_doc ON public.supplier_doc_bank_links(supplier_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_doc_bank_links_pair
  ON public.supplier_doc_bank_links(supplier_document_id, bank_line_id)
  WHERE bank_line_id IS NOT NULL;
COMMENT ON TABLE public.supplier_doc_bank_links IS
  'Stub for later recon: many bank lines can pay many supplier documents. Phase 1 does not insert rows and does not create payments. bank_line_id FK is added when bank_lines exists.';

DO $$ BEGIN
  IF to_regclass('public.bank_lines') IS NOT NULL THEN
    ALTER TABLE public.supplier_doc_bank_links
      DROP CONSTRAINT IF EXISTS supplier_doc_bank_links_bank_line_fkey;
    ALTER TABLE public.supplier_doc_bank_links
      ADD CONSTRAINT supplier_doc_bank_links_bank_line_fkey
      FOREIGN KEY (bank_line_id) REFERENCES public.bank_lines(id) ON DELETE SET NULL;
  END IF;
END $$;

-- allowance_id / count_line_id FKs after both tables exist
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_allowance_fkey;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_allowance_fkey
  FOREIGN KEY (allowance_id) REFERENCES public.material_allowances(id) ON DELETE RESTRICT;
ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_count_line_fkey;
ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_count_line_fkey
  FOREIGN KEY (count_line_id) REFERENCES public.stock_count_lines(id) ON DELETE RESTRICT;

-- ---------- guards ----------
CREATE OR REPLACE FUNCTION public.stock_units_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.origin IS DISTINCT FROM OLD.origin
    OR NEW.received_job_id IS DISTINCT FROM OLD.received_job_id
    OR NEW.unit_cost_excl IS DISTINCT FROM OLD.unit_cost_excl
    OR NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.stock_item_id IS DISTINCT FROM OLD.stock_item_id
  ) THEN
    RAISE EXCEPTION 'Unit origin and cost are fixed once the unit is received';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_units_guard ON public.stock_units;
CREATE TRIGGER stock_units_guard BEFORE UPDATE ON public.stock_units
  FOR EACH ROW EXECUTE FUNCTION public.stock_units_guard();

CREATE OR REPLACE FUNCTION public.stock_movements_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_origin text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'stock_movements are append-only';
  END IF;
  IF NEW.kind = 'receive' AND NEW.bucket = 'material_pool' AND NEW.job_id IS NOT NULL THEN
    RAISE EXCEPTION 'Materials are received into the pool, not onto a job';
  END IF;
  IF NEW.unit_id IS NOT NULL AND NEW.kind IN ('receive','allocate') THEN
    SELECT origin INTO v_origin FROM public.stock_units WHERE id = NEW.unit_id;
    IF NEW.kind = 'receive' AND NEW.bucket = 'job_unit' AND v_origin IS DISTINCT FROM 'job_received' THEN
      RAISE EXCEPTION 'A general-stock unit cannot also be received against a job';
    END IF;
    IF NEW.kind = 'receive' AND NEW.bucket = 'general_unit' AND v_origin IS DISTINCT FROM 'general_stock' THEN
      RAISE EXCEPTION 'A job-received unit cannot also be received into general stock';
    END IF;
    IF NEW.kind = 'allocate' AND v_origin IS DISTINCT FROM 'general_stock' THEN
      RAISE EXCEPTION 'This unit was received against a job and cannot also be moved from general stock';
    END IF;
    IF NEW.kind = 'allocate' AND NEW.bucket = 'job_unit' AND NEW.qty > 0 AND EXISTS (
      SELECT 1 FROM public.stock_movements m
       WHERE m.unit_id = NEW.unit_id AND m.kind = 'receive' AND m.bucket = 'job_unit'
    ) THEN
      RAISE EXCEPTION 'This unit was received against a job and cannot also be moved from general stock';
    END IF;
    IF NEW.kind = 'allocate' AND NEW.bucket = 'job_unit' AND NEW.qty > 0 AND EXISTS (
      SELECT 1 FROM public.stock_movements m
       WHERE m.unit_id = NEW.unit_id AND m.kind = 'allocate' AND m.bucket = 'job_unit' AND m.qty > 0
    ) THEN
      RAISE EXCEPTION 'This unit is already on a job';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS stock_movements_guard ON public.stock_movements;
CREATE TRIGGER stock_movements_guard BEFORE INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.stock_movements_guard();

-- ---------- RLS: admin of that company; WALDA has no direct table access ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['stock_units','stock_movements','material_allowances','stock_counts','stock_count_lines','supplier_doc_bank_links'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, PUBLIC', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin', t);
    IF t IN ('stock_movements','stock_units') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public._cf_ok(company_id))', t || '_admin', t);
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public._cf_ok(company_id)) WITH CHECK (public._cf_ok(company_id))', t || '_admin', t);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END IF;
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    IF to_regprocedure('public.is_accounts_bot(uuid)') IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS zz_no_accounts_bot ON public.%I', t);
      EXECUTE format('CREATE POLICY zz_no_accounts_bot ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT (SELECT public.is_accounts_bot())) WITH CHECK (NOT (SELECT public.is_accounts_bot()))', t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._stock_accounts_ok(p_company uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bot boolean := false; v_co uuid;
BEGIN
  IF p_company IS NULL THEN RETURN false; END IF;
  IF to_regprocedure('public.is_accounts_bot(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_accounts_bot(auth.uid())' INTO v_bot;
  END IF;
  IF coalesce(v_bot, false) THEN
    IF to_regprocedure('public.accounts_bot_company()') IS NULL THEN RETURN false; END IF;
    EXECUTE 'SELECT public.accounts_bot_company()' INTO v_co;
    RETURN v_co IS NOT DISTINCT FROM p_company;
  END IF;
  RETURN public._cf_ok(p_company);
END $$;
REVOKE ALL ON FUNCTION public._stock_accounts_ok(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._stock_reject_bot() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bot boolean := false;
BEGIN
  IF to_regprocedure('public.is_accounts_bot(uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT public.is_accounts_bot(auth.uid())' INTO v_bot;
  END IF;
  IF coalesce(v_bot, false) THEN
    RAISE EXCEPTION 'WALDA can read stock and propose an adjustment. An admin posts it.' USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._stock_reject_bot() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._stock_move(
  p_company uuid, p_kind text, p_bucket text, p_item uuid, p_product uuid, p_label text,
  p_qty numeric, p_cost numeric, p_vat numeric, p_job uuid, p_doc uuid, p_line uuid,
  p_serial text, p_unit uuid, p_reason text, p_allowance uuid, p_count_line uuid, p_transfer uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.stock_movements (
    company_id, kind, bucket, stock_item_id, product_id, item_label, qty, unit_cost_excl, vat_amount,
    job_id, supplier_document_id, supplier_document_line_id, serial_no, unit_id, reason, allowance_id, count_line_id, transfer_id, created_by
  ) VALUES (
    p_company, p_kind, p_bucket, p_item, p_product, left(coalesce(nullif(trim(p_label),''), 'Item'), 160),
    p_qty, coalesce(p_cost, 0), p_vat, p_job, p_doc, p_line, nullif(trim(p_serial), ''), p_unit,
    nullif(trim(p_reason), ''), p_allowance, p_count_line, p_transfer, auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public._stock_move(uuid,text,text,uuid,uuid,text,numeric,numeric,numeric,uuid,uuid,uuid,text,uuid,text,uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- Weighted average of the materials pool for one item, as at p_as_of.
-- sum(qty × cost at posting) / sum(qty). Uses at the then-average cancel out, so this stays the average.
CREATE OR REPLACE FUNCTION public.material_avg_cost(p_item uuid, p_as_of timestamptz DEFAULT now())
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN coalesce(sum(qty), 0) > 0 THEN round(sum(qty * unit_cost_excl) / sum(qty), 4)
    ELSE (
      SELECT m.unit_cost_excl FROM public.stock_movements m
       WHERE m.stock_item_id = p_item AND m.bucket = 'material_pool' AND m.created_at <= coalesce(p_as_of, now())
       ORDER BY m.created_at DESC LIMIT 1
    )
  END
  FROM public.stock_movements
  WHERE stock_item_id = p_item AND bucket = 'material_pool' AND created_at <= coalesce(p_as_of, now());
$$;
REVOKE ALL ON FUNCTION public.material_avg_cost(uuid, timestamptz) FROM PUBLIC, anon;

-- 9000 / 12000 / 18000 / 24000 / 36000 from a model code (FCMI-24, FCMI24, 24000, 24K).
CREATE OR REPLACE FUNCTION public.stock_unit_size_key(p_code text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_code IS NULL OR length(trim(p_code)) = 0 THEN NULL
    WHEN upper(p_code) ~ '(^|[^0-9])36000([^0-9]|$)' OR upper(p_code) ~ '(^|[^0-9])36([^0-9]|$)' THEN '36000'
    WHEN upper(p_code) ~ '(^|[^0-9])24000([^0-9]|$)' OR upper(p_code) ~ '(^|[^0-9])24([^0-9]|$)' THEN '24000'
    WHEN upper(p_code) ~ '(^|[^0-9])18000([^0-9]|$)' OR upper(p_code) ~ '(^|[^0-9])18([^0-9]|$)' THEN '18000'
    WHEN upper(p_code) ~ '(^|[^0-9])12000([^0-9]|$)' OR upper(p_code) ~ '(^|[^0-9])12([^0-9]|$)' THEN '12000'
    WHEN upper(p_code) ~ '(^|[^0-9])9000([^0-9]|$)' OR upper(p_code) ~ '(^|[^0-9])9([^0-9]|$)' THEN '9000'
    ELSE NULL
  END
$$;

-- Invoice adds stock. Delivery note records cost, VAT, bucket and (for a job unit) the Projects line. No movement until the invoice.
CREATE OR REPLACE FUNCTION public.sjd_receive(p_document uuid, p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.supplier_job_documents; ln jsonb; l public.supplier_job_document_lines; s public.cf_stock_items;
  v_inv boolean; v_action text; v_job uuid; v_pack numeric; v_qty numeric; v_cost numeric; v_unit_cost numeric; v_com uuid; v_free numeric; v_pair numeric;
  v_bucket text; v_ptype text; v_vat_rate numeric; v_vat numeric; v_half text; v_serial text; v_code text;
  v_n int; v_i int; v_unit uuid; v_one text; v_part numeric;
  n_stock int := 0; n_res int := 0; n_inst int := 0; n_skip int := 0; n_done int := 0; out jsonb := '[]'::jsonb; v_msg text;
BEGIN
  PERFORM public._stock_reject_bot();
  SELECT * INTO d FROM public.supplier_job_documents WHERE id = p_document FOR UPDATE;
  IF d.id IS NULL OR NOT public._cf_ok(d.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  v_inv := d.doc_type = 'supplier_invoice';
  IF d.doc_type NOT IN ('supplier_invoice','delivery_note') THEN RAISE EXCEPTION 'Only delivery notes and supplier invoices can be received'; END IF;

  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.supplier_job_document_lines WHERE id = (ln->>'line_id')::uuid AND document_id = d.id FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Line % is not on this document', ln->>'line_id'; END IF;
    IF l.received_at IS NOT NULL THEN n_done := n_done + 1; CONTINUE; END IF;
    v_action := coalesce(ln->>'action','skip');
    v_job := nullif(ln->>'job_id','')::uuid;
    v_ptype := NULL;
    IF nullif(ln->>'product_id','') IS NOT NULL THEN
      SELECT product_type INTO v_ptype FROM public.supplier_products WHERE id = (ln->>'product_id')::uuid;
    END IF;
    v_bucket := nullif(ln->>'bucket','');
    IF v_bucket IS NOT NULL AND v_bucket NOT IN ('material_pool','job_unit','general_unit') THEN
      RAISE EXCEPTION 'Line %: unknown bucket', l.line_no;
    END IF;
    IF v_bucket IS NULL THEN
      IF v_action IN ('reserve','installed') THEN
        v_bucket := CASE WHEN v_ptype = 'ac_unit' OR (v_ptype IS NULL AND coalesce(ln->>'stock_unit','each') = 'each') THEN 'job_unit' ELSE 'material_pool' END;
      ELSIF v_action = 'stock' THEN
        v_bucket := CASE WHEN v_ptype = 'ac_unit' THEN 'general_unit' ELSE 'material_pool' END;
      END IF;
    END IF;
    IF v_ptype IS NOT NULL AND v_ptype IS DISTINCT FROM 'ac_unit' THEN v_bucket := 'material_pool'; END IF;
    IF coalesce(ln->>'stock_unit','each') <> 'each' AND v_ptype IS DISTINCT FROM 'ac_unit' THEN v_bucket := 'material_pool'; END IF;
    IF v_bucket = 'material_pool' THEN
      v_job := NULL;
      IF v_action IN ('reserve','installed') THEN v_action := 'stock'; END IF;
    ELSIF v_bucket = 'general_unit' THEN
      v_job := NULL;
      IF v_action <> 'skip' THEN v_action := 'stock'; END IF;
    ELSIF v_bucket = 'job_unit' AND v_action = 'stock' THEN
      v_action := 'reserve';
    END IF;
    IF v_action IN ('reserve','installed') THEN
      IF v_job IS NULL OR NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = v_job AND company_id = d.company_id) THEN
        RAISE EXCEPTION 'Line %: pick a job of this company', l.line_no;
      END IF;
    END IF;

    v_pack := coalesce(nullif(ln->>'pack_size','')::numeric, 1);
    v_qty  := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_pack, 3);
    v_cost := nullif(ln->>'unit_cost_pack','')::numeric;
    v_unit_cost := CASE WHEN v_cost IS NULL THEN NULL ELSE round(v_cost / v_pack, 4) END;
    v_vat_rate := coalesce(nullif(ln->>'vat_rate','')::numeric, 15);
    IF v_vat_rate < 0 OR v_vat_rate > 30 THEN v_vat_rate := 15; END IF;
    v_vat := nullif(ln->>'vat_amount','')::numeric;
    IF v_vat IS NULL AND v_cost IS NOT NULL THEN
      v_vat := round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1) * v_cost * v_vat_rate / 100.0, 2);
    END IF;
    v_code := upper(regexp_replace(coalesce(ln->>'model_code', l.model_number, ''), '[^A-Za-z0-9]', '', 'g'));
    v_half := nullif(ln->>'half','');
    IF v_half IS NOT NULL AND v_half NOT IN ('indoor','outdoor') THEN v_half := NULL; END IF;
    IF v_half IS NULL AND v_bucket IN ('job_unit','general_unit') THEN
      v_half := CASE
        WHEN v_code ~ '^AR[0-9].*[A-Z]X$' THEN 'outdoor'
        WHEN v_code ~ '^AR[0-9].*[A-Z]N$' THEN 'indoor'
        WHEN v_code ~ '[0-9]X$' THEN 'outdoor'
        WHEN v_ptype = 'ac_unit' THEN 'indoor'
        ELSE NULL
      END;
    END IF;
    v_serial := nullif(trim(coalesce(ln->>'serial_no', l.serial_number)), '');

    IF v_action = 'reserve' THEN
      SELECT round(sum(c), 4) INTO v_pair FROM (
        SELECT DISTINCT ON (coalesce(nullif(l2.model_number,''), l2.id::text))
               nullif(x->>'unit_cost_pack','')::numeric / coalesce(nullif(x->>'pack_size','')::numeric, 1) AS c
        FROM jsonb_array_elements(p_lines) x
        JOIN public.supplier_job_document_lines l2 ON l2.id = (x->>'line_id')::uuid AND l2.document_id = d.id
        WHERE x->>'action' = 'reserve' AND x->>'job_id' = ln->>'job_id' AND x->>'product_id' = ln->>'product_id'
        ORDER BY coalesce(nullif(l2.model_number,''), l2.id::text), l2.line_no) h;
      IF v_pair IS NULL OR nullif(ln->>'product_id','') IS NULL THEN v_pair := v_unit_cost; END IF;
    END IF;
    s := NULL; v_msg := NULL;

    IF v_action = 'skip' THEN n_skip := n_skip + 1;
    ELSIF v_action = 'installed' THEN
      INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by)
      VALUES (d.company_id, v_job, left(coalesce(ln->>'item', l.description, l.model_number,'Item'),160), v_qty, NULL, false, 0,
              'Supplied direct: ' || coalesce(d.doc_number, 'supplier doc'), auth.uid());
      n_inst := n_inst + 1;
    ELSIF NOT v_inv THEN
      IF v_action = 'reserve' AND v_bucket = 'job_unit' THEN
        PERFORM public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1), v_pair, l.id, d.supplier_name);
        n_res := n_res + 1;
      ELSE
        v_action := 'pending'; n_stock := n_stock + 1;
      END IF;
      v_qty := 0;
    ELSE
      s := public._stock_item_for(d.company_id, nullif(ln->>'product_id','')::uuid, ln->>'model_code', coalesce(ln->>'item', l.description), ln->>'stock_unit', v_pack);
      UPDATE public.cf_stock_items SET
        unit_cost_excl = CASE
          WHEN v_bucket <> 'material_pool' THEN CASE WHEN v_unit_cost IS NULL THEN unit_cost_excl ELSE v_unit_cost END
          WHEN v_unit_cost IS NULL THEN unit_cost_excl
          WHEN qty_on_hand + v_qty <= 0 THEN v_unit_cost
          ELSE round((qty_on_hand * coalesce(unit_cost_excl,0) + v_qty * v_unit_cost) / (qty_on_hand + v_qty), 4) END,
        qty_on_hand = qty_on_hand + v_qty, last_received_at = now(), updated_at = now()
      WHERE id = s.id;
      n_stock := n_stock + 1;
      IF v_action = 'reserve' AND v_bucket = 'job_unit' THEN
        v_com := public._reserve_commitment(v_job, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', ln->>'item'), v_qty, v_pair, l.id, d.supplier_name);
        v_free := least(v_qty, (SELECT c.qty - coalesce((SELECT sum(a.qty) FROM public.cf_stock_allocations a WHERE a.commitment_id = c.id AND a.drawn_at IS NULL),0)
                                 FROM public.cf_commitments c WHERE c.id = v_com));
        IF v_free > 0 AND (SELECT status FROM public.cf_commitments WHERE id = v_com) <> 'installed' THEN
          PERFORM public.cf_allocate_stock(v_com, s.id, v_free);
        ELSE v_msg := 'Projects line already covered or installed: left in free stock'; END IF;
        n_res := n_res + 1;
      END IF;

      IF v_bucket IN ('job_unit','general_unit') THEN
        v_n := greatest(1, round(coalesce(nullif(ln->>'qty_packs','')::numeric, l.qty, 1))::int);
        IF v_n > 50 THEN RAISE EXCEPTION 'Line %: receive at most 50 units on one line', l.line_no; END IF;
        FOR v_i IN 1..v_n LOOP
          v_one := CASE
            WHEN v_n = 1 THEN v_serial
            WHEN v_serial IS NULL THEN NULL
            ELSE nullif(trim((string_to_array(v_serial, ','))[v_i]), '')
          END;
          v_part := CASE WHEN v_vat IS NULL OR v_n = 0 THEN NULL ELSE round(v_vat / v_n, 2) END;
          INSERT INTO public.stock_units (
            company_id, stock_item_id, product_id, supplier_code, half, serial_no, origin, received_job_id,
            unit_cost_excl, vat_amount, supplier_document_id, supplier_document_line_id
          ) VALUES (
            d.company_id, s.id, nullif(ln->>'product_id','')::uuid, coalesce(ln->>'model_code', l.model_number), v_half, v_one,
            CASE WHEN v_bucket = 'job_unit' THEN 'job_received' ELSE 'general_stock' END,
            CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END,
            coalesce(v_unit_cost, 0), v_part, d.id, l.id
          ) RETURNING id INTO v_unit;
          PERFORM public._stock_move(
            d.company_id, 'receive', v_bucket, s.id, nullif(ln->>'product_id','')::uuid,
            coalesce(ln->>'item', l.description, ln->>'model_code'), 1, coalesce(v_unit_cost, 0), v_part,
            CASE WHEN v_bucket = 'job_unit' THEN v_job ELSE NULL END, d.id, l.id, v_one, v_unit, NULL, NULL, NULL, NULL);
        END LOOP;
      ELSIF v_bucket = 'material_pool' THEN
        PERFORM public._stock_move(
          d.company_id, 'receive', 'material_pool', s.id, nullif(ln->>'product_id','')::uuid,
          coalesce(ln->>'item', l.description, ln->>'model_code'), v_qty, coalesce(v_unit_cost, 0), v_vat,
          NULL, d.id, l.id, NULL, NULL, NULL, NULL, NULL, NULL);
      END IF;
    END IF;

    UPDATE public.supplier_job_document_lines SET
      product_id = nullif(ln->>'product_id','')::uuid, unit_cost_excl = v_cost, cost_source = nullif(ln->>'cost_source',''),
      receive_action = v_action, receive_job_id = v_job, receive_bucket = v_bucket,
      stock_item_id = s.id, stock_qty = CASE WHEN v_inv AND v_action IN ('stock','reserve') THEN v_qty ELSE 0 END,
      vat_rate = v_vat_rate, vat_amount = v_vat,
      price_flag = nullif(ln->>'price_flag',''), price_note = concat_ws(' · ', nullif(ln->>'price_note',''), v_msg),
      received_at = now(), received_by = auth.uid()
    WHERE id = l.id;
    out := out || jsonb_build_object('line_id', l.id, 'action', v_action, 'bucket', v_bucket, 'stock_item_id', s.id, 'stock_qty', v_qty, 'vat_amount', v_vat, 'note', v_msg);
  END LOOP;
  RETURN jsonb_build_object('stocked', n_stock, 'reserved', n_res, 'installed', n_inst, 'skipped', n_skip, 'already_received', n_done, 'lines', out);
END $$;
REVOKE ALL ON FUNCTION public.sjd_receive(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sjd_receive(uuid, jsonb) TO authenticated;

-- ---------- move a general-stock unit onto a job (the only other path) ----------
CREATE OR REPLACE FUNCTION public.stock_assign_unit(p_unit uuid, p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.stock_units; j record; v_transfer uuid := gen_random_uuid(); v_com uuid; v_label text;
BEGIN
  PERFORM public._stock_reject_bot();
  SELECT * INTO u FROM public.stock_units WHERE id = p_unit FOR UPDATE;
  IF u.id IS NULL OR NOT public._cf_ok(u.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL OR j.company_id IS DISTINCT FROM u.company_id THEN RAISE EXCEPTION 'Pick a job of this company'; END IF;
  IF u.origin IS DISTINCT FROM 'general_stock' THEN
    RAISE EXCEPTION 'This unit was received against a job and cannot also be moved from general stock';
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.unit_id = u.id AND m.kind = 'allocate' AND m.bucket = 'job_unit' AND m.qty > 0) THEN
    RAISE EXCEPTION 'This unit is already on a job';
  END IF;
  v_label := coalesce(u.supplier_code, 'Unit');
  PERFORM public._stock_move(u.company_id, 'allocate', 'general_unit', u.stock_item_id, u.product_id, v_label,
    -1, u.unit_cost_excl, NULL, p_job, u.supplier_document_id, u.supplier_document_line_id, u.serial_no, u.id,
    'Moved from general stock', NULL, NULL, v_transfer);
  PERFORM public._stock_move(u.company_id, 'allocate', 'job_unit', u.stock_item_id, u.product_id, v_label,
    1, u.unit_cost_excl, NULL, p_job, u.supplier_document_id, u.supplier_document_line_id, u.serial_no, u.id,
    'Moved from general stock', NULL, NULL, v_transfer);
  v_com := public._reserve_commitment(p_job, u.product_id, v_label, 1, u.unit_cost_excl, coalesce(u.supplier_document_line_id, u.id), NULL);
  IF v_com IS NOT NULL AND (SELECT status FROM public.cf_commitments WHERE id = v_com) IS DISTINCT FROM 'installed' THEN
    BEGIN
      PERFORM public.cf_allocate_stock(v_com, u.stock_item_id, 1);
    EXCEPTION WHEN OTHERS THEN
      -- Projects line may already be covered. The ledger move still stands.
      NULL;
    END;
  END IF;
  RETURN jsonb_build_object('unit_id', u.id, 'job_id', p_job, 'transfer_id', v_transfer);
END $$;
REVOKE ALL ON FUNCTION public.stock_assign_unit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_assign_unit(uuid, uuid) TO authenticated;

-- ---------- allowances on tech close ----------
CREATE OR REPLACE FUNCTION public.job_apply_material_allowances(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j record; r record; v_item uuid; v_avg numeric; v_qty numeric; v_label text; v_id uuid;
  n_post int := 0; n_already int := 0; n_skip int := 0; v_on date := CURRENT_DATE;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id, quote_id, job_type INTO j FROM public.jobs WHERE id = p_job;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;

  FOR r IN
    WITH units AS (
      SELECT public.stock_unit_size_key(coalesce(su.supplier_code, sp.product_code, sp.name)) AS size, su.half, 1::numeric AS n
        FROM public.stock_units su
        LEFT JOIN public.supplier_products sp ON sp.id = su.product_id
       WHERE su.company_id = j.company_id AND (
         su.received_job_id = p_job
         OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.unit_id = su.id AND m.job_id = p_job AND m.bucket = 'job_unit' AND m.kind = 'allocate' AND m.qty > 0)
       )
    ),
    sized AS (
      SELECT size,
             CASE WHEN coalesce(sum(n) FILTER (WHERE half IS NOT NULL), 0) > 0
                  THEN greatest(coalesce(sum(n) FILTER (WHERE half = 'indoor'), 0), coalesce(sum(n) FILTER (WHERE half = 'outdoor'), 0))
                  ELSE coalesce(sum(n), 0) END AS systems
        FROM units WHERE size IS NOT NULL GROUP BY size
    ),
    quoted AS (
      SELECT public.stock_unit_size_key(coalesce(sp.product_code, sp.name, qi.item_name)) AS size,
             sum(coalesce(qi.quantity, 0)) AS systems
        FROM public.quote_items qi
        LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
       WHERE j.quote_id IS NOT NULL AND qi.quote_id = j.quote_id AND sp.product_type = 'ac_unit'
       GROUP BY 1
    ),
    systems AS (
      SELECT * FROM sized
      UNION ALL
      SELECT q.size, q.systems FROM quoted q
       WHERE NOT EXISTS (SELECT 1 FROM sized) AND q.size IS NOT NULL
    )
    SELECT a.id AS allowance_id, a.product_id, a.item_label, a.qty * s.systems AS use_qty, s.systems
      FROM systems s
      JOIN public.material_allowances a ON a.company_id = j.company_id AND a.active AND a.qty > 0
       AND a.effective_from <= v_on AND (a.effective_to IS NULL OR a.effective_to >= v_on)
       AND a.unit_size = s.size
       AND (a.job_type IS NULL OR j.job_type IS NULL OR a.job_type = j.job_type)
     WHERE s.systems > 0
    UNION ALL
    SELECT a.id, a.product_id, a.item_label, a.qty * t.systems, t.systems
      FROM (SELECT coalesce(sum(systems), 0) AS systems FROM systems) t
      JOIN public.material_allowances a ON a.company_id = j.company_id AND a.active AND a.qty > 0
       AND a.unit_size IS NULL AND a.job_type IS NOT NULL AND a.job_type = j.job_type
       AND a.effective_from <= v_on AND (a.effective_to IS NULL OR a.effective_to >= v_on)
     WHERE t.systems > 0
  LOOP
    IF EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.job_id = p_job AND m.allowance_id = r.allowance_id AND m.kind = 'use') THEN
      n_already := n_already + 1; CONTINUE;
    END IF;
    SELECT s.id INTO v_item FROM public.cf_stock_items s
     WHERE s.company_id = j.company_id AND s.active
       AND ((r.product_id IS NOT NULL AND s.product_id = r.product_id) OR upper(s.item) = upper(r.item_label))
     ORDER BY (s.product_id IS NOT DISTINCT FROM r.product_id) DESC, s.created_at LIMIT 1;
    v_avg := CASE WHEN v_item IS NULL THEN NULL ELSE public.material_avg_cost(v_item, now()) END;
    IF v_item IS NULL OR v_avg IS NULL THEN n_skip := n_skip + 1; CONTINUE; END IF;
    v_qty := round(r.use_qty, 3);
    IF v_qty <= 0 THEN n_skip := n_skip + 1; CONTINUE; END IF;
    v_label := r.item_label;
    v_id := public._stock_move(j.company_id, 'use', 'material_pool', v_item, r.product_id, v_label,
      -v_qty, v_avg, NULL, p_job, NULL, NULL, NULL, NULL, 'Install allowance', r.allowance_id, NULL, NULL);
    UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - v_qty), updated_at = now() WHERE id = v_item;
    n_post := n_post + 1;
  END LOOP;
  RETURN jsonb_build_object('posted', n_post, 'already', n_already, 'skipped', n_skip);
END $$;
REVOKE ALL ON FUNCTION public.job_apply_material_allowances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_apply_material_allowances(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_allowance_on_complete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    BEGIN
      PERFORM public.job_apply_material_allowances(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'material allowance not posted for job %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.stock_allowance_on_complete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stock_allowance_on_complete ON public.jobs;
CREATE TRIGGER stock_allowance_on_complete AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.stock_allowance_on_complete();

-- Tech confirm: serial only. No cost in the payload.
CREATE OR REPLACE FUNCTION public.job_units_for_tech(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE j record;
BEGIN
  IF NOT public._job_stock_ok(p_job) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id, company_id INTO j FROM public.jobs WHERE id = p_job;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', su.id, 'half', su.half, 'supplier_code', su.supplier_code, 'serial_no', su.serial_no,
      'label', coalesce(su.supplier_code, 'Unit')) ORDER BY su.half NULLS LAST, su.created_at)
    FROM public.stock_units su
    WHERE su.company_id = j.company_id AND (
      su.received_job_id = p_job
      OR EXISTS (SELECT 1 FROM public.stock_movements m WHERE m.unit_id = su.id AND m.job_id = p_job AND m.bucket = 'job_unit' AND m.kind = 'allocate' AND m.qty > 0)
    )
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.job_units_for_tech(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_units_for_tech(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.job_confirm_unit_serial(p_unit uuid, p_serial text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u public.stock_units; v_serial text := nullif(trim(p_serial), '');
BEGIN
  SELECT * INTO u FROM public.stock_units WHERE id = p_unit FOR UPDATE;
  IF u.id IS NULL THEN RAISE EXCEPTION 'Unit not found' USING ERRCODE = '42501'; END IF;
  IF NOT public._cf_ok(u.company_id) AND NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.company_id = u.company_id AND public._job_stock_ok(j.id) AND (
      j.id = u.received_job_id OR EXISTS (
        SELECT 1 FROM public.stock_movements m WHERE m.unit_id = u.id AND m.job_id = j.id AND m.bucket = 'job_unit' AND m.kind = 'allocate' AND m.qty > 0))
  ) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF v_serial IS NULL THEN RAISE EXCEPTION 'Serial number needed'; END IF;
  UPDATE public.stock_units SET serial_no = v_serial WHERE id = u.id;
  RETURN jsonb_build_object('id', u.id, 'serial_no', v_serial, 'half', u.half, 'supplier_code', u.supplier_code);
END $$;
REVOKE ALL ON FUNCTION public.job_confirm_unit_serial(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_confirm_unit_serial(uuid, text) TO authenticated;

-- ---------- value + job cost ----------
CREATE OR REPLACE FUNCTION public.stock_value_as_of(p_company uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (bucket text, stock_item_id uuid, item_label text, qty numeric, value_excl numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._stock_accounts_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT m.bucket, m.stock_item_id, max(m.item_label), round(sum(m.qty), 3), round(sum(m.qty * m.unit_cost_excl), 2)
    FROM public.stock_movements m
   WHERE m.company_id = p_company AND m.created_at <= coalesce(p_as_of, now())
   GROUP BY m.bucket, m.stock_item_id
   ORDER BY m.bucket, max(m.item_label);
END $$;
REVOKE ALL ON FUNCTION public.stock_value_as_of(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_value_as_of(uuid, timestamptz) TO authenticated;

CREATE OR REPLACE VIEW public.stock_value_by_bucket
WITH (security_invoker = true) AS
SELECT company_id, bucket, stock_item_id,
       max(item_label) AS item_label,
       round(sum(qty), 3) AS qty,
       round(sum(qty * unit_cost_excl), 2) AS value_excl
  FROM public.stock_movements
 GROUP BY company_id, bucket, stock_item_id;
REVOKE ALL ON public.stock_value_by_bucket FROM anon, PUBLIC;
GRANT SELECT ON public.stock_value_by_bucket TO authenticated;

CREATE OR REPLACE VIEW public.job_stock_cost
WITH (security_invoker = true) AS
SELECT company_id, job_id,
  round(coalesce(sum(qty * unit_cost_excl) FILTER (WHERE bucket = 'job_unit' AND kind IN ('receive','allocate') AND qty > 0), 0), 2) AS unit_cost_excl,
  round(coalesce(sum(-qty * unit_cost_excl) FILTER (WHERE bucket = 'material_pool' AND kind = 'use' AND allowance_id IS NOT NULL), 0), 2) AS material_cost_excl
  FROM public.stock_movements
 WHERE job_id IS NOT NULL
 GROUP BY company_id, job_id;
REVOKE ALL ON public.job_stock_cost FROM anon, PUBLIC;
GRANT SELECT ON public.job_stock_cost TO authenticated;
COMMENT ON VIEW public.job_stock_cost IS
  'Job cost excl VAT: actual serial cost of units received or moved onto the job, plus allowance uses. Hidden from techs and clients by stock_movements RLS.';

CREATE OR REPLACE FUNCTION public.stock_on_hand(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'stock_item_id', stock_item_id, 'item_label', item_label, 'qty', qty, 'value_excl', value_excl)
      ORDER BY bucket, item_label)
    FROM public.stock_value_as_of(p_company, now())
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.stock_on_hand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_on_hand(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_general_units(p_company uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', su.id, 'supplier_code', su.supplier_code, 'half', su.half, 'serial_no', su.serial_no)
      ORDER BY su.supplier_code, su.half)
    FROM public.stock_units su
    WHERE su.company_id = p_company AND su.origin = 'general_stock'
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_movements m
         WHERE m.unit_id = su.id AND m.kind = 'allocate' AND m.bucket = 'job_unit' AND m.qty > 0)
  ), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.stock_general_units(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_general_units(uuid) TO authenticated;

-- ---------- count → one adjust per item, with a reason ----------
CREATE OR REPLACE FUNCTION public.stock_post_adjust(
  p_company uuid, p_stock_item uuid, p_bucket text, p_qty numeric, p_reason text, p_count_line uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.cf_stock_items; v_cost numeric; v_id uuid;
BEGIN
  PERFORM public._stock_reject_bot();
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_bucket NOT IN ('material_pool','job_unit','general_unit') THEN RAISE EXCEPTION 'Unknown bucket'; END IF;
  IF coalesce(p_qty, 0) = 0 THEN RAISE EXCEPTION 'Adjustment quantity cannot be zero'; END IF;
  IF coalesce(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'An adjustment needs a reason'; END IF;
  SELECT * INTO s FROM public.cf_stock_items WHERE id = p_stock_item AND company_id = p_company FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Stock item not found'; END IF;
  IF p_bucket = 'material_pool' THEN
    v_cost := coalesce(public.material_avg_cost(s.id, now()), s.unit_cost_excl, 0);
  ELSE
    SELECT m.unit_cost_excl INTO v_cost FROM public.stock_movements m
     WHERE m.stock_item_id = s.id AND m.bucket = p_bucket AND m.kind = 'receive'
     ORDER BY m.created_at DESC LIMIT 1;
    v_cost := coalesce(v_cost, s.unit_cost_excl, 0);
  END IF;
  v_id := public._stock_move(p_company, 'adjust', p_bucket, s.id, s.product_id, s.item,
    p_qty, v_cost, NULL, NULL, NULL, NULL, NULL, NULL, p_reason, NULL, p_count_line, NULL);
  UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand + p_qty), last_counted_at = now(), updated_at = now() WHERE id = s.id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.stock_post_adjust(uuid, uuid, text, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_post_adjust(uuid, uuid, text, numeric, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_count_save(p_company uuid, p_counted_on date, p_lines jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; ln jsonb; v_sys numeric; v_item uuid; v_bucket text;
BEGIN
  PERFORM public._stock_reject_bot();
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.stock_counts (company_id, counted_on, status, created_by)
  VALUES (p_company, coalesce(p_counted_on, CURRENT_DATE), 'draft', auth.uid()) RETURNING id INTO v_id;
  FOR ln IN SELECT * FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) LOOP
    v_item := (ln->>'stock_item_id')::uuid;
    v_bucket := ln->>'bucket';
    IF NOT EXISTS (SELECT 1 FROM public.cf_stock_items WHERE id = v_item AND company_id = p_company) THEN
      RAISE EXCEPTION 'Stock item is not in this company';
    END IF;
    SELECT coalesce(sum(m.qty), 0) INTO v_sys FROM public.stock_movements m
     WHERE m.company_id = p_company AND m.stock_item_id = v_item AND m.bucket = v_bucket;
    INSERT INTO public.stock_count_lines (count_id, company_id, stock_item_id, bucket, system_qty, counted_qty, reason)
    VALUES (v_id, p_company, v_item, v_bucket, round(v_sys, 3), round((ln->>'counted_qty')::numeric, 3), nullif(trim(ln->>'reason'), ''));
  END LOOP;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.stock_count_save(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_count_save(uuid, date, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.stock_count_post(p_count uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.stock_counts; ln public.stock_count_lines; v_delta numeric; v_move uuid; n int := 0;
BEGIN
  PERFORM public._stock_reject_bot();
  SELECT * INTO c FROM public.stock_counts WHERE id = p_count FOR UPDATE;
  IF c.id IS NULL OR NOT public._cf_ok(c.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF c.status = 'posted' THEN
    RETURN jsonb_build_object('count_id', c.id, 'posted', 0, 'already', true);
  END IF;
  FOR ln IN SELECT * FROM public.stock_count_lines WHERE count_id = c.id FOR UPDATE LOOP
    v_delta := round(ln.counted_qty - ln.system_qty, 3);
    IF v_delta = 0 THEN CONTINUE; END IF;
    IF coalesce(trim(ln.reason), '') = '' THEN
      RAISE EXCEPTION 'A reason is required where the count differs (% )', ln.bucket;
    END IF;
    v_move := public.stock_post_adjust(c.company_id, ln.stock_item_id, ln.bucket, v_delta, ln.reason, ln.id);
    UPDATE public.stock_count_lines SET movement_id = v_move WHERE id = ln.id;
    n := n + 1;
  END LOOP;
  UPDATE public.stock_counts SET status = 'posted', posted_at = now(), posted_by = auth.uid() WHERE id = c.id;
  RETURN jsonb_build_object('count_id', c.id, 'posted', n, 'already', false);
END $$;
REVOKE ALL ON FUNCTION public.stock_count_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_count_post(uuid) TO authenticated;

-- Inactive stubs. An admin runs this for their own company. Nothing is costed until a row is active and qty > 0.
CREATE OR REPLACE FUNCTION public.material_allowance_seed_stubs(p_company uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  PERFORM public._stock_reject_bot();
  IF NOT public._cf_ok(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.material_allowances (company_id, job_type, unit_size, item_label, stock_unit, qty, rate_note, effective_from, active)
  SELECT p_company, 'install', s.size, s.item, s.unit, 0,
    'Stub only. WALDA to fill the qty (and the catalogue item) before this allowance costs a job. Leave inactive until then.',
    CURRENT_DATE, false
  FROM (VALUES
    ('9000','Copper pair','m'), ('12000','Copper pair','m'), ('18000','Copper pair','m'), ('24000','Copper pair','m'),
    ('9000','Trunking','m'), ('12000','Trunking','m'), ('18000','Trunking','m'), ('24000','Trunking','m'),
    ('9000','Drain pipe','m'), ('12000','Drain pipe','m'), ('18000','Drain pipe','m'), ('24000','Drain pipe','m'),
    ('9000','Brackets','each'), ('12000','Brackets','each'), ('18000','Brackets','each'), ('24000','Brackets','each'),
    ('9000','Refrigerant gas','kg'), ('12000','Refrigerant gas','kg'), ('18000','Refrigerant gas','kg'), ('24000','Refrigerant gas','kg')
  ) AS s(size, item, unit)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.material_allowances a
     WHERE a.company_id = p_company AND a.job_type = 'install' AND a.unit_size = s.size AND a.item_label = s.item);
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.material_allowances (company_id, job_type, unit_size, item_label, stock_unit, qty, rate_note, effective_from, active)
  SELECT p_company, 'service', NULL, 'Refrigerant gas', 'kg', 0,
    'Stub only. WALDA to fill the qty before a service close costs gas. Leave inactive until then.',
    CURRENT_DATE, false
  WHERE NOT EXISTS (
    SELECT 1 FROM public.material_allowances a
     WHERE a.company_id = p_company AND a.job_type = 'service' AND a.unit_size IS NULL AND a.item_label = 'Refrigerant gas');
  IF FOUND THEN n := n + 1; END IF;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.material_allowance_seed_stubs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.material_allowance_seed_stubs(uuid) TO authenticated;

-- WALDA read and stock_adjust approval live in 20261105141000_stock_walda_read.sql
-- so this file can load before bot_proposed_changes exists (tests). Apply both.
