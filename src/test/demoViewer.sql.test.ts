import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { liveWebsiteCompanyId } from "@/lib/demoViewer";

const roleSql = readFileSync("supabase/migrations/20261119180000_demo_viewer_readonly.sql", "utf8");
const seedSql = readFileSync("supabase/migrations/20261119181000_demo_ux_company_seed.sql", "utf8");
const MASSAIR = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const DEMO = "d390de40-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEWER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DEMO_ROW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OTHER_ROW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("demo viewer migration text", () => {
  it("does not name Massair CT or embed a password", () => {
    for (const sql of [roleSql, seedSql]) {
      expect(sql).not.toContain(MASSAIR);
      expect(sql).not.toMatch(/password\s*[:=]\s*'[^']+'/i);
      expect(sql).not.toMatch(/encrypted_password\s*,\s*'\$2/i);
    }
  });

  it("keeps the demo company insert-only and off the shared number sequences", () => {
    expect(seedSql).toContain(DEMO);
    expect(seedSql).toContain("Field Lynk Demo UX");
    expect(seedSql).toContain("DEMO-Q-1001");
    expect(seedSql).toContain("DEMO-INV-1001");
    expect(seedSql).toContain("Amahle Dlamini (FAKE)");
    expect(seedSql).not.toMatch(/generate_invoice_number|generate_quote_number|nextval\s*\(/i);
    expect(seedSql).not.toMatch(/UPDATE\s+public\.companies/i);
    expect(seedSql).not.toMatch(/DELETE\s+FROM\s+public\.companies/i);
    expect(seedSql).toContain("create_demo_viewer_login(p_email text, p_password text)");
    expect(seedSql).not.toMatch(/p_password text\s+DEFAULT/i);
    expect(roleSql).toContain("zz_demo_viewer_no_ins");
    expect(roleSql).toContain("assert_not_readonly_viewer");
    expect(roleSql).toContain("is_demo");
  });

  it("refuses a demo company as a live website destination", () => {
    expect(liveWebsiteCompanyId(DEMO, true)).toBeNull();
    expect(liveWebsiteCompanyId(MASSAIR, false)).toBe(MASSAIR);
    expect(liveWebsiteCompanyId(MASSAIR, null)).toBe(MASSAIR);
  });
});

