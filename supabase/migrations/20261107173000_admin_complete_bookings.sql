-- Mark completed: book the days and the materials (Johan 7 Nov 2026).
-- Two choices only, and only when this job already has that info:
--   keep_add  — insert new job_schedules / new draws beside what is already there
--   override  — delete this job's schedule rows and replace its draws, then insert the new ones
-- Existing rows are not updated in place. Other jobs' schedules, draws, reservations and
-- stock_movements are left alone. Quiet backfill: no client or rep alerts, no balance invoice.
-- Days are Johannesburg wall-clock dates on job_schedules (the calendar / today list).
-- Materials draw through job_materials_used + cf_stock_items.qty_on_hand, the same draw the job already uses.

CREATE OR REPLACE FUNCTION public.job_days_on_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_today date; v_prev text; v_at timestamptz;
BEGIN
  -- This completion already wrote the days it wants kept. Don't drop or renumber them.
  IF current_setting('app.admin_complete_schedule', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.job_schedules WHERE job_id = NEW.id AND day_count > 1) THEN RETURN NEW; END IF;
  v_at := COALESCE(NEW.completed_at, now());
  v_today := (v_at AT TIME ZONE 'Africa/Johannesburg')::date;
  v_prev := current_setting('app.job_days_writing', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  UPDATE public.job_time_entries SET checked_out_at = v_at, end_time = (v_at AT TIME ZONE 'Africa/Johannesburg')::time,
         hours_auto = GREATEST(round((extract(epoch FROM (v_at - checked_in_at)) / 3600.0)::numeric, 2), 0),
         hours_worked = GREATEST(round((extract(epoch FROM (v_at - checked_in_at)) / 3600.0)::numeric, 2), 0)
   WHERE job_id = NEW.id AND checked_in_at IS NOT NULL AND checked_out_at IS NULL;
  DELETE FROM public.job_schedules s WHERE s.job_id = NEW.id AND s.scheduled_date > v_today
     AND NOT EXISTS (SELECT 1 FROM public.job_time_entries e WHERE e.job_id = NEW.id AND e.work_date = s.scheduled_date);
  WITH o AS (SELECT id, row_number() OVER (ORDER BY scheduled_date) AS n, count(*) OVER () AS c FROM public.job_schedules WHERE job_id = NEW.id)
  UPDATE public.job_schedules s SET day_index = CASE WHEN o.c > 1 THEN o.n END, day_count = CASE WHEN o.c > 1 THEN o.c END
    FROM o WHERE o.id = s.id AND (s.day_index IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.n END OR s.day_count IS DISTINCT FROM CASE WHEN o.c > 1 THEN o.c END);
  UPDATE public.jobs SET scheduled_until = (SELECT CASE WHEN count(*) OVER () > 1 THEN (s.scheduled_date + s.end_time) AT TIME ZONE 'Africa/Johannesburg' END
          FROM public.job_schedules s WHERE s.job_id = NEW.id ORDER BY s.scheduled_date DESC LIMIT 1)
   WHERE id = NEW.id;
  PERFORM set_config('app.job_days_writing', COALESCE(v_prev, ''), true);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.job_booked_materials(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE j public.jobs%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fl_job_admin_ok(auth.uid(), j.company_id) THEN
    RAISE EXCEPTION 'Only an admin can read this job''s booked materials' USING ERRCODE = '42501'; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(x ORDER BY x->>'item'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', m.id, 'source', 'used', 'item', m.item, 'qty', m.qty, 'unit', s.stock_unit,
        'drawnQty', m.drawn_qty, 'stockItemId', m.stock_item_id, 'quoteItemId', m.quote_item_id,
        'note', m.draw_note, 'drawnAt', null) AS x
      FROM public.job_materials_used m
      LEFT JOIN public.cf_stock_items s ON s.id = m.stock_item_id AND s.company_id = j.company_id
      WHERE m.job_id = p_job AND m.company_id = j.company_id
      UNION ALL
      SELECT jsonb_build_object(
        'id', a.id, 'source', 'allocation', 'item', c.item, 'qty', a.qty, 'unit', s.stock_unit,
        'drawnQty', null, 'stockItemId', a.stock_item_id, 'quoteItemId', null,
        'note', null, 'drawnAt', a.drawn_at)
      FROM public.cf_stock_allocations a
      JOIN public.cf_commitments c ON c.id = a.commitment_id AND c.company_id = j.company_id
      LEFT JOIN public.cf_stock_items s ON s.id = a.stock_item_id AND s.company_id = j.company_id
      WHERE c.job_id = p_job AND a.company_id = j.company_id
    ) q
  );
