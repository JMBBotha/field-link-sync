-- Admin backfill on behalf of a tech (Johan t1929u). Idempotent. Rollback: /workspace/admin-backfill-2026-10-30/rollback.sql
-- Every on-behalf record: entered_by (admin), on_behalf_of (tech), entered_at (real now), occurred_at (backdated).
-- Admin-only server side (fl_is_company_admin). Backdated writes fire no client messages / rep alerts (app.backfill GUC).

-- 1. Audit columns
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['job_photos','job_time_entries','presence_visits'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS entered_by uuid, ADD COLUMN IF NOT EXISTS on_behalf_of uuid, ADD COLUMN IF NOT EXISTS entered_at timestamptz, ADD COLUMN IF NOT EXISTS occurred_at timestamptz', t);
  END LOOP;
END $$;
ALTER TABLE public.job_photos DROP CONSTRAINT IF EXISTS job_photos_photo_type_check;
ALTER TABLE public.job_photos ADD CONSTRAINT job_photos_photo_type_check CHECK (photo_type = ANY (ARRAY['before','after','site','other']));

-- 2. Guard: only a company admin may set on-behalf / backdated fields; stamp entered_by/entered_at server side.
CREATE OR REPLACE FUNCTION public._backfill_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid;
BEGIN
  IF NEW.on_behalf_of IS NULL AND NEW.occurred_at IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.on_behalf_of IS NOT DISTINCT FROM OLD.on_behalf_of AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at
     AND NEW.entered_by IS NOT DISTINCT FROM OLD.entered_by THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL THEN RETURN NEW; END IF; -- service role / migrations
  IF TG_TABLE_NAME = 'presence_visits' THEN v_co := NEW.company_id;
  ELSE SELECT company_id INTO v_co FROM public.leads WHERE id = NEW.lead_id; END IF;
  IF NOT public.fl_is_company_admin(auth.uid(), v_co) THEN
    RAISE EXCEPTION 'Only an admin can add records on behalf of someone or backdate them' USING ERRCODE = '42501';
  END IF;
  NEW.entered_by := auth.uid();
  NEW.entered_at := COALESCE(CASE WHEN TG_OP='UPDATE' THEN OLD.entered_at END, now());
  RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['job_photos','job_time_entries','presence_visits'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_backfill_guard ON public.%I', t);
    EXECUTE format('CREATE TRIGGER zz_backfill_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public._backfill_guard()', t);
  END LOOP;
END $$;

-- 3. Units (model/serial) and materials used
CREATE TABLE IF NOT EXISTS public.job_unit_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  unit_label text, position text NOT NULL DEFAULT 'indoor' CHECK (position IN ('indoor','outdoor','other')),
  brand text, model text, serial_number text, equipment_id uuid,
  entered_by uuid, on_behalf_of uuid, entered_at timestamptz NOT NULL DEFAULT now(), occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.job_materials_used (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL, job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  item text NOT NULL, qty numeric NOT NULL CHECK (qty > 0), stock_item_id uuid REFERENCES public.cf_stock_items(id) ON DELETE SET NULL,
  draw_stock boolean NOT NULL DEFAULT true, drawn_qty numeric NOT NULL DEFAULT 0, draw_note text,
  entered_by uuid, on_behalf_of uuid, entered_at timestamptz NOT NULL DEFAULT now(), occurred_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS job_unit_details_job ON public.job_unit_details(job_id);
CREATE INDEX IF NOT EXISTS job_materials_used_job ON public.job_materials_used(job_id);
ALTER TABLE public.job_unit_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_materials_used ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jud_select ON public.job_unit_details;
CREATE POLICY jud_select ON public.job_unit_details FOR SELECT TO authenticated USING (
  public.fl_is_company_office(auth.uid(), company_id) OR public.fl_is_company_admin(auth.uid(), company_id)
  OR EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_id AND j.company_id = company_id AND j.lead_id IS NOT NULL AND public.photo_lead_ok(j.lead_id)));
DROP POLICY IF EXISTS jmu_select ON public.job_materials_used;
CREATE POLICY jmu_select ON public.job_materials_used FOR SELECT TO authenticated USING (
  public.fl_is_company_office(auth.uid(), company_id) OR public.fl_is_company_admin(auth.uid(), company_id));
-- writes only through the RPCs below

-- 4. Quiet mode for backdated writes: no notifications / client messages, no auto balance invoice.
CREATE OR REPLACE FUNCTION public._backfill_quiet() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN IF current_setting('app.backfill', true) = '1' THEN RETURN NULL; END IF; RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['notifications','notification_queue','whatsapp_messages','job_client_messages','quote_email_sends'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS a_backfill_quiet ON public.%I', t);
      EXECUTE format('CREATE TRIGGER a_backfill_quiet BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public._backfill_quiet()', t);
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION public.trg_job_completed_balance_invoice()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF current_setting('app.backfill', true) = '1' THEN RETURN NEW; END IF; -- backdated completion: office raises the balance invoice by hand
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.quote_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = NEW.quote_id AND q.status = 'accepted')
     AND EXISTS (SELECT 1 FROM public.invoices i WHERE i.quote_id = NEW.quote_id AND COALESCE(i.notes,'') LIKE 'DEPOSIT%'
                   AND COALESCE(i.status,'') NOT IN ('void','cancelled')) THEN
    BEGIN PERFORM public._create_balance_invoice(NEW.quote_id);
    EXCEPTION WHEN others THEN RAISE WARNING 'balance invoice skipped: %', SQLERRM; END;
  END IF;
  RETURN NEW;
END $function$;

-- 5. RPCs
CREATE OR REPLACE FUNCTION public._backfill_ctx(p_job uuid, p_tech uuid, OUT o_company uuid, OUT o_lead uuid, OUT o_customer uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  SELECT company_id, lead_id, customer_id INTO o_company, o_lead, o_customer FROM public.jobs WHERE id = p_job;
  IF o_company IS NULL THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fl_is_company_admin(auth.uid(), o_company) THEN
    RAISE EXCEPTION 'Only an admin can add records on behalf of a tech' USING ERRCODE = '42501'; END IF;
  IF p_tech IS NULL OR public.get_user_company_id(p_tech) IS DISTINCT FROM o_company THEN
    RAISE EXCEPTION 'That person is not in this company' USING ERRCODE = '22023'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_visit(p_job uuid, p_tech uuid, p_date date, p_arrive time, p_leave time,
  p_completed boolean DEFAULT false, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; v_in timestamptz; v_out timestamptz; v_hours numeric; v_entry uuid; v_job public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._backfill_ctx(p_job, p_tech);
  IF p_date IS NULL OR p_arrive IS NULL THEN RAISE EXCEPTION 'Date and arrival time are required' USING ERRCODE='22023'; END IF;
  v_in := (p_date + p_arrive) AT TIME ZONE 'Africa/Johannesburg';
  v_out := CASE WHEN p_leave IS NOT NULL THEN (p_date + p_leave) AT TIME ZONE 'Africa/Johannesburg' END;
  IF v_out IS NOT NULL AND v_out <= v_in THEN RAISE EXCEPTION 'Leave time must be after arrival' USING ERRCODE='22023'; END IF;
  IF v_in > now() THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE='22023'; END IF;
  v_hours := CASE WHEN v_out IS NOT NULL THEN round((extract(epoch FROM v_out - v_in)/3600.0)::numeric, 2) END;
  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  INSERT INTO public.job_time_entries(lead_id, agent_id, job_id, work_date, start_time, end_time, checked_in_at, checked_out_at,
      hours_worked, hours_auto, is_billable, notes, hours_edit_note, on_behalf_of, occurred_at, entered_by, entered_at)
    VALUES (c.o_lead, p_tech, p_job, p_date, p_arrive, p_leave, v_in, v_out, v_hours, v_hours, true, p_note,
      'Added by admin on behalf of tech', p_tech, v_in, auth.uid(), now())
    RETURNING id INTO v_entry;
  INSERT INTO public.presence_visits(company_id, user_id, kind, job_id, visit_date, arrived_at, left_at, arrived_source, left_source,
      on_behalf_of, occurred_at, entered_by, entered_at)
    VALUES (c.o_company, p_tech, 'job', p_job, p_date, v_in, v_out, 'admin_backfill', CASE WHEN v_out IS NOT NULL THEN 'admin_backfill' END,
      p_tech, v_in, auth.uid(), now())
  ON CONFLICT (user_id, kind, (COALESCE(job_id, lead_id)), visit_date) DO UPDATE SET
      arrived_at = EXCLUDED.arrived_at, left_at = COALESCE(EXCLUDED.left_at, presence_visits.left_at),
      arrived_source = 'admin_backfill', left_source = COALESCE(EXCLUDED.left_source, presence_visits.left_source),
      on_behalf_of = EXCLUDED.on_behalf_of, occurred_at = EXCLUDED.occurred_at, updated_at = now();
  IF p_completed THEN
    SELECT * INTO v_job FROM public.jobs WHERE id = p_job;
    IF v_job.status IS DISTINCT FROM 'completed' THEN
      UPDATE public.jobs SET status = 'completed', started_at = COALESCE(started_at, v_in), completed_at = COALESCE(v_out, v_in), updated_at = now()
       WHERE id = p_job;
    END IF;
  END IF;
  PERFORM set_config('app.job_days_writing', '', true);
  PERFORM set_config('app.backfill', '', true);
  RETURN jsonb_build_object('time_entry_id', v_entry, 'hours', v_hours, 'completed', p_completed);
END $$;

CREATE OR REPLACE FUNCTION public.admin_backfill_unit(p_job uuid, p_tech uuid, p_position text, p_brand text, p_model text,
  p_serial text, p_label text DEFAULT NULL, p_occurred timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; v_id uuid; v_eq uuid;
BEGIN
  SELECT * INTO c FROM public._backfill_ctx(p_job, p_tech);
  IF coalesce(trim(p_model),'') = '' AND coalesce(trim(p_serial),'') = '' THEN RAISE EXCEPTION 'Enter a model or serial number' USING ERRCODE='22023'; END IF;
  IF c.o_customer IS NOT NULL THEN
    INSERT INTO public.equipment(customer_id, company_id, type, brand, model, serial_number, install_date, notes)
      VALUES (c.o_customer, c.o_company, 'ac'::public.equipment_type, nullif(trim(p_brand),''), nullif(trim(p_model),''),
        nullif(trim(p_serial),''), (coalesce(p_occurred, now()) AT TIME ZONE 'Africa/Johannesburg')::date, trim(coalesce(p_label,'') || ' ' || coalesce(p_position,'') || ' unit (job record)'))
      RETURNING id INTO v_eq;
  END IF;
  INSERT INTO public.job_unit_details(company_id, job_id, unit_label, position, brand, model, serial_number, equipment_id, entered_by, on_behalf_of, occurred_at)
    VALUES (c.o_company, p_job, nullif(trim(p_label),''), coalesce(p_position,'indoor'), nullif(trim(p_brand),''), nullif(trim(p_model),''),
      nullif(trim(p_serial),''), v_eq, auth.uid(), p_tech, p_occurred)
    RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Stock draw-down: never double-draws. Skipped when the same stock item is already allocated to this job's commitments.
CREATE OR REPLACE FUNCTION public.admin_backfill_material(p_job uuid, p_tech uuid, p_item text, p_qty numeric,
  p_stock_item uuid DEFAULT NULL, p_draw boolean DEFAULT true, p_occurred timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE c record; v_id uuid; v_drawn numeric := 0; v_note text; s public.cf_stock_items%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public._backfill_ctx(p_job, p_tech);
  IF coalesce(trim(p_item),'') = '' OR coalesce(p_qty,0) <= 0 THEN RAISE EXCEPTION 'Item and a quantity above 0 are required' USING ERRCODE='22023'; END IF;
  IF p_stock_item IS NOT NULL THEN
    SELECT * INTO s FROM public.cf_stock_items WHERE id = p_stock_item AND company_id = c.o_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Stock item not found' USING ERRCODE='P0002'; END IF;
    IF p_draw THEN
      IF EXISTS (SELECT 1 FROM public.cf_stock_allocations a JOIN public.cf_commitments m ON m.id = a.commitment_id
                  WHERE a.stock_item_id = p_stock_item AND m.job_id = p_job) THEN
        v_note := 'Already allocated to this job''s order, not drawn again';
      ELSIF EXISTS (SELECT 1 FROM public.job_materials_used u WHERE u.job_id = p_job AND u.stock_item_id = p_stock_item AND u.drawn_qty > 0) THEN
        v_note := 'Drawn again: this item was already drawn for this job';
        v_drawn := p_qty;
      ELSE v_drawn := p_qty; END IF;
      IF v_drawn > 0 THEN UPDATE public.cf_stock_items SET qty_on_hand = greatest(0, qty_on_hand - v_drawn), updated_at = now() WHERE id = p_stock_item; END IF;
    END IF;
  END IF;
  INSERT INTO public.job_materials_used(company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by, on_behalf_of, occurred_at)
    VALUES (c.o_company, p_job, trim(p_item), p_qty, p_stock_item, coalesce(p_draw,false), v_drawn, v_note, auth.uid(), p_tech, p_occurred)
    RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'drawn_qty', v_drawn, 'note', v_note);
END $$;

-- Undo a backfilled unit/material/time entry (admin). Materials put drawn stock back exactly once.
CREATE OR REPLACE FUNCTION public.admin_backfill_delete(p_kind text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m public.job_materials_used%ROWTYPE; v_co uuid; t public.job_time_entries%ROWTYPE;
BEGIN
  IF p_kind = 'material' THEN
    SELECT * INTO m FROM public.job_materials_used WHERE id = p_id FOR UPDATE; v_co := m.company_id;
  ELSIF p_kind = 'unit' THEN SELECT company_id INTO v_co FROM public.job_unit_details WHERE id = p_id;
  ELSIF p_kind = 'visit' THEN SELECT * INTO t FROM public.job_time_entries WHERE id = p_id AND on_behalf_of IS NOT NULL;
    SELECT company_id INTO v_co FROM public.jobs WHERE id = t.job_id;
  ELSE RAISE EXCEPTION 'Unknown kind'; END IF;
  IF NOT public.fl_is_company_admin(auth.uid(), v_co) THEN RAISE EXCEPTION 'Only an admin can remove this' USING ERRCODE='42501'; END IF;
  IF p_kind = 'material' THEN
    IF m.drawn_qty > 0 AND m.stock_item_id IS NOT NULL THEN
      UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand + m.drawn_qty, updated_at = now() WHERE id = m.stock_item_id; END IF;
    DELETE FROM public.job_materials_used WHERE id = p_id;
  ELSIF p_kind = 'unit' THEN
    DELETE FROM public.equipment WHERE id = (SELECT equipment_id FROM public.job_unit_details WHERE id = p_id);
    DELETE FROM public.job_unit_details WHERE id = p_id;
  ELSE
    DELETE FROM public.presence_visits WHERE job_id = t.job_id AND user_id = t.agent_id AND visit_date = t.work_date AND arrived_source = 'admin_backfill';
    DELETE FROM public.job_time_entries WHERE id = p_id;
  END IF;
END $$;

-- Job's on-behalf records for the admin panel (names resolved).
CREATE OR REPLACE FUNCTION public.admin_backfill_list(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_co uuid;
BEGIN
  SELECT company_id INTO v_co FROM public.jobs WHERE id = p_job;
  IF NOT public.fl_is_company_admin(auth.uid(), v_co) THEN RAISE EXCEPTION 'Admins only' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'visits', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'work_date', e.work_date, 'start', e.start_time, 'end', e.end_time,
        'hours', e.hours_worked, 'tech', pt.full_name, 'by', pb.full_name, 'entered_at', e.entered_at, 'on_behalf', e.on_behalf_of IS NOT NULL)
        ORDER BY e.work_date DESC, e.start_time DESC), '[]')
      FROM public.job_time_entries e LEFT JOIN public.profiles pt ON pt.id = e.agent_id LEFT JOIN public.profiles pb ON pb.id = e.entered_by
      WHERE e.job_id = p_job),
    'units', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'label', u.unit_label, 'position', u.position, 'brand', u.brand,
        'model', u.model, 'serial', u.serial_number, 'tech', pt.full_name, 'by', pb.full_name, 'entered_at', u.entered_at) ORDER BY u.created_at), '[]')
      FROM public.job_unit_details u LEFT JOIN public.profiles pt ON pt.id = u.on_behalf_of LEFT JOIN public.profiles pb ON pb.id = u.entered_by
      WHERE u.job_id = p_job),
    'materials', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'item', m.item, 'qty', m.qty, 'drawn_qty', m.drawn_qty, 'note', m.draw_note,
        'tech', pt.full_name, 'by', pb.full_name, 'entered_at', m.entered_at) ORDER BY m.created_at), '[]')
      FROM public.job_materials_used m LEFT JOIN public.profiles pt ON pt.id = m.on_behalf_of LEFT JOIN public.profiles pb ON pb.id = m.entered_by
      WHERE m.job_id = p_job));
END $$;

REVOKE ALL ON FUNCTION public.admin_backfill_visit(uuid,uuid,date,time,time,boolean,text), public.admin_backfill_unit(uuid,uuid,text,text,text,text,text,timestamptz),
  public.admin_backfill_material(uuid,uuid,text,numeric,uuid,boolean,timestamptz), public.admin_backfill_delete(text,uuid), public.admin_backfill_list(uuid),
  public._backfill_ctx(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_backfill_visit(uuid,uuid,date,time,time,boolean,text), public.admin_backfill_unit(uuid,uuid,text,text,text,text,text,timestamptz),
  public.admin_backfill_material(uuid,uuid,text,numeric,uuid,boolean,timestamptz), public.admin_backfill_delete(text,uuid), public.admin_backfill_list(uuid) TO authenticated;
