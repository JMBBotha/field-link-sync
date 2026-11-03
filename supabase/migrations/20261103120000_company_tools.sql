-- Company tools register (T1). Equipment techs use; never on a job or invoice. Separate from Consumables.
-- Admin/owner edit (all writes via RPCs below). Techs read only their own tools and may report broken/lost.
-- No hard deletes: retire instead. POPIA: only a tech name snapshot is stored, nothing else personal.

DO $$ BEGIN CREATE TYPE public.tool_status AS ENUM ('in_store','in_use','broken','lost','retired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.tool_event_kind AS ENUM ('added','issued','returned','status_changed','reported','edited','retired'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- company_id NULL = the short default list every company sees; admins add their own.
CREATE TABLE IF NOT EXISTS public.tool_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 60),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tool_types_name_uq ON public.tool_types (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
INSERT INTO public.tool_types (company_id, name)
SELECT NULL, n FROM unnest(ARRAY['Flaring kit','Vacuum pump','Gauge set','Recovery unit','Drill','Ladder']) n
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 20),
  name text NOT NULL,
  tool_type_id uuid NOT NULL REFERENCES public.tool_types(id),
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  purchase_date date,
  cost_cents integer CHECK (cost_cents IS NULL OR cost_cents >= 0),
  cost_tbc boolean NOT NULL DEFAULT false,
  invoice_path text,
  assigned_tech_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_tech_name text,
  status public.tool_status NOT NULL DEFAULT 'in_store',
  status_date date NOT NULL DEFAULT current_date,
  retired_date date,
  notes text,
  purchase_batch_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tools_label_uq ON public.tools (company_id, upper(btrim(label)));
CREATE INDEX IF NOT EXISTS tools_company_status_idx ON public.tools (company_id, status);
CREATE INDEX IF NOT EXISTS tools_tech_idx ON public.tools (assigned_tech_id) WHERE assigned_tech_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tool_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  tool_id uuid NOT NULL REFERENCES public.tools(id) ON DELETE RESTRICT,
  event public.tool_event_kind NOT NULL,
  from_status public.tool_status,
  to_status public.tool_status,
  tech_id uuid,
  tech_name text,
  done_by uuid,
  done_by_name text,
  event_date timestamptz NOT NULL DEFAULT now(),
  note text
);
CREATE INDEX IF NOT EXISTS tool_events_tool_idx ON public.tool_events (tool_id, event_date DESC);

-- No deletes anywhere; history is append-only.
CREATE OR REPLACE FUNCTION public._tools_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tools are never deleted. Retire the tool instead.' USING ERRCODE = '42501'; END $$;
CREATE OR REPLACE FUNCTION public._tool_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Tool history is append-only.' USING ERRCODE = '42501'; END $$;
DROP TRIGGER IF EXISTS tools_no_delete ON public.tools;
CREATE TRIGGER tools_no_delete BEFORE DELETE ON public.tools FOR EACH ROW EXECUTE FUNCTION public._tools_no_delete();
DROP TRIGGER IF EXISTS tool_events_append_only ON public.tool_events;
CREATE TRIGGER tool_events_append_only BEFORE UPDATE OR DELETE ON public.tool_events FOR EACH ROW EXECUTE FUNCTION public._tool_events_append_only();

