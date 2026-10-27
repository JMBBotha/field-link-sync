-- Project / development house tracker (rebuild of the localStorage "Cooling Progress Tracker").
-- Johan 27 Oct 2026 12:14: "Build it inside Field Lynk under the client" + admin sidebar "Projects" (admin only).
-- UNAPPLIED until Johan's go. Rollback: /workspace/house-tracker-2026-10-27/sql/rollback.sql
-- Access: own company only, admins only (not sales reps, not dispatchers, never field techs).
-- POPIA: no personal data stored here; only house numbers, units and progress. Money is computed from invoices/payments.

CREATE OR REPLACE FUNCTION public.project_admin_ok(_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND _company = public.caller_company_id()
    AND NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_company_admin(auth.uid(), _company));
$$;
REVOKE ALL ON FUNCTION public.project_admin_ok(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.project_admin_ok(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  name text NOT NULL,
  code text,                                   -- e.g. AVEC (matches invoice notes "HOUSE nn - AVEC")
  po_number text,                              -- default PO, e.g. ADV3695
  default_make text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','archived')),
  notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, customer_id, name)
);
CREATE INDEX IF NOT EXISTS projects_customer_idx ON public.projects (customer_id);

CREATE TABLE IF NOT EXISTS public.project_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  name text NOT NULL,
  house_from integer,
  house_to integer,                            -- null = open-ended (91+)
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (house_to IS NULL OR house_from IS NULL OR house_to >= house_from)
);
CREATE INDEX IF NOT EXISTS project_phases_project_idx ON public.project_phases (project_id, sort_order);

CREATE TABLE IF NOT EXISTS public.project_houses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES public.project_phases(id) ON DELETE SET NULL,
  company_id uuid NOT NULL,
  house_no text NOT NULL,                      -- text so "35A" works; sorted numerically in the app
  po_number text,
  make text,
  unit_sizes text,                             -- e.g. "24k + 3x12k"
  units_ordered integer NOT NULL DEFAULT 0 CHECK (units_ordered >= 0),
  units_received integer NOT NULL DEFAULT 0 CHECK (units_received >= 0),
  ready_for_aircon boolean NOT NULL DEFAULT false,   -- Johan's "due for aircon" tick (rule unconfirmed)
  ready_for_aircon_at date,
  status_override text CHECK (status_override IS NULL OR status_override IN ('done','in_progress','due','not_started')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, house_no)
);
CREATE INDEX IF NOT EXISTS project_houses_phase_idx ON public.project_houses (phase_id);

CREATE TABLE IF NOT EXISTS public.project_house_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_id uuid NOT NULL REFERENCES public.project_houses(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  step_key text NOT NULL,                      -- piping | units | commissioning (or custom)
  label text NOT NULL,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  done boolean NOT NULL DEFAULT false,
  done_at timestamptz,
  paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_id, step_key)
);

-- Invoice -> house link (nullable; backfill from notes later, see seed file).
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS project_house_id uuid REFERENCES public.project_houses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS invoices_project_house_idx ON public.invoices (project_house_id) WHERE project_house_id IS NOT NULL;

-- Guards: company_id is copied from the parent and frozen; timestamps kept honest.
CREATE OR REPLACE FUNCTION public.project_child_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE parent_company uuid;
BEGIN
  IF TG_TABLE_NAME = 'project_phases' OR TG_TABLE_NAME = 'project_houses' THEN
    SELECT company_id INTO parent_company FROM public.projects WHERE id = NEW.project_id;
  ELSIF TG_TABLE_NAME = 'project_house_steps' THEN
    SELECT company_id INTO parent_company FROM public.project_houses WHERE id = NEW.house_id;
  END IF;
  IF parent_company IS NULL THEN RAISE EXCEPTION 'parent not found'; END IF;
  NEW.company_id := parent_company;
  IF TG_TABLE_NAME = 'project_houses' THEN
    IF NEW.phase_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.project_phases p WHERE p.id = NEW.phase_id AND p.project_id = NEW.project_id) THEN
      RAISE EXCEPTION 'phase belongs to another project';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'project_house_steps' THEN
    IF NEW.done AND (TG_OP = 'INSERT' OR NOT OLD.done) THEN NEW.done_at := coalesce(NEW.done_at, now()); END IF;
    IF NOT NEW.done THEN NEW.done_at := NULL; END IF;
    IF NEW.paid AND (TG_OP = 'INSERT' OR NOT OLD.paid) THEN NEW.paid_at := coalesce(NEW.paid_at, now()); END IF;
    IF NOT NEW.paid THEN NEW.paid_at := NULL; END IF;
  END IF;
  IF TG_TABLE_NAME <> 'project_phases' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.projects_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.customers c WHERE c.id = NEW.customer_id AND c.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'client belongs to another company';
  END IF;
  IF TG_OP = 'UPDATE' THEN NEW.company_id := OLD.company_id; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS projects_guard_t ON public.projects;
CREATE TRIGGER projects_guard_t BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.projects_guard();
DROP TRIGGER IF EXISTS project_phases_guard_t ON public.project_phases;
CREATE TRIGGER project_phases_guard_t BEFORE INSERT OR UPDATE ON public.project_phases FOR EACH ROW EXECUTE FUNCTION public.project_child_guard();
DROP TRIGGER IF EXISTS project_houses_guard_t ON public.project_houses;
CREATE TRIGGER project_houses_guard_t BEFORE INSERT OR UPDATE ON public.project_houses FOR EACH ROW EXECUTE FUNCTION public.project_child_guard();
DROP TRIGGER IF EXISTS project_house_steps_guard_t ON public.project_house_steps;
CREATE TRIGGER project_house_steps_guard_t BEFORE INSERT OR UPDATE ON public.project_house_steps FOR EACH ROW EXECUTE FUNCTION public.project_child_guard();

-- Invoice link must stay inside the same company.
CREATE OR REPLACE FUNCTION public.invoice_project_house_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.project_house_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.project_houses h WHERE h.id = NEW.project_house_id AND h.company_id = NEW.company_id) THEN
    RAISE EXCEPTION 'house belongs to another company';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoice_project_house_guard_t ON public.invoices;
CREATE TRIGGER invoice_project_house_guard_t BEFORE INSERT OR UPDATE OF project_house_id ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.invoice_project_house_guard();

-- RLS: admins of the caller's own company only.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_phases','project_houses','project_house_steps'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_all', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.project_admin_ok(company_id)) WITH CHECK (public.project_admin_ok(company_id))', t || '_admin_all', t);
  END LOOP;
END $$;