END $$;

DROP FUNCTION IF EXISTS public.admin_mark_job_completed(uuid, timestamptz, text);

CREATE FUNCTION public.admin_mark_job_completed(
  p_job uuid,
  p_at timestamptz,
  p_note text DEFAULT NULL,
  p_visits jsonb DEFAULT NULL,
  p_schedule_mode text DEFAULT NULL,
  p_materials jsonb DEFAULT NULL,
  p_materials_mode text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  j public.jobs%ROWTYPE;
  v_finish date;
  v_n int;
  v_existing int;
  v_tech uuid;
  v_keep_existing int;
  v jsonb;
  v_d date;
  v_st time;
  v_en time;
  i int;
  v_total int := 0;
  v_first record;
  v_last record;
  v_day_count int;
  v_idx int;
  ln jsonb;
  v_item text;
  v_qty numeric;
  v_kind text;
  v_si uuid;
  v_qi uuid;
  s public.cf_stock_items%ROWTYPE;
  v_drawn numeric;
  v_note text;
  m public.job_materials_used%ROWTYPE;
  v_booked boolean;
  v_clashes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO j FROM public.jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.fl_job_admin_ok(auth.uid(), j.company_id) THEN
    RAISE EXCEPTION 'Only an admin can mark a job completed' USING ERRCODE = '42501'; END IF;
  IF j.status = 'completed' THEN RAISE EXCEPTION 'This job is already completed' USING ERRCODE = '22023'; END IF;
  IF j.status = 'cancelled' THEN RAISE EXCEPTION 'This job was cancelled' USING ERRCODE = '22023'; END IF;
  IF p_at IS NULL THEN RAISE EXCEPTION 'Date and time are required' USING ERRCODE = '22023'; END IF;
  IF p_at > now() + interval '5 minutes' THEN RAISE EXCEPTION 'That time is in the future' USING ERRCODE = '22023'; END IF;
  v_finish := (p_at AT TIME ZONE 'Africa/Johannesburg')::date;

  IF p_schedule_mode IS NOT NULL AND p_schedule_mode NOT IN ('keep_add', 'override') THEN
    RAISE EXCEPTION 'Choose add or complete override' USING ERRCODE = '22023'; END IF;
  IF p_materials_mode IS NOT NULL AND p_materials_mode NOT IN ('keep_add', 'override') THEN
    RAISE EXCEPTION 'Choose add or complete override' USING ERRCODE = '22023'; END IF;

  IF p_visits IS NOT NULL THEN
    IF jsonb_typeof(p_visits) <> 'array' OR jsonb_array_length(p_visits) = 0 THEN
      RAISE EXCEPTION 'Add at least one day' USING ERRCODE = '22023'; END IF;
    IF jsonb_array_length(p_visits) > 130 THEN RAISE EXCEPTION 'At most 130 visits' USING ERRCODE = '22023'; END IF;
    IF (SELECT count(DISTINCT x->>'date') FROM jsonb_array_elements(p_visits) x) <> jsonb_array_length(p_visits) THEN
      RAISE EXCEPTION 'Two visits on the same day — combine them or pick another date' USING ERRCODE = '22023'; END IF;
    SELECT count(*) INTO v_existing FROM public.job_schedules WHERE job_id = p_job;
    IF v_existing > 0 AND p_schedule_mode IS NULL THEN
      RAISE EXCEPTION 'Choose whether to add these days or replace the bookings on this job' USING ERRCODE = '22023'; END IF;
    IF v_existing > 0 AND p_schedule_mode = 'keep_add' AND EXISTS (
      SELECT 1 FROM public.job_schedules s2
      JOIN jsonb_array_elements(p_visits) x ON (x->>'date')::date = s2.scheduled_date
      WHERE s2.job_id = p_job
    ) THEN
      RAISE EXCEPTION 'That day is already booked on this job. Add picks another day, or choose Complete override.' USING ERRCODE = '22023'; END IF;
  END IF;

  v_booked := EXISTS (SELECT 1 FROM public.job_materials_used u WHERE u.job_id = p_job AND u.company_id = j.company_id)
    OR EXISTS (SELECT 1 FROM public.cf_stock_allocations a
               JOIN public.cf_commitments c ON c.id = a.commitment_id
               WHERE c.job_id = p_job AND c.company_id = j.company_id AND a.company_id = j.company_id);
  IF p_materials IS NOT NULL AND v_booked AND p_materials_mode IS NULL THEN
    RAISE EXCEPTION 'Choose whether to add these materials or replace what is booked on this job' USING ERRCODE = '22023'; END IF;

  PERFORM set_config('app.backfill', '1', true);
  PERFORM set_config('app.job_admin_action', '1', true);
  PERFORM set_config('app.job_days_writing', '1', true);
  PERFORM set_config('app.admin_complete_schedule', '1', true);

  IF p_visits IS NOT NULL THEN
    IF j.lead_id IS NULL THEN RAISE EXCEPTION 'Visits need a client lead on the job' USING ERRCODE = '22023'; END IF;
    SELECT profile_id INTO v_tech FROM public.assignments WHERE job_id = p_job ORDER BY created_at ASC LIMIT 1;
    SELECT count(*) INTO v_keep_existing FROM public.job_schedules WHERE job_id = p_job;
    IF p_schedule_mode = 'override' OR v_keep_existing = 0 THEN
      DELETE FROM public.job_schedules WHERE job_id = p_job;
      v_keep_existing := 0;
    END IF;
    v_n := jsonb_array_length(p_visits);
    v_day_count := v_keep_existing + v_n;
    i := 0;
    FOR v IN SELECT x FROM jsonb_array_elements(p_visits) x ORDER BY x->>'date', x->>'start' LOOP
      i := i + 1;
      BEGIN
        v_d := (v->>'date')::date; v_st := (v->>'start')::time; v_en := (v->>'end')::time;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Visit % has a bad date or time', i USING ERRCODE = '22023';
      END;
      IF v_d IS NULL OR v_st IS NULL OR v_en IS NULL THEN
        RAISE EXCEPTION 'Visit % needs a date, start and end', i USING ERRCODE = '22023'; END IF;
      IF v_en <= v_st THEN RAISE EXCEPTION 'Visit on % ends before it starts', to_char(v_d, 'DD Mon') USING ERRCODE = '22023'; END IF;
      IF v_d > v_finish THEN RAISE EXCEPTION 'A work day can''t be after the job was finished' USING ERRCODE = '22023'; END IF;
      v_total := v_total + (extract(epoch FROM (v_en - v_st)) / 60)::int;
      v_idx := CASE WHEN v_day_count > 1 THEN v_keep_existing + i END;
      INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes, day_index, day_count)
      VALUES (j.lead_id, p_job, v_tech, v_d, v_st, v_en, j.title,
              v_idx, CASE WHEN v_day_count > 1 THEN v_day_count END);
    END LOOP;

    SELECT scheduled_date, start_time INTO v_first FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date, start_time LIMIT 1;
    SELECT scheduled_date, end_time INTO v_last FROM public.job_schedules WHERE job_id = p_job ORDER BY scheduled_date DESC, end_time DESC LIMIT 1;
    SELECT coalesce(sum((extract(epoch FROM (end_time - start_time)) / 60)::int), 0) INTO v_total
      FROM public.job_schedules WHERE job_id = p_job AND end_time > start_time;
    UPDATE public.jobs SET
      scheduled_for = (v_first.scheduled_date + v_first.start_time) AT TIME ZONE 'Africa/Johannesburg',
      scheduled_until = CASE WHEN (SELECT count(*) FROM public.job_schedules WHERE job_id = p_job) > 1
        THEN (v_last.scheduled_date + v_last.end_time) AT TIME ZONE 'Africa/Johannesburg' END,
      estimated_duration = make_interval(mins => v_total),
      updated_at = now()
    WHERE id = p_job;
    UPDATE public.leads SET scheduled_date = v_first.scheduled_date, scheduled_time = v_first.start_time
    WHERE id = j.lead_id;
  END IF;

  IF p_materials IS NOT NULL THEN
    IF jsonb_typeof(p_materials) <> 'array' THEN RAISE EXCEPTION 'Materials must be a list' USING ERRCODE = '22023'; END IF;
    IF p_materials_mode = 'override' OR NOT v_booked THEN
      IF p_materials_mode = 'override' THEN
        FOR m IN SELECT * FROM public.job_materials_used WHERE job_id = p_job AND company_id = j.company_id FOR UPDATE LOOP
          IF m.drawn_qty > 0 AND m.stock_item_id IS NOT NULL THEN
            UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand + m.drawn_qty, updated_at = now()
            WHERE id = m.stock_item_id AND company_id = j.company_id;
          END IF;
          DELETE FROM public.job_materials_used WHERE id = m.id AND job_id = p_job AND company_id = j.company_id;
        END LOOP;
        DELETE FROM public.cf_stock_allocations a
        USING public.cf_commitments c
        WHERE a.commitment_id = c.id AND c.job_id = p_job AND c.company_id = j.company_id
          AND a.company_id = j.company_id AND a.drawn_at IS NULL;
        UPDATE public.cf_commitments c SET status = 'needed', updated_at = now()
        WHERE c.job_id = p_job AND c.company_id = j.company_id AND c.status = 'in_stock'
          AND NOT EXISTS (SELECT 1 FROM public.cf_stock_allocations x WHERE x.commitment_id = c.id AND x.drawn_at IS NULL);
      END IF;
    END IF;

    FOR ln IN SELECT * FROM jsonb_array_elements(p_materials) LOOP
      v_item := left(trim(coalesce(ln->>'item', '')), 160);
      v_qty := round(coalesce(nullif(ln->>'qty', '')::numeric, 0), 3);
      v_kind := coalesce(ln->>'kind', 'material');
      v_si := nullif(ln->>'stock_item_id', '')::uuid;
      v_qi := nullif(ln->>'quote_item_id', '')::uuid;
      IF v_item = '' OR v_qty <= 0 THEN CONTINUE; END IF;
      IF coalesce(p_materials_mode, 'keep_add') = 'keep_add' AND v_booked AND (
        EXISTS (SELECT 1 FROM public.job_materials_used u WHERE u.job_id = p_job AND u.company_id = j.company_id
                  AND ((v_qi IS NOT NULL AND u.quote_item_id = v_qi) OR (v_si IS NOT NULL AND u.stock_item_id = v_si) OR lower(u.item) = lower(v_item)))
        OR (v_si IS NOT NULL AND EXISTS (SELECT 1 FROM public.cf_stock_allocations a
                  JOIN public.cf_commitments c ON c.id = a.commitment_id
                  WHERE c.job_id = p_job AND c.company_id = j.company_id AND a.company_id = j.company_id AND a.stock_item_id = v_si))
      ) THEN CONTINUE; END IF;

      v_drawn := 0; v_note := NULL; s := NULL;
      IF v_kind IS DISTINCT FROM 'unit' AND v_si IS NOT NULL THEN
        SELECT * INTO s FROM public.cf_stock_items WHERE id = v_si AND company_id = j.company_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'That stock item is not in this company' USING ERRCODE = '42501'; END IF;
        IF EXISTS (SELECT 1 FROM public.cf_stock_allocations a JOIN public.cf_commitments c ON c.id = a.commitment_id
                    WHERE c.job_id = p_job AND c.company_id = j.company_id AND a.stock_item_id = s.id AND a.drawn_at IS NULL) THEN
          v_note := 'Reserved for this job: drawn when installed';
        ELSE
          v_drawn := least(v_qty, greatest(s.qty_on_hand, 0));
          IF v_drawn < v_qty THEN v_note := 'Only ' || trim(to_char(s.qty_on_hand, 'FM999990.000')) || ' ' || s.stock_unit || ' on hand'; END IF;
          UPDATE public.cf_stock_items SET qty_on_hand = qty_on_hand - v_drawn, updated_at = now()
          WHERE id = s.id AND company_id = j.company_id;
        END IF;
        INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by, quote_item_id)
        VALUES (j.company_id, p_job, coalesce(s.item, v_item), v_qty, s.id, true, v_drawn, v_note, auth.uid(), v_qi);
      ELSE
        INSERT INTO public.job_materials_used (company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty, draw_note, entered_by, quote_item_id)
        VALUES (j.company_id, p_job, v_item, v_qty, NULL, false, 0,
                CASE WHEN v_kind = 'unit' THEN 'Quote unit' ELSE 'Not a stock item' END, auth.uid(), v_qi);
      END IF;
    END LOOP;
  END IF;

  UPDATE public.jobs SET status = 'completed', completed_at = p_at, started_at = COALESCE(started_at, p_at), updated_at = now()
  WHERE id = p_job;

  IF p_visits IS NOT NULL AND v_tech IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'date', o.scheduled_date, 'start', to_char(o.start_time, 'HH24:MI'), 'end', to_char(o.end_time, 'HH24:MI'), 'job_id', o.job_id)
        ORDER BY o.scheduled_date, o.start_time), '[]'::jsonb)
      INTO v_clashes
    FROM public.job_schedules n
    JOIN public.job_schedules o ON o.id <> n.id AND o.agent_id = n.agent_id AND o.scheduled_date = n.scheduled_date
      AND o.start_time < n.end_time AND n.start_time < o.end_time AND o.job_id IS DISTINCT FROM p_job
    JOIN public.jobs oj ON oj.id = o.job_id AND oj.company_id = j.company_id
      AND lower(coalesce(oj.status, '')) NOT IN ('cancelled', 'canceled')
    WHERE n.job_id = p_job;
  END IF;

  INSERT INTO public.job_activity_log(job_id, user_id, action, details)
  VALUES (p_job, auth.uid(), 'admin_marked_completed', jsonb_build_object(
    'completed_at', p_at, 'note', NULLIF(btrim(p_note), ''), 'previous_status', j.status,
    'via_linked_admin', NOT public.fl_is_company_admin(auth.uid(), j.company_id), 'quiet', true,
    'schedule_mode', p_schedule_mode, 'materials_mode', p_materials_mode));
  INSERT INTO public.audit_log(table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('jobs', p_job, 'update',
    jsonb_build_object('status', j.status, 'completed_at', j.completed_at, 'started_at', j.started_at),
    jsonb_build_object('event', 'admin_mark_completed', 'status', 'completed', 'completed_at', p_at, 'note', p_note,
      'schedule_mode', p_schedule_mode, 'materials_mode', p_materials_mode),
    auth.uid(), j.company_id);

  PERFORM set_config('app.backfill', '', true);
  PERFORM set_config('app.job_admin_action', '', true);
  PERFORM set_config('app.job_days_writing', '', true);
  PERFORM set_config('app.admin_complete_schedule', '', true);

  RETURN jsonb_build_object('ok', true, 'completed_at', p_at, 'schedule_mode', p_schedule_mode,
    'materials_mode', p_materials_mode, 'clashes', coalesce(v_clashes, '[]'::jsonb), 'quiet', true);
END $$;

REVOKE ALL ON FUNCTION public.admin_mark_job_completed(uuid, timestamptz, text, jsonb, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.job_booked_materials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_job_completed(uuid, timestamptz, text, jsonb, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.job_booked_materials(uuid) TO authenticated;