describe("demo viewer enforcement", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      INSERT INTO auth.me VALUES (NULL);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = auth, public AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      GRANT SELECT ON auth.me TO authenticated;
      CREATE TYPE public.app_role AS ENUM ('admin', 'field_agent', 'dispatcher', 'viewer', 'platform_super_admin', 'platform_ops');
      CREATE TABLE public.user_roles (user_id uuid, role public.app_role, UNIQUE (user_id, role));
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, full_name text);
      CREATE TABLE public.companies (
        id uuid PRIMARY KEY,
        name text NOT NULL,
        slug text,
        is_master boolean NOT NULL DEFAULT false,
        status text NOT NULL DEFAULT 'active',
        onboarding_completed boolean,
        mandy_enabled boolean DEFAULT true,
        billing_live boolean DEFAULT false,
        office_address text,
        accounts_email text,
        vat_rate numeric
      );
      CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
      $$;
      CREATE FUNCTION public.get_user_company_id(_user_id uuid) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT company_id FROM public.profiles WHERE id = _user_id
      $$;
      CREATE TABLE public.customers (
        id uuid PRIMARY KEY,
        company_id uuid,
        name text NOT NULL,
        phone text NOT NULL
      );
      ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.companies FORCE ROW LEVEL SECURITY;
      ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
      CREATE POLICY customers_company ON public.customers FOR ALL TO authenticated
        USING (company_id IS NOT DISTINCT FROM public.get_user_company_id(auth.uid()))
        WITH CHECK (company_id IS NOT DISTINCT FROM public.get_user_company_id(auth.uid()));
      GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT USAGE ON SCHEMA auth TO authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
      GRANT EXECUTE ON FUNCTION public.get_user_company_id(uuid) TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
      GRANT SELECT ON public.companies TO authenticated;
    `);
    await db.exec(roleSql);
    await db.exec(`
      INSERT INTO public.companies (id, name, is_master, is_demo, status) VALUES
        ('${DEMO}', 'Field Lynk Demo UX', false, true, 'active'),
        ('${OTHER}', 'Other HVAC (Pty) Ltd', false, false, 'active');
      INSERT INTO public.profiles (id, company_id, full_name) VALUES
        ('${VIEWER}', '${DEMO}', 'Demo designer'),
        ('${ADMIN}', '${OTHER}', 'Office admin');
      INSERT INTO public.user_roles (user_id, role) VALUES
        ('${VIEWER}', 'viewer'),
        ('${ADMIN}', 'admin');
      INSERT INTO public.customers (id, company_id, name, phone) VALUES
        ('${DEMO_ROW}', '${DEMO}', 'Amahle Dlamini (FAKE)', '0800001001'),
        ('${OTHER_ROW}', '${OTHER}', 'Other client', '0800001998');
      CREATE FUNCTION public.demo_try_customer(p_id uuid, p_company uuid, p_name text) RETURNS void
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
      BEGIN
        INSERT INTO public.customers (id, name, phone, company_id) VALUES (p_id, p_name, '0800001999', p_company);
      END
      $fn$;
      GRANT EXECUTE ON FUNCTION public.demo_try_customer(uuid, uuid, text) TO authenticated;
      CREATE FUNCTION public.send_demo_ping() RETURNS void LANGUAGE plpgsql AS $function$
      BEGIN
        PERFORM 1; -- net.http_post would leave the database
      END;
      $function$;
      GRANT EXECUTE ON FUNCTION public.send_demo_ping() TO authenticated;
    `);
    await db.exec("SELECT public.install_demo_viewer_send_guards()");
  }, 30000);

  async function asUser(id: string) {
    await db.exec("RESET ROLE");
    await db.exec(`UPDATE auth.me SET uid = '${id}'`);
    await db.exec("SET ROLE authenticated");
  }

  async function asOwner() {
    await db.exec("RESET ROLE");
    await db.exec("UPDATE auth.me SET uid = NULL");
  }

  it("lets a viewer read the demo company and hides the other company", async () => {
    await asUser(VIEWER);
    const seen = await db.query<{ name: string }>("SELECT name FROM public.customers ORDER BY name");
    expect(seen.rows.map((row) => row.name)).toEqual(["Amahle Dlamini (FAKE)"]);
    const companies = await db.query<{ name: string }>("SELECT name FROM public.companies");
    expect(companies.rows.map((row) => row.name)).toEqual(["Field Lynk Demo UX"]);
    await asOwner();
  });

  it("rejects viewer insert, update, delete, and a security-definer write", async () => {
    await asUser(VIEWER);
    await expect(db.exec(`INSERT INTO public.customers (id, company_id, name, phone) VALUES ('11111111-1111-4111-8111-111111111111', '${DEMO}', 'Nope', '0800001009')`)).rejects.toThrow(/view-only|row-level security/i);
    await expect(db.exec(`UPDATE public.customers SET name = 'Changed' WHERE id = '${DEMO_ROW}'`)).rejects.toThrow(/view-only|row-level security/i);
    await expect(db.exec(`DELETE FROM public.customers WHERE id = '${DEMO_ROW}'`)).rejects.toThrow(/view-only|row-level security/i);
    await expect(db.exec(`SELECT public.demo_try_customer('22222222-2222-4222-8222-222222222222', '${DEMO}', 'Nope')`)).rejects.toThrow(/view-only/i);
    await expect(db.exec("SELECT public.send_demo_ping()")).rejects.toThrow(/view-only/i);
    await asOwner();
    const count = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM public.customers");
    expect(count.rows[0].n).toBe("2");
  });

  it("still lets an admin of another company write their own rows", async () => {
    await asUser(ADMIN);
    await db.exec(`SELECT public.demo_try_customer('33333333-3333-4333-8333-333333333333', '${OTHER}', 'Admin added')`);
    await db.exec("SELECT public.send_demo_ping()");
    const seen = await db.query<{ name: string }>("SELECT name FROM public.customers WHERE company_id = '" + OTHER + "' ORDER BY name");
    expect(seen.rows.map((row) => row.name)).toContain("Admin added");
    expect(seen.rows.map((row) => row.name)).toContain("Other client");
    await asOwner();
    const demo = await db.query<{ name: string }>(`SELECT name FROM public.customers WHERE id = '${DEMO_ROW}'`);
    expect(demo.rows[0].name).toBe("Amahle Dlamini (FAKE)");
  });
});
