-- View-only designer login (role already exists: app_role 'viewer').
-- A viewer who also holds admin, dispatcher, field_agent, or a platform role is unchanged.
-- A viewer with no write role can SELECT their own demo company and cannot INSERT, UPDATE, or DELETE.
-- Massair CT policies are not rewritten. These checks are true for every other role.
-- Do not apply this file to the live project until Johan says so. No password is stored here.

CREATE OR REPLACE FUNCTION public.is_readonly_viewer(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL
     AND public.has_role(_user_id, 'viewer'::public.app_role)
     AND NOT public.has_role(_user_id, 'admin'::public.app_role)
     AND NOT public.has_role(_user_id, 'dispatcher'::public.app_role)
     AND NOT public.has_role(_user_id, 'field_agent'::public.app_role)
     AND NOT public.has_role(_user_id, 'platform_super_admin'::public.app_role)
     AND NOT public.has_role(_user_id, 'platform_ops'::public.app_role);
$$;

COMMENT ON FUNCTION public.is_readonly_viewer(uuid) IS
  'True only for a login whose sole app role is viewer. Admins, office, techs, and platform staff are never read-only, even if viewer is also granted.';

REVOKE ALL ON FUNCTION public.is_readonly_viewer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_readonly_viewer(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_not_readonly_viewer()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_readonly_viewer(auth.uid()) THEN
    RAISE EXCEPTION 'This login is view-only. It cannot change or send anything.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.assert_not_readonly_viewer() IS
  'Raises 42501 when the caller is a read-only viewer. Send and mutate functions call this before any email, payment, or write.';

REVOKE ALL ON FUNCTION public.assert_not_readonly_viewer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_not_readonly_viewer() TO authenticated, service_role;

-- Demo companies are never the master company and never take the phone line.
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.companies.is_demo IS
  'True for the fake UX demo company only. Default false, so existing companies including Massair CT stay non-demo. Never route live leads or phone Mandy here.';

CREATE OR REPLACE FUNCTION public.reject_readonly_viewer_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- auth.uid() is null for migrations and the service role, so those writes still run.
  -- A viewer JWT is blocked even inside SECURITY DEFINER functions, which bypass RLS.
  IF public.is_readonly_viewer(auth.uid()) THEN
    RAISE EXCEPTION 'This login is view-only. % on % is not allowed.', TG_OP, TG_TABLE_NAME
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_readonly_viewer_write() FROM PUBLIC;

-- RESTRICTIVE write policies: a no-op for every role except a read-only viewer.
-- SELECT policies let that viewer read rows of their own demo company only.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl, c.relrowsecurity AS rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zz_demo_viewer_write ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE TRIGGER zz_demo_viewer_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_readonly_viewer_write()',
      r.tbl
    );

    IF r.rls THEN
      EXECUTE format('DROP POLICY IF EXISTS zz_demo_viewer_no_ins ON public.%I', r.tbl);
      EXECUTE format('DROP POLICY IF EXISTS zz_demo_viewer_no_upd ON public.%I', r.tbl);
      EXECUTE format('DROP POLICY IF EXISTS zz_demo_viewer_no_del ON public.%I', r.tbl);
      EXECUTE format(
        'CREATE POLICY zz_demo_viewer_no_ins ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_readonly_viewer(auth.uid()))',
        r.tbl
      );
      -- USING (true) keeps the row visible so the write errors instead of quietly matching nothing.
      -- WITH CHECK still refuses the new row. Non-viewers also need a permissive policy.
      EXECUTE format(
        'CREATE POLICY zz_demo_viewer_no_upd ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (true) WITH CHECK (NOT public.is_readonly_viewer(auth.uid()))',
        r.tbl
      );
      EXECUTE format(
        'CREATE POLICY zz_demo_viewer_no_del ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (true)',
        r.tbl
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND c.relname <> 'companies'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS zz_demo_viewer_read ON public.%I', r.tbl);
    EXECUTE format($pol$
      CREATE POLICY zz_demo_viewer_read ON public.%I
      FOR SELECT TO authenticated
      USING (
        public.is_readonly_viewer(auth.uid())
        AND company_id IS NOT DISTINCT FROM public.get_user_company_id(auth.uid())
        AND EXISTS (
          SELECT 1 FROM public.companies demo
          WHERE demo.id = %I.company_id AND demo.is_demo IS TRUE
        )
      )
    $pol$, r.tbl, r.tbl);
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'companies' AND c.relrowsecurity
  ) THEN
    EXECUTE 'DROP POLICY IF EXISTS zz_demo_viewer_read_company ON public.companies';
    EXECUTE $pol$
      CREATE POLICY zz_demo_viewer_read_company ON public.companies
      FOR SELECT TO authenticated
      USING (
        public.is_readonly_viewer(auth.uid())
        AND id IS NOT DISTINCT FROM public.get_user_company_id(auth.uid())
        AND is_demo IS TRUE
      )
    $pol$;
  END IF;
END $$;

-- Child rows (quote lines, invoice lines) have no company_id of their own.
DO $$
DECLARE
  r record;
  pred text;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.relname)
      c.relname AS tbl,
      a.attname AS fk,
      CASE a.attname
        WHEN 'invoice_id' THEN 'invoices'
        WHEN 'quote_id' THEN 'quotes'
        WHEN 'job_id' THEN 'jobs'
        WHEN 'lead_id' THEN 'leads'
        ELSE 'customers'
      END AS parent
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND NOT a.attisdropped
      AND a.attname IN ('invoice_id', 'quote_id', 'job_id', 'lead_id', 'customer_id')
      AND a.atttypid = 'uuid'::regtype
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute co
        WHERE co.attrelid = c.oid AND co.attname = 'company_id' AND NOT co.attisdropped
      )
    ORDER BY c.relname,
      CASE a.attname
        WHEN 'invoice_id' THEN 1
        WHEN 'quote_id' THEN 2
        WHEN 'job_id' THEN 3
        WHEN 'lead_id' THEN 4
        ELSE 5
      END
  LOOP
    pred := format(
      '%I IS NOT NULL AND EXISTS (SELECT 1 FROM public.%I parent JOIN public.companies demo ON demo.id = parent.company_id AND demo.is_demo IS TRUE WHERE parent.id = %I AND parent.company_id IS NOT DISTINCT FROM public.get_user_company_id(auth.uid()))',
      r.fk, r.parent, r.fk
    );
    EXECUTE format('DROP POLICY IF EXISTS zz_demo_viewer_read_child ON public.%I', r.tbl);
    EXECUTE format(
      'CREATE POLICY zz_demo_viewer_read_child ON public.%I FOR SELECT TO authenticated USING (public.is_readonly_viewer(auth.uid()) AND %s)',
      r.tbl, pred
    );
  END LOOP;