-- Admin (company-scoped) or company owner.
CREATE OR REPLACE FUNCTION public._tools_admin(p_company uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND p_company IS NOT NULL AND (public._cf_ok(p_company) OR public.is_company_owner(auth.uid(), p_company));
$$;
REVOKE ALL ON FUNCTION public._tools_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._tools_admin(uuid) TO authenticated;

ALTER TABLE public.tool_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tool_types_read ON public.tool_types;
CREATE POLICY tool_types_read ON public.tool_types FOR SELECT TO authenticated USING (company_id IS NULL OR company_id = public.caller_company_id());
DROP POLICY IF EXISTS tools_read ON public.tools;
CREATE POLICY tools_read ON public.tools FOR SELECT TO authenticated
  USING (public._tools_admin(company_id) OR (assigned_tech_id = auth.uid() AND company_id = public.caller_company_id()));
DROP POLICY IF EXISTS tool_events_read ON public.tool_events;
CREATE POLICY tool_events_read ON public.tool_events FOR SELECT TO authenticated
  USING (public._tools_admin(company_id) OR EXISTS (SELECT 1 FROM public.tools t WHERE t.id = tool_events.tool_id AND t.assigned_tech_id = auth.uid()));
-- Deliberately no INSERT/UPDATE/DELETE policies: every write goes through the RPCs below.
REVOKE INSERT, UPDATE, DELETE ON public.tools, public.tool_events, public.tool_types FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._tool_me() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT full_name FROM public.profiles WHERE id = auth.uid()), 'Unknown');
$$;
REVOKE ALL ON FUNCTION public._tool_me() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._tool_log(t public.tools, p_event public.tool_event_kind, p_from public.tool_status, p_note text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.tool_events (company_id, tool_id, event, from_status, to_status, tech_id, tech_name, done_by, done_by_name, note)
  VALUES (t.company_id, t.id, p_event, p_from, t.status, t.assigned_tech_id, t.assigned_tech_name, auth.uid(), public._tool_me(), nullif(btrim(coalesce(p_note,'')),''));
$$;
REVOKE ALL ON FUNCTION public._tool_log(public.tools, public.tool_event_kind, public.tool_status, text) FROM PUBLIC, anon, authenticated;

-- In-app alert to the company owner(s) (bell). No email or WhatsApp is sent.
CREATE OR REPLACE FUNCTION public._tool_notify_lost(t public.tools, p_note text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
  SELECT DISTINCT m.user_id, 'tool_lost', 'Tool lost: ' || t.label || ' ' || t.name,
         'Reported by ' || public._tool_me() || CASE WHEN t.assigned_tech_name IS NOT NULL AND t.assigned_tech_name <> public._tool_me() THEN ' · last with ' || t.assigned_tech_name ELSE '' END || coalesce(' · ' || nullif(btrim(p_note),''), ''),
         t.id, jsonb_build_object('route', '/admin/tools?tool=' || t.id::text, 'tool_id', t.id, 'label', t.label)
  FROM public.company_members m WHERE m.company_id = t.company_id AND m.is_owner;
$$;
REVOKE ALL ON FUNCTION public._tool_notify_lost(public.tools, text) FROM PUBLIC, anon, authenticated;

-- Bulk add: one row per label, total cost split evenly (cents remainder on the first tools).
CREATE OR REPLACE FUNCTION public.add_tools(p_company uuid, p_type uuid, p_name text, p_labels text[], p_supplier_name text DEFAULT NULL,
  p_purchase_date date DEFAULT current_date, p_total_cents integer DEFAULT NULL, p_cost_tbc boolean DEFAULT false, p_notes text DEFAULT NULL, p_supplier_id uuid DEFAULT NULL)
RETURNS uuid[] LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := coalesce(array_length(p_labels, 1), 0); b uuid := gen_random_uuid(); ids uuid[] := '{}'; t public.tools; i int; share int; rem int;
BEGIN
  IF NOT public._tools_admin(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF n = 0 OR n > 50 THEN RAISE EXCEPTION 'Give 1 to 50 labels'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tool_types WHERE id = p_type AND (company_id IS NULL OR company_id = p_company)) THEN RAISE EXCEPTION 'Unknown tool type'; END IF;
  share := CASE WHEN p_total_cents IS NULL THEN NULL ELSE p_total_cents / n END; rem := CASE WHEN p_total_cents IS NULL THEN 0 ELSE p_total_cents % n END;
  FOR i IN 1..n LOOP
    INSERT INTO public.tools (company_id, label, name, tool_type_id, supplier_id, supplier_name, purchase_date, cost_cents, cost_tbc, notes, purchase_batch_id, created_by)
    VALUES (p_company, upper(btrim(p_labels[i])), btrim(p_name), p_type, p_supplier_id, nullif(btrim(coalesce(p_supplier_name,'')),''), p_purchase_date,
            CASE WHEN share IS NULL THEN NULL ELSE share + CASE WHEN i <= rem THEN 1 ELSE 0 END END, coalesce(p_cost_tbc, false) OR p_total_cents IS NULL, p_notes, b, auth.uid())
    RETURNING * INTO t;
    PERFORM public._tool_log(t, 'added', NULL, CASE WHEN n > 1 THEN format('Bought as %s of %s', i, n) END);
    ids := ids || t.id;
  END LOOP;
  RETURN ids;
END $$;

CREATE OR REPLACE FUNCTION public.add_tool_type(p_company uuid, p_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  IF NOT public._tools_admin(p_company) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  SELECT id INTO v FROM public.tool_types WHERE (company_id IS NULL OR company_id = p_company) AND lower(btrim(name)) = lower(btrim(p_name));
  IF v IS NULL THEN INSERT INTO public.tool_types (company_id, name) VALUES (p_company, btrim(p_name)) RETURNING id INTO v; END IF;
  RETURN v;
END $$;

-- Edit details (not status/tech). Fields: label, name, tool_type_id, supplier_name, purchase_date, cost_cents, cost_tbc, invoice_path, notes.
CREATE OR REPLACE FUNCTION public.update_tool(p_tool uuid, p_patch jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tools; changed text[];
BEGIN
  SELECT * INTO t FROM public.tools WHERE id = p_tool FOR UPDATE;
  IF t.id IS NULL OR NOT public._tools_admin(t.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF p_patch ? 'tool_type_id' AND NOT EXISTS (SELECT 1 FROM public.tool_types WHERE id = (p_patch->>'tool_type_id')::uuid AND (company_id IS NULL OR company_id = t.company_id)) THEN RAISE EXCEPTION 'Unknown tool type'; END IF;
  SELECT array_agg(k) INTO changed FROM jsonb_object_keys(p_patch) k WHERE k IN ('label','name','tool_type_id','supplier_name','purchase_date','cost_cents','cost_tbc','invoice_path','notes');
  UPDATE public.tools SET
    label = CASE WHEN p_patch ? 'label' THEN upper(btrim(p_patch->>'label')) ELSE label END,
    name = CASE WHEN p_patch ? 'name' THEN btrim(p_patch->>'name') ELSE name END,
    tool_type_id = CASE WHEN p_patch ? 'tool_type_id' THEN (p_patch->>'tool_type_id')::uuid ELSE tool_type_id END,
    supplier_name = CASE WHEN p_patch ? 'supplier_name' THEN nullif(btrim(p_patch->>'supplier_name'),'') ELSE supplier_name END,
    purchase_date = CASE WHEN p_patch ? 'purchase_date' THEN nullif(p_patch->>'purchase_date','')::date ELSE purchase_date END,
    cost_cents = CASE WHEN p_patch ? 'cost_cents' THEN nullif(p_patch->>'cost_cents','')::int ELSE cost_cents END,
    cost_tbc = CASE WHEN p_patch ? 'cost_tbc' THEN (p_patch->>'cost_tbc')::boolean ELSE cost_tbc END,
    invoice_path = CASE WHEN p_patch ? 'invoice_path' THEN nullif(p_patch->>'invoice_path','') ELSE invoice_path END,
    notes = CASE WHEN p_patch ? 'notes' THEN p_patch->>'notes' ELSE notes END,
    updated_at = now()
  WHERE id = p_tool RETURNING * INTO t;
  IF changed IS NOT NULL THEN PERFORM public._tool_log(t, 'edited', t.status, 'Changed ' || array_to_string(changed, ', ')); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.issue_tool(p_tool uuid, p_tech uuid, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tools; prev public.tool_status; nm text;
BEGIN
  SELECT * INTO t FROM public.tools WHERE id = p_tool FOR UPDATE;
  IF t.id IS NULL OR NOT public._tools_admin(t.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.status <> 'in_store' THEN RAISE EXCEPTION 'Only a tool in store can be issued (this one is %)', t.status; END IF;
  SELECT full_name INTO nm FROM public.profiles WHERE id = p_tech AND (company_id = t.company_id OR EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = p_tech AND m.company_id = t.company_id));
  IF nm IS NULL THEN RAISE EXCEPTION 'That person is not in this company'; END IF;
  prev := t.status;
  UPDATE public.tools SET status = 'in_use', status_date = current_date, assigned_tech_id = p_tech, assigned_tech_name = nm, updated_at = now() WHERE id = p_tool RETURNING * INTO t;
  PERFORM public._tool_log(t, 'issued', prev, p_note);
END $$;

CREATE OR REPLACE FUNCTION public.return_tool(p_tool uuid, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tools; prev public.tool_status; tech uuid; tname text;
BEGIN
  SELECT * INTO t FROM public.tools WHERE id = p_tool FOR UPDATE;
  IF t.id IS NULL OR NOT public._tools_admin(t.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.status = 'retired' THEN RAISE EXCEPTION 'Retired tools cannot be returned'; END IF;
  prev := t.status; tech := t.assigned_tech_id; tname := t.assigned_tech_name;
  UPDATE public.tools SET status = 'in_store', status_date = current_date, assigned_tech_id = NULL, assigned_tech_name = NULL, updated_at = now() WHERE id = p_tool RETURNING * INTO t;
  INSERT INTO public.tool_events (company_id, tool_id, event, from_status, to_status, tech_id, tech_name, done_by, done_by_name, note)
  VALUES (t.company_id, t.id, 'returned', prev, 'in_store', tech, tname, auth.uid(), public._tool_me(), nullif(btrim(coalesce(p_note,'')),''));
END $$;

-- Admin status change: broken / lost / retired, or back to in_store (repaired / found). Retired is final.
CREATE OR REPLACE FUNCTION public.set_tool_status(p_tool uuid, p_status public.tool_status, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tools; prev public.tool_status;
BEGIN
  SELECT * INTO t FROM public.tools WHERE id = p_tool FOR UPDATE;
  IF t.id IS NULL OR NOT public._tools_admin(t.company_id) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.status = 'retired' THEN RAISE EXCEPTION 'This tool is retired'; END IF;
  IF p_status = 'in_use' THEN RAISE EXCEPTION 'Use Issue to give a tool to a tech'; END IF;
  IF p_status = t.status THEN RETURN; END IF;
  prev := t.status;
  UPDATE public.tools SET status = p_status, status_date = current_date,
    retired_date = CASE WHEN p_status = 'retired' THEN current_date ELSE retired_date END,
    assigned_tech_id = CASE WHEN p_status IN ('in_store','retired') THEN NULL ELSE assigned_tech_id END,
    assigned_tech_name = CASE WHEN p_status IN ('in_store','retired') THEN NULL ELSE assigned_tech_name END,
    updated_at = now() WHERE id = p_tool RETURNING * INTO t;
  PERFORM public._tool_log(t, CASE WHEN p_status = 'retired' THEN 'retired' ELSE 'status_changed' END::public.tool_event_kind, prev, p_note);
  IF p_status = 'lost' THEN PERFORM public._tool_notify_lost(t, p_note); END IF;
END $$;

-- Tech (holding the tool) or admin: report broken or lost. Takes effect at once; owner gets an in-app alert when lost.
CREATE OR REPLACE FUNCTION public.report_tool_issue(p_tool uuid, p_kind public.tool_status, p_note text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.tools; prev public.tool_status;
BEGIN
  IF p_kind NOT IN ('broken','lost') THEN RAISE EXCEPTION 'Report broken or lost only'; END IF;
  SELECT * INTO t FROM public.tools WHERE id = p_tool FOR UPDATE;
  IF t.id IS NULL OR NOT (coalesce(t.assigned_tech_id = auth.uid(), false) OR public._tools_admin(t.company_id)) THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
  IF t.status IN ('retired', p_kind) THEN RAISE EXCEPTION 'This tool is already %', t.status; END IF;
  prev := t.status;
  UPDATE public.tools SET status = p_kind, status_date = current_date, updated_at = now() WHERE id = p_tool RETURNING * INTO t;
  PERFORM public._tool_log(t, 'reported', prev, p_note);
  IF p_kind = 'lost' THEN PERFORM public._tool_notify_lost(t, p_note); END IF;
END $$;

REVOKE ALL ON FUNCTION public.add_tools(uuid,uuid,text,text[],text,date,integer,boolean,text,uuid), public.add_tool_type(uuid,text), public.update_tool(uuid,jsonb),
  public.issue_tool(uuid,uuid,text), public.return_tool(uuid,text), public.set_tool_status(uuid,public.tool_status,text), public.report_tool_issue(uuid,public.tool_status,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_tools(uuid,uuid,text,text[],text,date,integer,boolean,text,uuid), public.add_tool_type(uuid,text), public.update_tool(uuid,jsonb),
  public.issue_tool(uuid,uuid,text), public.return_tool(uuid,text), public.set_tool_status(uuid,public.tool_status,text), public.report_tool_issue(uuid,public.tool_status,text) TO authenticated;

-- Per-type stats (respects RLS of the caller).
CREATE OR REPLACE VIEW public.tool_type_stats WITH (security_invoker = true) AS
SELECT t.company_id, t.tool_type_id, ty.name AS type_name,
  count(*) AS total,
  count(*) FILTER (WHERE t.status = 'in_store') AS in_store,
  count(*) FILTER (WHERE t.status = 'in_use') AS in_use,
  count(*) FILTER (WHERE t.status = 'broken') AS broken,
  count(*) FILTER (WHERE t.status = 'lost') AS lost,
  count(*) FILTER (WHERE t.status = 'retired') AS retired,
  round(avg(coalesce(t.retired_date, t.status_date) - t.purchase_date) FILTER (WHERE t.status IN ('broken','lost','retired') AND t.purchase_date IS NOT NULL)) AS avg_lifespan_days,
  count(*) FILTER (WHERE t.status IN ('broken','lost','retired') AND coalesce(t.retired_date, t.status_date) > current_date - 365) AS replacements_last_12m,
  coalesce(sum(t.cost_cents), 0) AS total_spend_cents,
  count(*) FILTER (WHERE t.cost_tbc) AS cost_tbc_count
FROM public.tools t JOIN public.tool_types ty ON ty.id = t.tool_type_id
GROUP BY t.company_id, t.tool_type_id, ty.name;
GRANT SELECT ON public.tool_type_stats TO authenticated;

-- Private bucket for purchase invoices: <company_id>/<tool or batch id>/<file>. Admin/owner only; read with signed URLs.
DO $$ BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('tool-invoices', 'tool-invoices', false) ON CONFLICT (id) DO NOTHING;
    EXECUTE 'DROP POLICY IF EXISTS tool_invoices_admin_rw ON storage.objects';
    EXECUTE $p$CREATE POLICY tool_invoices_admin_rw ON storage.objects FOR ALL TO authenticated
      USING (bucket_id = 'tool-invoices' AND public._tools_admin(((storage.foldername(name))[1])::uuid))
      WITH CHECK (bucket_id = 'tool-invoices' AND public._tools_admin(((storage.foldername(name))[1])::uuid))$p$;
  END IF;
END $$;
