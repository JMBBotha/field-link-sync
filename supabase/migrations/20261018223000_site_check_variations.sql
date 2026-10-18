-- R2 Site check + variations + Confirmed & locked (Johan 2026-10-18 22:08 + 22:10/22:14/22:17/22:24).
-- Additive: new columns default NULL/false, new tables, new functions. Existing functions changed (backups in r2/fn_*.sql):
--   tech_set_job_status (site-check gate), create_invoice_from_accepted_quote + p3_notify_quote_accepted (skip variation quotes),
--   get_public_quote (adds variation fields).

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS parent_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_variation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS variation_job_id uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS locked_reason text,
  ADD COLUMN IF NOT EXISTS variation_summary jsonb;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS site_check_status text,
  ADD COLUMN IF NOT EXISTS variation_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL;
DO $$ BEGIN
  ALTER TABLE public.jobs ADD CONSTRAINT jobs_site_check_status_check
    CHECK (site_check_status IS NULL OR site_check_status IN ('confirmed','awaiting_pricing','awaiting_client','declined'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Rates for the tech's quick-add buttons. price_excl NULL = no catalogue price yet -> the rep/Johan prices it.
CREATE TABLE IF NOT EXISTS public.variation_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  unit text NOT NULL DEFAULT 'each' CHECK (unit IN ('m','each')),
  labour_hours numeric,          -- per unit (m / each)
  labour_rate numeric,
  material_product_id uuid,
  material_price_excl numeric,   -- per unit sell
  cost_excl numeric,             -- per unit cost (labour at cost + material cost): discount floor
  price_excl numeric,            -- per unit sell excl VAT; NULL = needs pricing
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
ALTER TABLE public.variation_rates ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.job_site_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  company_id uuid,
  tech_id uuid,
  source text NOT NULL DEFAULT 'tech_app',
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL CHECK (result IN ('as_quoted','variation_needed')),
  notes text,
  variation_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_site_checks_job ON public.job_site_checks(job_id);
ALTER TABLE public.job_site_checks ENABLE ROW LEVEL SECURITY;

-- Quantity-only request as entered (no prices) + outcome. Prices live only on the variation quote.
CREATE TABLE IF NOT EXISTS public.job_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  company_id uuid,
  original_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  variation_quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  site_check_id uuid REFERENCES public.job_site_checks(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'tech_app',   -- tech_app | sam_voice (future) | office
  created_by uuid,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{code, area_id, qty}]
  unit_swaps jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{area_id, recommended_btu, note}]
  needs_pricing boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'awaiting_pricing' CHECK (status IN ('awaiting_pricing','awaiting_client','approved','declined','cancelled')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_job_variations_job ON public.job_variations(job_id);
ALTER TABLE public.job_variations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.quote_lock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid,
  action text NOT NULL CHECK (action IN ('lock','unlock')),
  reason text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_lock_events ENABLE ROW LEVEL SECURITY;

-- Company settings for charged variations (Johan 22:26/22:29: 40% goodwill discount, never below cost; no free service). threshold is on the additional work excl VAT.
CREATE TABLE IF NOT EXISTS public.variation_settings (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  threshold_excl numeric NOT NULL DEFAULT 950,      -- below this the extra work is absorbed at R0
  discount_pct numeric NOT NULL DEFAULT 40 CHECK (discount_pct >= 0 AND discount_pct <= 90),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.variation_settings ENABLE ROW LEVEL SECURITY;



-- ---------- access helpers ----------
CREATE OR REPLACE FUNCTION public.fl_is_company_office(_uid uuid, _company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT _uid IS NOT NULL AND (
    public.p4_is_platform()
    OR (public.has_role(_uid,'admin'::app_role) AND public.get_user_company_id(_uid) = public.fl_master_company_id())
    OR (_company IS NOT NULL AND _company = public.get_user_company_id(_uid)
        AND (public.has_role(_uid,'admin'::app_role) OR public.has_role(_uid,'dispatcher'::app_role)
             OR EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id=_uid AND cm.company_id=_company AND cm.role='admin')))
  ) $f$;

CREATE OR REPLACE FUNCTION public.fl_can_see_job(_uid uuid, _job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.jobs j WHERE j.id=_job AND (
    EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id=j.id AND a.profile_id=_uid AND coalesce(a.status,'')<>'rejected')
    OR public.fl_is_company_office(_uid, j.company_id))) $f$;

DROP POLICY IF EXISTS vr_office_read ON public.variation_rates;
CREATE POLICY vr_office_read ON public.variation_rates FOR SELECT TO authenticated USING (public.fl_is_company_office(auth.uid(), company_id));
DROP POLICY IF EXISTS vs_office_read ON public.variation_settings;
CREATE POLICY vs_office_read ON public.variation_settings FOR SELECT TO authenticated USING (public.fl_is_company_office(auth.uid(), company_id));
DROP POLICY IF EXISTS jsc_read ON public.job_site_checks;
CREATE POLICY jsc_read ON public.job_site_checks FOR SELECT TO authenticated USING (public.fl_can_see_job(auth.uid(), job_id));
DROP POLICY IF EXISTS jv_read ON public.job_variations;
CREATE POLICY jv_read ON public.job_variations FOR SELECT TO authenticated USING (public.fl_can_see_job(auth.uid(), job_id));
DROP POLICY IF EXISTS qle_read ON public.quote_lock_events;
CREATE POLICY qle_read ON public.quote_lock_events FOR SELECT TO authenticated USING (public.fl_is_company_office(auth.uid(), company_id));
-- No insert/update/delete policies: all writes go through the SECURITY DEFINER functions below.

-- ---------- Massair CT seed (only company whose data changes) ----------
INSERT INTO public.variation_rates (company_id, code, label, unit, labour_hours, labour_rate, material_product_id, material_price_excl, price_excl, sort_order, notes) VALUES
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_9_12k','Extra pipe run beyond 3.5 m (9-12K)','m',0.25,680,'6d2c5671-34cd-4dd7-bdaf-ffe5442cd63a',309.49,479.49,10,'Johan 21:54: 0.25 h x R680 + 1 m kit 1/4&3/8 at Massair rates (computed 21:58)'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_18k','Extra pipe run beyond 3.5 m (18K)','m',0.25,680,'ac85e463-dc7b-43ba-aad9-0e99ce79eafe',367.75,537.75,11,'kit 1/4&1/2'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_24k','Extra pipe run beyond 3.5 m (24K)','m',0.25,680,'22dac567-dce2-4f7f-a756-3dd1f11d6a32',403.73,573.73,12,'kit 24K 1/4&1/2 (AR40)'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_24k_58','Extra pipe run beyond 3.5 m (24K 1/4&5/8)','m',0.25,680,'49e21162-4326-4c46-8776-4d418641e194',474.51,644.51,13,'Wind-Free / AR24BSAAAWK'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_24k_midea','Extra pipe run beyond 3.5 m (24K 3/8&5/8)','m',0.25,680,'6b62cd9f-57b9-4c88-8bf3-f50164b1b139',497.03,667.03,14,'Midea BZE-INV-24'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','extra_pipe_36k','Extra pipe run beyond 3.5 m (36K)','m',0.25,680,'11054575-a871-49be-8571-78ba9cc5aeb3',545.93,715.93,15,'kit 36K/48K 3/8&5/8'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','core_hole','Extra core hole through wall','each',NULL,680,NULL,NULL,NULL,20,'No catalogue item yet: priced by rep/Johan'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','work_at_height','Working at height (ladder / scaffold)','each',NULL,680,NULL,NULL,NULL,21,'No catalogue item yet: priced by rep/Johan'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','difficult_wall','Difficult wall (face brick / concrete)','each',NULL,680,NULL,NULL,NULL,22,'No catalogue item yet: priced by rep/Johan'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','ground_stand','Ground stand for outdoor unit','each',NULL,680,NULL,NULL,NULL,23,'No catalogue item yet: priced by rep/Johan'),
 ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e','old_unit_removal','Remove old unit','each',NULL,680,NULL,NULL,NULL,24,'No catalogue item yet: priced by rep/Johan')
ON CONFLICT (company_id, code) DO NOTHING;

-- discount floor: labour at cost (0.25 h x R680 / 1.35) + kit at cost (Materials 100% markup -> sell / 2)
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 309.49/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_9_12k' AND cost_excl IS NULL;
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 367.75/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_18k' AND cost_excl IS NULL;
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 403.73/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_24k' AND cost_excl IS NULL;
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 474.51/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_24k_58' AND cost_excl IS NULL;
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 497.03/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_24k_midea' AND cost_excl IS NULL;
UPDATE public.variation_rates SET cost_excl = round(0.25*680/1.35 + 545.93/2.0, 2) WHERE company_id='361bf031-9cdb-4d7f-9bde-9eb95fa4725e' AND code='extra_pipe_36k' AND cost_excl IS NULL;
INSERT INTO public.variation_settings (company_id) VALUES ('361bf031-9cdb-4d7f-9bde-9eb95fa4725e') ON CONFLICT DO NOTHING;
-- ---------- needs-check + unit info ----------
CREATE OR REPLACE FUNCTION public.fl_quote_has_install(_quote uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.quote_items i WHERE i.quote_id=_quote AND (
    lower(coalesce(i.item_type,'')) IN ('labour','installation kit')
    OR i.metadata ? 'install' OR i.metadata ? 'kit' OR coalesce(i.metadata->>'labour','')='true'
    OR coalesce(i.item_number,'') ILIKE 'STD-B2B-INST%' OR i.item_name ~* '\minstall')) $f$;

CREATE OR REPLACE FUNCTION public.fl_job_needs_site_check(_job uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT EXISTS (SELECT 1 FROM public.jobs j JOIN public.quotes q ON q.id=j.quote_id
    WHERE j.id=_job AND q.remote_quote AND NOT q.is_variation
      AND (j.job_type='installation' OR public.fl_quote_has_install(q.id))) $f$;

-- The AC unit in a room: BTU + name (from the catalogue product, else parsed from the line name).
CREATE OR REPLACE FUNCTION public.fl_area_unit(_quote uuid, _area uuid, OUT btu int, OUT unit_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE r record;
BEGIN
  FOR r IN SELECT i.item_name, sp.name sp_name, coalesce(sp.capacity_btu, sp.btu_rating) b, sp.category
             FROM public.quote_items i LEFT JOIN public.supplier_products sp ON sp.id=i.product_id
            WHERE i.quote_id=_quote AND i.parent_item_id IS NULL AND (_area IS NULL OR i.area_id IS NOT DISTINCT FROM _area)
              AND lower(coalesce(i.item_type,'')) NOT IN ('labour','installation kit','free_service')
            ORDER BY (coalesce(sp.capacity_btu, sp.btu_rating) IS NULL), i.unit_price DESC NULLS LAST LOOP
    btu := r.b;
    IF btu IS NULL THEN
      btu := nullif(substring(coalesce(r.sp_name, r.item_name) FROM '(\d{4,5})\s*BTU'),'')::int;
      IF btu IS NULL THEN btu := nullif(substring(coalesce(r.sp_name, r.item_name) FROM '\m(\d{1,2})\s*K\M'),'')::int * 1000; END IF;
      IF btu IS NULL THEN btu := nullif(substring(coalesce(r.sp_name, r.item_name) FROM '(?:F|INV-|-)(09|12|18|24|36|48)(?:[A-Z]|\M)'),'')::int * 1000; END IF;
    END IF;
    IF btu IS NOT NULL AND btu >= 5000 THEN unit_name := coalesce(r.item_name, r.sp_name); RETURN; END IF;
  END LOOP;
  btu := NULL; unit_name := NULL;
END $f$;

CREATE OR REPLACE FUNCTION public.fl_pipe_rate_code(_quote uuid, _area uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE u record;
BEGIN
  SELECT * INTO u FROM public.fl_area_unit(_quote, _area);
  IF u.btu IS NULL THEN SELECT * INTO u FROM public.fl_area_unit(_quote, NULL); END IF;
  IF u.btu IS NULL THEN RETURN NULL; END IF;
  IF u.btu <= 12000 THEN RETURN 'extra_pipe_9_12k'; END IF;
  IF u.btu <= 18000 THEN RETURN 'extra_pipe_18k'; END IF;
  IF u.btu <= 24000 THEN
    IF u.unit_name ~* '(wind.?free|AR24BSA)' THEN RETURN 'extra_pipe_24k_58'; END IF;
    IF u.unit_name ~* '(midea|BZE)' THEN RETURN 'extra_pipe_24k_midea'; END IF;
    RETURN 'extra_pipe_24k';
  END IF;
  RETURN 'extra_pipe_36k';
END $f$;

-- ---------- Confirmed & locked ----------
CREATE OR REPLACE FUNCTION public.fl_quote_items_lock_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF coalesce(current_setting('app.quote_lock_bypass', true),'') <> 'on'
     AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = coalesce(NEW.quote_id, OLD.quote_id) AND q.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.' USING ERRCODE='P0001';
  END IF;
  RETURN coalesce(NEW, OLD);
END $f$;
DROP TRIGGER IF EXISTS trg_quote_items_lock_guard ON public.quote_items;
CREATE TRIGGER trg_quote_items_lock_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quote_items
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_items_lock_guard();

CREATE OR REPLACE FUNCTION public.fl_quotes_lock_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NOT NULL
     AND coalesce(current_setting('app.quote_lock_bypass', true),'') <> 'on'
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal OR NEW.vat_amount IS DISTINCT FROM OLD.vat_amount OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.discount_type IS DISTINCT FROM OLD.discount_type OR NEW.discount_value IS DISTINCT FROM OLD.discount_value
          OR NEW.vat_rate IS DISTINCT FROM OLD.vat_rate OR NEW.payment_plan IS DISTINCT FROM OLD.payment_plan) THEN
    RAISE EXCEPTION 'This quote is confirmed and locked for its installation. An admin must unlock it before it can be changed.' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_quotes_lock_guard ON public.quotes;
CREATE TRIGGER trg_quotes_lock_guard BEFORE UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.fl_quotes_lock_guard();

CREATE OR REPLACE FUNCTION public.fl_lock_quote(_quote uuid, _reason text, _actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  UPDATE public.quotes SET locked_at = now(), locked_by = _actor, locked_reason = _reason WHERE id = _quote AND locked_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor)
    SELECT _quote, company_id, 'lock', _reason, _actor FROM public.quotes WHERE id = _quote;
  END IF;
END $f$;

CREATE OR REPLACE FUNCTION public.unlock_quote(p_quote_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE q record;
BEGIN
  SELECT * INTO q FROM public.quotes WHERE id = p_quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'Quote not found'; END IF;
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) AND public.fl_is_company_office(auth.uid(), q.company_id)) AND NOT public.p4_is_platform() THEN
    RAISE EXCEPTION 'Only an admin can unlock a confirmed quote' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Please give a reason for unlocking'; END IF;
  IF q.locked_at IS NULL THEN RETURN true; END IF;
  UPDATE public.quotes SET locked_at = NULL, locked_by = NULL, locked_reason = NULL WHERE id = p_quote_id;
  INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason, actor) VALUES (p_quote_id, q.company_id, 'unlock', btrim(p_reason), auth.uid());
  RETURN true;
END $f$;

-- ---------- notifications ----------
CREATE OR REPLACE FUNCTION public.fl_notify_job_techs(_job uuid, _type text, _title text, _body text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $f$
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT a.profile_id, _type, _title, _body, _job, jsonb_build_object('job_id', _job, 'link', '/field/jobs/' || _job::text)
    FROM public.assignments a WHERE a.job_id = _job AND a.profile_id IS NOT NULL AND coalesce(a.status,'') <> 'rejected' $f$;

-- ---------- pricing of a variation quote (threshold, 40% goodwill discount with cost floor) ----------
CREATE OR REPLACE FUNCTION public.fl_variation_reprice(_vq uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v record; s record; r record; v_gross numeric := 0; v_net numeric := 0; v_charged boolean; v_pct numeric; v_area uuid;
        v_g numeric; v_c numeric; v_n numeric; v_capped boolean := false; v_sum jsonb; v_line text;
        f_threshold numeric; f_pct numeric; v_notes text; v_qf numeric := 1;
BEGIN
  SELECT * INTO v FROM public.quotes WHERE id=_vq AND is_variation;
  IF v.id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO s FROM public.variation_settings WHERE company_id = v.company_id;
  f_threshold := coalesce(s.threshold_excl, 950); f_pct := coalesce(s.discount_pct, 0);
  IF v.discount_type IN ('percent','percentage') AND coalesce(v.discount_value,0) > 0 AND v.discount_value < 100 THEN
    v_qf := 1 - v.discount_value / 100.0;
  END IF;
  -- remember the full (gross) price of every extra-work line once
  UPDATE public.quote_items SET metadata = metadata || jsonb_build_object('gross_unit', unit_price)
   WHERE quote_id=_vq AND coalesce(metadata->>'variation','')='true' AND coalesce(metadata->>'unit_swap','')<>'true'
     AND NOT (metadata ? 'gross_unit');
  SELECT coalesce(sum(coalesce((metadata->>'gross_unit')::numeric,0) * coalesce(quantity,0)),0) INTO v_gross
    FROM public.quote_items WHERE quote_id=_vq AND coalesce(metadata->>'variation','')='true'
     AND coalesce(metadata->>'unit_swap','')<>'true';
  v_charged := v_gross >= f_threshold;
  FOR r IN SELECT id, quantity, metadata FROM public.quote_items WHERE quote_id=_vq AND coalesce(metadata->>'variation','')='true'
            AND coalesce(metadata->>'unit_swap','')<>'true' LOOP
    v_g := coalesce((r.metadata->>'gross_unit')::numeric, 0);
    v_c := nullif(r.metadata->>'cost_unit','')::numeric;
    IF NOT v_charged THEN v_n := 0;
    ELSIF v_c IS NULL THEN v_n := v_g;      -- no known cost: never discount below an unknown cost
    ELSE
      v_n := round(v_g * (1 - f_pct/100.0), 2);
      IF v_n < v_c THEN v_n := least(v_g, round(v_c, 2)); v_capped := true; END IF;
    END IF;
    -- the quote's own % discount also applies to these lines: gross the stored price up so the client pays exactly v_n
    UPDATE public.quote_items SET unit_price = round(v_n / v_qf, 2), total_price = round(round(v_n / v_qf, 2) * coalesce(quantity,0), 2) WHERE id = r.id;
    v_net := v_net + round(v_n * coalesce(r.quantity,0), 2);
  END LOOP;
  v_sum := jsonb_build_object('gross_excl', round(v_gross,2), 'discount_pct', CASE WHEN v_charged THEN f_pct ELSE 0 END,
           'discount_excl', round(v_gross - v_net, 2), 'net_excl', round(v_net, 2), 'charged', v_charged,
           'absorbed', NOT v_charged AND v_gross > 0, 'threshold_excl', f_threshold, 'capped_at_cost', v_capped);
  v_line := CASE
    WHEN v_gross = 0 THEN NULL
    WHEN NOT v_charged THEN 'Updated after the site check: the additional work (' || to_char(v_gross,'FMR999G999G990D00') || ' excl VAT) is on us, at no charge.'
    ELSE 'Updated after the site check: additional work ' || to_char(v_gross,'FMR999G999G990D00') || ', our discount '
         || CASE WHEN v_capped THEN 'up to ' ELSE '' END || trim(to_char(f_pct,'FM990')) || '%, you pay ' || to_char(v_net,'FMR999G999G990D00') || ' (excl VAT).' END;
  v_notes := regexp_replace(coalesce(v.notes,''), '^Updated after the site check:[^\n]*\n*', '');
  UPDATE public.quotes SET variation_summary = v_sum || jsonb_build_object('summary_line', v_line),
         notes = CASE WHEN v_line IS NULL THEN nullif(v_notes,'') ELSE v_line || CASE WHEN v_notes <> '' THEN E'\n\n' || v_notes ELSE '' END END
   WHERE id = _vq;
  RETURN v_sum || jsonb_build_object('summary_line', v_line);
END $f$;

-- ---------- the reusable variation write path (tech app now; Sam voice later) ----------
-- p_items: [{code: 'extra_pipe'|'core_hole'|'work_at_height'|'difficult_wall'|'ground_stand'|'old_unit_removal'|<rate code>, area_id, qty}]
-- p_unit_swaps: [{area_id, recommended_btu, note}]. Quantities only: prices always come from variation_rates / the office.
CREATE OR REPLACE FUNCTION public.fl_create_job_variation(p_job_id uuid, p_items jsonb, p_unit_swaps jsonb, p_source text, p_actor uuid, p_site_check_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE j record; q record; v_new uuid; it jsonb; v_area uuid; v_code text; rt record; v_qty numeric; v_needs boolean := false; n int := 0;
        v_var uuid; v_sum jsonb; v_status text; v_num text; v_items jsonb := '[]'::jsonb; v_swaps jsonb := coalesce(p_unit_swaps,'[]'::jsonb);
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.id IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  SELECT * INTO q FROM public.quotes WHERE id = j.quote_id;
  IF q.id IS NULL THEN RAISE EXCEPTION 'This job has no quote to update'; END IF;
  IF EXISTS (SELECT 1 FROM public.job_variations WHERE job_id = j.id AND status IN ('awaiting_pricing','awaiting_client')) THEN
    RAISE EXCEPTION 'An updated quote is already open for this job';
  END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) LOOP
    v_qty := nullif(it->>'qty','')::numeric;
    IF v_qty IS NOT NULL AND v_qty > 0 THEN v_items := v_items || jsonb_build_array(jsonb_build_object('code', it->>'code', 'area_id', it->>'area_id', 'qty', v_qty)); END IF;
  END LOOP;
  IF jsonb_array_length(v_items) = 0 AND jsonb_array_length(v_swaps) = 0 THEN RAISE EXCEPTION 'Add at least one change (quantity) or a unit size change'; END IF;

  PERFORM set_config('app.quote_lock_bypass','on',true);
  v_new := public.duplicate_quote(q.id, NULL);
  UPDATE public.quotes SET parent_quote_id = q.id, is_variation = true, variation_job_id = j.id, remote_quote = true,
         remote_quote_source = 'site_check', reference_text = 'Updated quote after site check' || coalesce(' (was ' || q.quote_number || ')', ''),
         lead_id = coalesce(lead_id, q.lead_id), terms_text = q.terms_text
   WHERE id = v_new RETURNING quote_number INTO v_num;

  FOR it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    n := n + 1;
    SELECT na.id INTO v_area FROM public.quote_areas oa JOIN public.quote_areas na ON na.quote_id = v_new AND na.name = oa.name
      WHERE oa.id = nullif(it->>'area_id','')::uuid ORDER BY (na.sort_order IS NOT DISTINCT FROM oa.sort_order) DESC LIMIT 1;
    IF v_area IS NULL THEN SELECT id INTO v_area FROM public.quote_areas WHERE quote_id = v_new ORDER BY sort_order NULLS LAST, created_at LIMIT 1; END IF;
    v_code := it->>'code';
    IF v_code = 'extra_pipe' THEN v_code := coalesce(public.fl_pipe_rate_code(q.id, nullif(it->>'area_id','')::uuid), 'extra_pipe'); END IF;
    SELECT * INTO rt FROM public.variation_rates WHERE company_id = j.company_id AND code = v_code AND active;
    IF rt.id IS NULL OR rt.price_excl IS NULL THEN v_needs := true; END IF;
    INSERT INTO public.quote_items (quote_id, item_name, description, unit_price, quantity, total_price, item_type, area_id, sort_order, metadata)
    VALUES (v_new, coalesce(rt.label, initcap(replace(v_code,'_',' '))) || ' – site check',
            (it->>'qty') || CASE WHEN rt.unit = 'm' THEN ' m' ELSE ' ×' END,
            coalesce(rt.price_excl, 0), (it->>'qty')::numeric, round(coalesce(rt.price_excl,0) * (it->>'qty')::numeric, 2),
            'labour', v_area, 9000 + n,
            jsonb_build_object('variation', true, 'labour', true, 'code', v_code, 'needs_pricing', rt.price_excl IS NULL,
              'cost_unit', rt.cost_excl, 'labour_hours', CASE WHEN rt.labour_hours IS NULL THEN NULL ELSE rt.labour_hours * (it->>'qty')::numeric END,
              'unit', coalesce(rt.unit,'each'), 'source', p_source));
  END LOOP;
  FOR it IN SELECT * FROM jsonb_array_elements(v_swaps) LOOP
    n := n + 1; v_needs := true;
    SELECT na.id INTO v_area FROM public.quote_areas oa JOIN public.quote_areas na ON na.quote_id = v_new AND na.name = oa.name
      WHERE oa.id = nullif(it->>'area_id','')::uuid LIMIT 1;
    INSERT INTO public.quote_items (quote_id, item_name, description, unit_price, quantity, total_price, item_type, area_id, sort_order, metadata)
    VALUES (v_new, 'Unit size change' || coalesce(' to ' || to_char((it->>'recommended_btu')::int,'FM999G999') || ' BTU','') || ' – to be priced',
            nullif(it->>'note',''), 0, 1, 0, 'misc', v_area, 9000 + n,
            jsonb_build_object('variation', true, 'unit_swap', true, 'needs_pricing', true, 'recommended_btu', it->>'recommended_btu', 'source', p_source));
  END LOOP;

  INSERT INTO public.job_variations (job_id, company_id, original_quote_id, variation_quote_id, site_check_id, source, created_by, items, unit_swaps, needs_pricing, status)
  VALUES (j.id, j.company_id, q.id, v_new, p_site_check_id, coalesce(p_source,'tech_app'), p_actor, v_items, v_swaps, v_needs,
          CASE WHEN v_needs THEN 'awaiting_pricing' ELSE 'awaiting_client' END)
  RETURNING id INTO v_var;

  IF v_needs THEN
    v_status := 'awaiting_pricing';
    UPDATE public.jobs SET site_check_status = 'awaiting_pricing', variation_quote_id = v_new WHERE id = j.id;
    PERFORM public.qa_notify_rep_and_admins(v_new, 'site_check_pricing_needed_quote', 'Site check: price the updated quote ' || coalesce(v_num,''),
      'The technician found changes on site for ' || coalesce(q.customer_name,'the client') || '. Price the lines marked "to be priced", press "Finalise updated quote", then send it. Work is on hold until the client approves.');
    PERFORM public.fl_notify_job_techs(j.id, 'job_variation_pricing', 'Changes sent to the office', 'The office is pricing the changes. Do not start until the client approves.');
  ELSE
    v_sum := public.fl_variation_reprice(v_new);
    IF NOT coalesce((v_sum->>'charged')::boolean, false) THEN
      -- under the threshold: absorbed at R0, no client approval needed, costs confirmed and locked
      v_status := 'confirmed';
      UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = 'No extra charge (site check)' WHERE id = v_new;
      PERFORM public.fl_lock_quote(v_new, 'variation_absorbed', p_actor);
      UPDATE public.job_variations SET status = 'approved', decided_by = 'absorbed', decided_at = now() WHERE id = v_var;
      UPDATE public.jobs SET site_check_status = 'confirmed', variation_quote_id = v_new WHERE id = j.id;
      PERFORM public.qa_notify_rep_and_admins(v_new, 'site_check_absorbed_quote', 'Site check: small changes absorbed (' || coalesce(v_num,'') || ')',
        coalesce(v_sum->>'summary_line','') || ' No extra charge to the client; the job can go ahead.');
      PERFORM public.fl_notify_job_techs(j.id, 'job_variation_approved', 'No extra charge – go ahead', 'The changes are small and absorbed. Costs are confirmed and locked. You can start.');
    ELSE
      v_status := 'awaiting_client';
      UPDATE public.quotes SET status = 'sent', sent_at = now(), sent_method = 'site_check', sent_channel = 'client_link' WHERE id = v_new;
      UPDATE public.jobs SET site_check_status = 'awaiting_client', variation_quote_id = v_new WHERE id = j.id;
      PERFORM public.qa_notify_rep_and_admins(v_new, 'site_check_variation_sent_quote', 'Site check: updated quote ' || coalesce(v_num,'') || ' is on the client link',
        coalesce(v_sum->>'summary_line','') || ' Waiting for the client to approve on the link.');
      PERFORM public.fl_notify_job_techs(j.id, 'job_variation_sent', 'Updated quote is with the client', 'Show the client the approval code on the job sheet. Do not start until they approve.');
    END IF;
  END IF;
  PERFORM set_config('app.quote_lock_bypass','',true);
  RETURN jsonb_build_object('variation_id', v_var, 'variation_quote_id', v_new, 'status', v_status, 'needs_pricing', v_needs);
END $f$;
REVOKE ALL ON FUNCTION public.fl_create_job_variation(uuid, jsonb, jsonb, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_variation_reprice(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_lock_quote(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fl_notify_job_techs(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ---------- tech / office: submit the site check ----------
CREATE OR REPLACE FUNCTION public.submit_site_check(p_job_id uuid, p_checklist jsonb, p_result text, p_items jsonb DEFAULT '[]'::jsonb,
  p_unit_swaps jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE j record; v_check uuid; v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE='42501'; END IF;
  IF NOT public.fl_can_see_job(auth.uid(), p_job_id) THEN RAISE EXCEPTION 'Not your job' USING ERRCODE='42501'; END IF;
  IF p_result NOT IN ('as_quoted','variation_needed') THEN RAISE EXCEPTION 'Invalid result'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF j.status IN ('completed','cancelled') THEN RAISE EXCEPTION 'This job is already %', j.status; END IF;
  IF j.site_check_status IN ('awaiting_pricing','awaiting_client') THEN RAISE EXCEPTION 'An updated quote is already open for this job'; END IF;
  IF j.site_check_status = 'confirmed' THEN RAISE EXCEPTION 'Costs are already confirmed and locked for this job'; END IF;
  INSERT INTO public.job_site_checks (job_id, quote_id, company_id, tech_id, checklist, result, notes)
  VALUES (j.id, j.quote_id, j.company_id, auth.uid(), coalesce(p_checklist,'{}'::jsonb), p_result, nullif(btrim(coalesce(p_notes,'')),''))
  RETURNING id INTO v_check;
  IF p_result = 'as_quoted' THEN
    IF j.quote_id IS NOT NULL THEN PERFORM public.fl_lock_quote(j.quote_id, 'site_check_as_quoted', auth.uid()); END IF;
    UPDATE public.jobs SET site_check_status = 'confirmed' WHERE id = j.id;
    RETURN jsonb_build_object('status', 'confirmed', 'site_check_id', v_check);
  END IF;
  v_res := public.fl_create_job_variation(j.id, p_items, p_unit_swaps, 'tech_app', auth.uid(), v_check);
  UPDATE public.job_site_checks SET variation_quote_id = (v_res->>'variation_quote_id')::uuid WHERE id = v_check;
  RETURN v_res - 'variation_quote_id' || jsonb_build_object('site_check_id', v_check);
END $f$;
GRANT EXECUTE ON FUNCTION public.submit_site_check(uuid, jsonb, text, jsonb, jsonb, text) TO authenticated;

-- ---------- office: apply pricing rules to a rep-priced variation, before sending ----------
CREATE OR REPLACE FUNCTION public.finalise_variation_quote(p_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v record; v_sum jsonb;
BEGIN
  SELECT * INTO v FROM public.quotes WHERE id = p_quote_id AND is_variation;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Not an updated (site check) quote'; END IF;
  IF NOT public.fl_is_company_office(auth.uid(), v.company_id) AND NOT (v.sales_engineer_id = auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE='42501'; END IF;
  IF v.status <> 'draft' THEN RAISE EXCEPTION 'This updated quote has already been sent'; END IF;
  IF EXISTS (SELECT 1 FROM public.quote_items WHERE quote_id = p_quote_id AND coalesce(metadata->>'variation','')='true'
              AND coalesce(metadata->>'unit_swap','')<>'true' AND coalesce(unit_price,0) = 0
              AND NOT (metadata ? 'gross_unit')) THEN
    RAISE EXCEPTION 'Some site-check lines still have no price';
  END IF;
  v_sum := public.fl_variation_reprice(p_quote_id);
  UPDATE public.quote_items SET metadata = metadata || '{"needs_pricing": false}'::jsonb
   WHERE quote_id = p_quote_id AND coalesce(metadata->>'variation','')='true';
  RETURN v_sum;
END $f$;
GRANT EXECUTE ON FUNCTION public.finalise_variation_quote(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_quote(uuid, text) TO authenticated;

-- rep sends a priced variation with the normal Send: move the job to "waiting for client"
CREATE OR REPLACE FUNCTION public.fl_variation_status_trigger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
BEGIN
  IF NEW.is_variation AND NEW.variation_job_id IS NOT NULL AND OLD.status = 'draft' AND NEW.status IN ('sent','viewed')
     AND EXISTS (SELECT 1 FROM public.job_variations WHERE variation_quote_id = NEW.id AND status = 'awaiting_pricing') THEN
    UPDATE public.job_variations SET status = 'awaiting_client' WHERE variation_quote_id = NEW.id AND status = 'awaiting_pricing';
    UPDATE public.jobs SET site_check_status = 'awaiting_client' WHERE id = NEW.variation_job_id AND site_check_status = 'awaiting_pricing';
    PERFORM public.fl_notify_job_techs(NEW.variation_job_id, 'job_variation_sent', 'Updated quote is with the client',
      'Show the client the approval code on the job sheet. Do not start until they approve.');
  END IF;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS trg_variation_status ON public.quotes;
CREATE TRIGGER trg_variation_status AFTER UPDATE OF status ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.fl_variation_status_trigger();

-- ---------- client: approve / decline the updated quote on the link ----------
CREATE OR REPLACE FUNCTION public.respond_job_variation(p_token uuid, p_approve boolean, p_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v record; j record; v_name text := nullif(btrim(coalesce(p_name,'')),'');
BEGIN
  SELECT * INTO v FROM public.quotes WHERE public_token = p_token AND is_variation FOR UPDATE;
  IF v.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v.status = 'accepted' THEN RETURN jsonb_build_object('ok', true, 'status', 'approved'); END IF;
  IF v.status = 'declined' THEN RETURN jsonb_build_object('ok', true, 'status', 'declined'); END IF;
  IF v.status NOT IN ('sent','viewed') THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_ready'); END IF;
  SELECT * INTO j FROM public.jobs WHERE id = v.variation_job_id;
  IF p_approve THEN
    IF v_name IS NULL THEN RAISE EXCEPTION 'Please enter your name'; END IF;
    UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = v_name WHERE id = v.id;
    PERFORM public.fl_lock_quote(v.id, 'variation_approved', NULL);
    UPDATE public.job_variations SET status = 'approved', decided_by = v_name, decided_at = now() WHERE variation_quote_id = v.id AND status IN ('awaiting_client','awaiting_pricing');
    UPDATE public.jobs SET site_check_status = 'confirmed' WHERE id = j.id;
    PERFORM public.fl_notify_job_techs(j.id, 'job_variation_approved', 'Variation approved – go ahead',
      'The client approved the updated quote. Costs are confirmed and locked. You can start.');
    PERFORM public.qa_notify_rep_and_admins(v.id, 'site_check_variation_approved_quote', 'Client approved updated quote ' || coalesce(v.quote_number,''),
      coalesce(v_name,'The client') || ' approved the updated quote on the link. ' || coalesce(v.variation_summary->>'summary_line','')
      || ' Add the difference to the balance invoice.');
    RETURN jsonb_build_object('ok', true, 'status', 'approved');
  ELSE
    UPDATE public.quotes SET status = 'declined' WHERE id = v.id;
    UPDATE public.job_variations SET status = 'declined', decided_by = coalesce(v_name,'client'), decided_at = now() WHERE variation_quote_id = v.id AND status IN ('awaiting_client','awaiting_pricing');
    UPDATE public.jobs SET site_check_status = 'declined', status = 'cancelled' WHERE id = j.id AND status NOT IN ('completed','cancelled');
    PERFORM public.fl_notify_job_techs(j.id, 'job_variation_declined', 'Client declined – do not proceed',
      'The client declined the updated quote. The job is cancelled. Pack up; the office will contact the client.');
    PERFORM public.qa_notify_rep_and_admins(v.id, 'site_check_variation_declined_quote', 'Client declined updated quote ' || coalesce(v.quote_number,''),
      coalesce(v_name,'The client') || ' declined the updated quote. The job is cancelled. Refund the deposit in full (terms 12.5).');
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;
END $f$;
GRANT EXECUTE ON FUNCTION public.respond_job_variation(uuid, boolean, text) TO anon, authenticated;

-- ---------- job sheet info (no prices) ----------
CREATE OR REPLACE FUNCTION public.get_job_site_check(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE j record; q record; v record; c record; v_rooms jsonb; v_adds jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.fl_can_see_job(auth.uid(), p_job_id) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  SELECT * INTO q FROM public.quotes WHERE id = j.quote_id;
  SELECT * INTO v FROM public.quotes WHERE id = j.variation_quote_id;
  SELECT result, created_at INTO c FROM public.job_site_checks WHERE job_id = p_job_id ORDER BY created_at DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('area_id', a.id, 'name', a.name, 'unit_name', u.unit_name, 'btu', u.btu) ORDER BY a.sort_order NULLS LAST, a.created_at), '[]'::jsonb)
    INTO v_rooms FROM public.quote_areas a CROSS JOIN LATERAL public.fl_area_unit(q.id, a.id) u WHERE a.quote_id = q.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'unit', x.unit) ORDER BY x.sort_order), '[]'::jsonb) INTO v_adds FROM (
    SELECT 'extra_pipe' code, 'Extra pipe beyond 3.5 m' label, 'm' unit, 0 sort_order
    UNION ALL SELECT code, label, unit, sort_order FROM public.variation_rates WHERE company_id = j.company_id AND active AND code NOT LIKE 'extra_pipe%') x;
  RETURN jsonb_build_object(
    'needs_check', public.fl_job_needs_site_check(p_job_id),
    'has_install', q.id IS NOT NULL AND (j.job_type = 'installation' OR public.fl_quote_has_install(q.id)),
    'remote_quote', coalesce(q.remote_quote, false),
    'status', j.site_check_status,
    'locked_at', coalesce(v.locked_at, q.locked_at),
    'last_result', c.result, 'last_checked_at', c.created_at,
    'rooms', coalesce(v_rooms, '[]'::jsonb), 'quick_adds', v_adds,
    'variation', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object(
       'status', (SELECT status FROM public.job_variations WHERE variation_quote_id = v.id ORDER BY created_at DESC LIMIT 1),
       'client_token', CASE WHEN v.status IN ('sent','viewed') THEN v.public_token END) END);
END $f$;
GRANT EXECUTE ON FUNCTION public.get_job_site_check(uuid) TO authenticated;
-- ---------- changes to existing functions (originals backed up in r2/fn_*.sql) ----------

CREATE OR REPLACE FUNCTION public.tech_set_job_status(p_job_id uuid, p_status text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; v_mine boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('in_progress','completed') THEN RAISE EXCEPTION 'Invalid status %', p_status; END IF;
  SELECT * INTO j FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found'; END IF;
  v_mine := EXISTS (SELECT 1 FROM public.assignments a WHERE a.job_id = p_job_id AND a.profile_id = auth.uid()
                      AND COALESCE(a.status,'') <> 'rejected');
  IF NOT v_mine AND NOT (public.is_ops_user(auth.uid()) AND j.company_id = public.get_user_company_id(auth.uid())) THEN
    RAISE EXCEPTION 'Not your job' USING ERRCODE = '42501'; END IF;
  IF j.status IN ('completed','cancelled') THEN RETURN j.status; END IF;
  -- R2 site check gate: phone/online install jobs need costs confirmed and locked first
  IF public.fl_job_needs_site_check(p_job_id) AND coalesce(j.site_check_status,'') <> 'confirmed' THEN
    RAISE EXCEPTION '%', CASE j.site_check_status
      WHEN 'awaiting_client' THEN 'Waiting for the client to approve the updated quote'
      WHEN 'awaiting_pricing' THEN 'Waiting for the office to price the changes'
      WHEN 'declined' THEN 'Client declined – do not proceed'
      ELSE 'Do the site check first' END USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.assignments SET status = p_status,
         started_at = COALESCE(started_at, now()),
         completed_at = CASE WHEN p_status = 'completed' THEN COALESCE(completed_at, now()) ELSE completed_at END
   WHERE job_id = p_job_id AND profile_id = auth.uid() AND status IS DISTINCT FROM p_status AND COALESCE(status,'') <> 'rejected';
  IF j.status IS DISTINCT FROM p_status THEN
    UPDATE public.jobs SET status = p_status WHERE id = p_job_id;
  END IF;
  RETURN p_status;
END $function$
;


CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_variation THEN RETURN NEW; END IF; /*r2: site-check updated quotes never create a deposit invoice*/
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END;
$function$
;


CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL AND NOT NEW.is_variation /*r2*/
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (NEW.sales_engineer_id, 'quote_accepted_handover',
            'Quote ' || COALESCE(NEW.quote_number, '') || ' accepted — hand to technician',
            COALESCE(NEW.customer_name, 'Client') || ' accepted. Open the visit to hand it over.', NEW.id,
            jsonb_build_object('quote_id', NEW.id, 'lead_id', NEW.lead_id,
              'link', CASE WHEN NEW.lead_id IS NOT NULL THEN '/admin/visits/' || NEW.lead_id::text ELSE '/admin/estimates/' || NEW.id::text END));
  END IF;
  RETURN NEW;
END $function$
;


CREATE OR REPLACE FUNCTION public.accept_quote_by_token(p_token uuid, p_accepted_by text, p_signature jsonb DEFAULT NULL::jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_quote_id uuid; v_num text; v_cust text; v_status text;
BEGIN
  SELECT id, quote_number, customer_name, status INTO v_quote_id, v_num, v_cust, v_status
  FROM public.quotes WHERE public_token = p_token FOR UPDATE;
  IF v_quote_id IS NULL THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_id AND is_variation) THEN RETURN false; END IF; /*r2: use respond_job_variation*/
  IF v_status = 'accepted' THEN RETURN true; END IF; /*oneinv: retry / queued double-submit is not an error*/
  IF v_status NOT IN ('sent','viewed') THEN RETURN false; END IF;
  -- Set BEFORE the update so the on_quote_accepted trigger path is also allowed for the token holder.
  PERFORM set_config('app.public_quote_accept', v_quote_id::text, true);
  UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = p_accepted_by, accepted_signature = p_signature
  WHERE id = v_quote_id;
  PERFORM public.create_deposit_invoice_for_quote(v_quote_id);
  PERFORM set_config('app.public_quote_accept', '', true);
  PERFORM public.qa_notify_rep_and_admins(v_quote_id, 'quote_accepted_client',
    'Quote ' || COALESCE(v_num, '') || ' accepted by client',
    COALESCE(NULLIF(p_accepted_by, ''), v_cust, 'Client') || ' accepted quote ' || COALESCE(v_num, '') || ' online.');
  RETURN true;
END $function$
;


CREATE OR REPLACE FUNCTION public.get_public_quote(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_settings public.company_settings%ROWTYPE;
  v_prof public.company_profiles%ROWTYPE;
BEGIN
  IF p_token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_quote FROM public.quotes WHERE public_token = p_token;
  IF v_quote.id IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_quote.customer_id IS NOT NULL THEN
    SELECT * INTO v_cust FROM public.customers WHERE id = v_quote.customer_id;
  END IF;

  SELECT * INTO v_settings FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1; /*p5cs*/
  v_settings.default_deposit_percentage := (SELECT default_deposit_percentage FROM public.company_settings WHERE company_id = COALESCE(v_quote.company_id, (SELECT c0.id FROM public.companies c0 WHERE c0.is_master ORDER BY c0.created_at LIMIT 1)) ORDER BY is_primary DESC, updated_at DESC NULLS LAST, id LIMIT 1); /*acctdep: same row as create_deposit_invoice_for_quote*/

  /* hdr1 2026-10-12: the quote company's own record for header/banking (Johan: details from the record) */
  SELECT * INTO v_prof FROM public.company_profiles WHERE company_id = v_quote.company_id AND archived_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1;

  RETURN jsonb_build_object(
    'quote', jsonb_build_object(
      'id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'subtotal', v_quote.subtotal,
      'vat_rate', v_quote.vat_rate,
      'vat_amount', v_quote.vat_amount,
      'total', v_quote.total,
      'notes', v_quote.notes,
      'valid_until', v_quote.valid_until,
      'created_at', v_quote.created_at,
      'accepted_by', v_quote.accepted_by,
      'customer_name', v_quote.customer_name,
      'terms_text', v_quote.terms_text,
      'reference_text', v_quote.reference_text,
      'discount_type', v_quote.discount_type,
      'discount_value', v_quote.discount_value, 'payment_plan', v_quote.payment_plan /*acct1*/, 'remote_quote', v_quote.remote_quote /*rq1*/, 'is_variation', v_quote.is_variation, 'variation_summary', v_quote.variation_summary, 'locked_at', v_quote.locked_at, 'parent_total', (SELECT pq.total FROM public.quotes pq WHERE pq.id = v_quote.parent_quote_id), 'parent_quote_number', (SELECT pq.quote_number FROM public.quotes pq WHERE pq.id = v_quote.parent_quote_id) /*r2*/
    ),
    'customer', CASE WHEN v_cust.id IS NULL THEN NULL ELSE jsonb_build_object(
      'name', COALESCE(NULLIF(TRIM(COALESCE(v_cust.first_name,'') || ' ' || COALESCE(v_cust.last_name,'')), ''), v_cust.name),
      'company_name', v_cust.company_name,
      'address', v_cust.primary_address_line1,
      'email', v_cust.email,
      'phone', v_cust.phone,
      'vat_number', v_cust.vat_number /*cvat1*/
    ) END,
    'company', CASE WHEN v_settings.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_name', v_settings.company_name,
      'physical_address', v_settings.physical_address,
      'vat_number', v_settings.vat_number,
      'banking_details', v_settings.banking_details,
      'default_deposit_percentage', v_settings.default_deposit_percentage,
      'default_payment_terms_days', v_settings.default_payment_terms_days
    ) END,
    'profile', CASE WHEN v_prof.id IS NULL THEN NULL ELSE jsonb_build_object(
      'company_id', v_prof.company_id,
      'legal_name', v_prof.legal_name,
      'trading_name', v_prof.trading_name,
      'vat_number', v_prof.vat_number,
      'phone', v_prof.phone,
      'email', v_prof.email,
      'website', v_prof.website,
      'whatsapp', v_prof.whatsapp,
      'address_lines', to_jsonb(v_prof.address_lines),
      'bank_name', v_prof.bank_name,
      'account_name', v_prof.account_name,
      'account_number', v_prof.account_number,
      'branch_code', v_prof.branch_code,
      'account_type', v_prof.account_type,
      'document_style', v_prof.document_style,
      'logo_url', v_prof.logo_url
    ) END,
    'areas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qa.id,
        'name', qa.name,
        'sort_order', qa.sort_order
      ) ORDER BY qa.sort_order NULLS LAST, qa.created_at)
      FROM public.quote_areas qa
      WHERE qa.quote_id = v_quote.id
    ), '[]'::jsonb),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', qi.id,
        'item_name', qi.item_name,
        'description', qi.description,
        'quantity', qi.quantity,
        'unit_price', qi.unit_price,
        'total_price', qi.total_price,
        'sort_order', qi.sort_order,
        'product_id', qi.product_id,
        'area_id', qi.area_id,
        'area_name', qa.name,
        'item_type', qi.item_type,
        'image_url', sp.image_url,
        'category', sp.category,
        'brand', sp.brand,
        'btu_rating', sp.btu_rating,
        'capacity_btu', sp.capacity_btu,
        'kw', sp.kw,
        'ai_sales_description', sp.ai_sales_description,
        'item_number', qi.item_number,
        'is_bundle', qi.is_bundle,
        'product_code', sp.product_code
      ) ORDER BY qi.sort_order)
      FROM public.quote_items qi
      LEFT JOIN public.supplier_products sp ON sp.id = qi.product_id
      LEFT JOIN public.quote_areas qa ON qa.id = qi.area_id
      WHERE qi.quote_id = v_quote.id AND qi.parent_item_id IS NULL
    ), '[]'::jsonb),
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ps.id,
        'section_type', ps.section_type,
        'title', ps.title,
        'content', ps.content,
        'sort_order', ps.sort_order
      ) ORDER BY ps.sort_order)
      FROM public.proposal_sections ps
      WHERE ps.quote_id = v_quote.id
    ), '[]'::jsonb)
  );
END;
$function$
;