END $$;

-- Phone Mandy / Vapi routes cannot point at a demo company. Existing routes are left as they are.
CREATE OR REPLACE FUNCTION public.reject_demo_phone_route()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.companies c WHERE c.id = NEW.company_id AND c.is_demo IS TRUE) THEN
    RAISE EXCEPTION 'Demo companies are not connected to phone Mandy or live lead lines.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.phone_company_routes') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS zz_demo_no_phone_route ON public.phone_company_routes';
    EXECUTE 'CREATE TRIGGER zz_demo_no_phone_route BEFORE INSERT OR UPDATE OF company_id ON public.phone_company_routes FOR EACH ROW EXECUTE FUNCTION public.reject_demo_phone_route()';
  END IF;
END $$;

-- Send functions that post mail or call an HTTP hook refuse a viewer before the request goes out.
CREATE OR REPLACE FUNCTION public.install_demo_viewer_send_guards()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  def text;
  newdef text;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE ns.nspname = 'public'
      AND l.lanname = 'plpgsql'
      AND p.proname NOT IN ('install_demo_viewer_send_guards', 'assert_not_readonly_viewer', 'is_readonly_viewer', 'reject_readonly_viewer_write', 'reject_demo_phone_route', 'create_demo_viewer_login')
      AND pg_get_functiondef(p.oid) ILIKE '%net.http_post%'
      AND position('assert_not_readonly_viewer' in pg_get_functiondef(p.oid)) = 0
  LOOP
    def := pg_get_functiondef(r.oid);
    newdef := regexp_replace(
      def,
      '(\$(?:function|\$)\$[\s\S]*?\mBEGIN\M)',
      E'\\1\n  PERFORM public.assert_not_readonly_viewer();',
      'i'
    );
    IF newdef IS DISTINCT FROM def AND position('assert_not_readonly_viewer' in newdef) > 0 THEN
      BEGIN
        EXECUTE newdef;
        n := n + 1;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'demo viewer guard could not update public.%: %', r.proname, SQLERRM;
      END;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.install_demo_viewer_send_guards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.install_demo_viewer_send_guards() TO service_role;

SELECT public.install_demo_viewer_send_guards();
