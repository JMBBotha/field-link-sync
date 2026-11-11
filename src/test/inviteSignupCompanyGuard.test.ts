import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { applicantNotice, isInviteeSignup } from "@/lib/applicantNotice";
import {
  companyOnboardingWrite,
  mayUpdateExistingCompany,
  shouldSkipCompanyOnboarding,
} from "@/lib/companyOnboardingGuard";

const MASSAIR = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const PARTNER = "bbbbbbbb-0000-4000-8000-000000000002";
const PARTNER_ADMIN = "00000000-0000-4000-8000-0000000000f1";
const SALES = "00000000-0000-4000-8000-0000000000d1";
const FOUNDER = "00000000-0000-4000-8000-0000000000c1";
const root = resolve(__dirname, "../..");

const stub = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.me(uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT uid FROM auth.me LIMIT 1';
CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb,
  raw_app_meta_data jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE TYPE public.app_role AS ENUM ('admin','field_agent','dispatcher','viewer','platform_super_admin','platform_ops');
CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  is_master boolean DEFAULT false,
  default_rate numeric,
  services text[],
  vat_rate numeric,
  onboarding_completed boolean
);
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY,
  full_name text NOT NULL,
  phone text,
  company_id uuid,
  dispatch_role text,
  dispatch_active boolean DEFAULT true,
  participant_type text DEFAULT 'company_staff',
  no_login boolean DEFAULT false,
  location_tracking_enabled boolean DEFAULT true,
  availability_status text DEFAULT 'offline',
  network_status text,
  signup_role text,
  signup_company text,
  onboarding_completed boolean DEFAULT false,
  skills text[],
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.company_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  company_id uuid,
  role text,
  is_owner boolean DEFAULT false,
  UNIQUE (user_id, company_id)
);
CREATE TABLE public.user_roles (
  user_id uuid,
  role public.app_role,
  UNIQUE (user_id, role)
);
CREATE TABLE public.team_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  company_id uuid,
  role public.app_role,
  dispatch_role text,
  accepted_at timestamptz,
  accepted_user_id uuid,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  type text,
  title text,
  body text,
  related_id uuid,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  company_name text,
  default_hourly_rate numeric,
  is_primary boolean DEFAULT false
);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS
  'SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)';
CREATE FUNCTION public.is_company_admin(_user_id uuid, _company_id uuid) RETURNS boolean LANGUAGE sql STABLE AS
  'SELECT EXISTS (SELECT 1 FROM public.company_members WHERE user_id = _user_id AND company_id = _company_id AND role = ''admin'')';
CREATE FUNCTION public.get_user_company_id(_user_id uuid) RETURNS uuid LANGUAGE sql STABLE AS
  'SELECT company_id FROM public.profiles WHERE id = _user_id';
CREATE FUNCTION public.is_master_company_user(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS
  'SELECT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = public.get_user_company_id(_uid) AND c.is_master)';
CREATE FUNCTION public.guard_profile_access_fields() RETURNS trigger LANGUAGE plpgsql AS $g$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF current_setting('app.approving_signup', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.network_status IS DISTINCT FROM OLD.network_status OR NEW.signup_role IS DISTINCT FROM OLD.signup_role THEN
    RAISE EXCEPTION 'Only an admin can change signup' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $g$;
CREATE TRIGGER trg_guard_profile_access_fields BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_access_fields();
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company admins can update their company" ON public.companies FOR UPDATE TO authenticated
  USING (public.is_company_admin(auth.uid(), id));
CREATE POLICY "Platform admins can manage all companies" ON public.companies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY settings_member_select ON public.company_settings FOR SELECT TO authenticated
  USING (true);
CREATE POLICY settings_member_update ON public.company_settings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = auth.uid() AND m.company_id = company_settings.company_id));
CREATE POLICY settings_member_insert ON public.company_settings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = auth.uid() AND m.company_id = company_settings.company_id));
INSERT INTO public.companies (id, name, is_master) VALUES ('${MASSAIR}', 'Massair CT', true), ('${PARTNER}', 'Other Co', false);
INSERT INTO public.profiles (id, full_name, company_id) VALUES
  ('${JOHAN}', 'Johan', '${MASSAIR}'),
  ('${PARTNER_ADMIN}', 'Partner Admin', '${PARTNER}');
INSERT INTO public.company_members (user_id, company_id, role, is_owner) VALUES
  ('${JOHAN}', '${MASSAIR}', 'admin', true),
  ('${PARTNER_ADMIN}', '${PARTNER}', 'admin', false);
INSERT INTO public.user_roles (user_id, role) VALUES ('${JOHAN}', 'admin'), ('${PARTNER_ADMIN}', 'admin');
INSERT INTO public.company_settings (company_id, company_name, default_hourly_rate) VALUES
  ('${MASSAIR}', 'Massair CT', 450),
  ('${PARTNER}', 'Other Co', 300);
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON auth.me, auth.users TO authenticated;
`;

describe("company onboarding guard", () => {
  const sales: Parameters<typeof mayUpdateExistingCompany>[0] = {
    companyId: MASSAIR,
    isOwner: false,
    memberAdmin: false,
    adminRoleInCompany: false,
    platformOwner: false,
  };

  it("lets the owner, the company admin, and the platform owner update, and nobody invited", () => {
    expect(mayUpdateExistingCompany(sales)).toBe(false);
    expect(mayUpdateExistingCompany({ ...sales, isOwner: true })).toBe(true);
    expect(mayUpdateExistingCompany({ ...sales, memberAdmin: true })).toBe(true);
    expect(mayUpdateExistingCompany({ ...sales, adminRoleInCompany: true })).toBe(true);
    expect(mayUpdateExistingCompany({ ...sales, platformOwner: true })).toBe(true);
    expect(mayUpdateExistingCompany({ ...sales, companyId: null, isOwner: true })).toBe(false);
  });

  it("skips company onboarding once a company is already set", () => {
    expect(shouldSkipCompanyOnboarding({ company_id: MASSAIR })).toBe(true);
    expect(shouldSkipCompanyOnboarding({ company_id: null })).toBe(false);
    expect(shouldSkipCompanyOnboarding(null)).toBe(false);
    expect(companyOnboardingWrite({ company_id: MASSAIR })).toBe("skip");
    expect(companyOnboardingWrite({ company_id: null })).toBe("create");
  });

  it("shows the sign-up notice from metadata, and does not approve an invitee", () => {
    const notice = applicantNotice({
      metadata: { full_name: "Almari Cloete", email: "cloetealmari@gmail.com", signup_role: "company_new", source: "public_signup", created: "2026-11-11T12:00:00.000Z" },
      createdAt: "2026-11-11T12:00:00.000Z",
    });
    expect(notice).toMatchObject({ name: "Almari Cloete", email: "cloetealmari@gmail.com", role: "New company", source: "public_signup" });
    expect(notice.when).toMatch(/ago/);
    const fromInvite = applicantNotice({
      resolved: { full_name: "Almari Cloete", email: "cloetealmari@gmail.com", invite_role: "dispatcher", invite_lane: "sales", source: "team_invite", created: "2026-11-11T12:00:00.000Z" },
    });
    expect(fromInvite.role).toBe("Invited dispatcher / sales");
    expect(isInviteeSignup({ source: "team_invite" })).toBe(true);
    expect(isInviteeSignup({ source: "public_signup" })).toBe(false);
  });

  it("does not let the onboarding wizard update companies", () => {
    const src = readFileSync(resolve(root, "src/pages/UnifiedOnboarding.tsx"), "utf8");
    expect(src).toContain("mayUpdateExistingCompany");
    expect(src).toContain("shouldSkipCompanyOnboarding");
    expect(src).not.toContain('.from("companies").update');
    expect(src).not.toContain('.from("user_roles").insert');
    const panel = readFileSync(resolve(root, "src/components/team/CompanySignupsPanel.tsx"), "utf8");
    expect(panel).toContain("isInviteeSignup");
    expect(panel).toContain("Invited staff join on Team → Staff");
    const redirect = readFileSync(resolve(root, "src/lib/postLoginRedirect.ts"), "utf8");
    expect(redirect).toContain("shouldSkipCompanyOnboarding");
    const oldSql = readFileSync(resolve(root, "supabase/migrations/20261111153000_no_login_technicians.sql"), "utf8");
    const newSql = readFileSync(resolve(root, "supabase/migrations/20261111180000_invite_signup_company_guard.sql"), "utf8");
    const branch = (sql: string) => {
      const start = sql.indexOf("IF coalesce(NEW.raw_app_meta_data->>'provision', '') = 'no_login_technician' THEN");
      const end = sql.indexOf("RETURN NEW;\n  END IF;", start);
      return sql.slice(start, end + "RETURN NEW;\n  END IF;".length);
    };
    expect(branch(newSql)).toBe(branch(oldSql));
    expect(newSql).toContain("NEW.email_confirmed_at IS NOT NULL /*q4b*/");
    expect(newSql).not.toContain("IF NEW.email_confirmed_at IS NOT NULL /*q4b*/ THEN\n    SELECT * INTO v_inv");
    const harness = readFileSync(resolve(root, "src/pages/SignupNoticeHarness.tsx"), "utf8");
    const list = readFileSync(resolve(root, "src/components/notifications/NotificationsList.tsx"), "utf8");
    expect(harness).toContain("demo.invitee@example.test");
    expect(harness).toContain("Demo — harness, not live sign-ups");
    expect(harness).toContain("notificationHref");
    expect(harness).not.toContain("supabase");
    expect(list).toContain('data-testid="applicant-notice"');
    expect(panel).toContain("previewRows");
    expect(panel).toContain("Harness only. No live approval.");
    expect(panel).toContain("isInviteeSignup");
  });
});

describe("invite signup, approval, and company update SQL", () => {
  const db = new PGlite();
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as Record<string, any>[];
  const asUser = async (uid: string | null, sql: string, params?: unknown[]) => {
    await db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES (${uid ? `'${uid}'` : "NULL"})`);
    await db.exec("SET ROLE authenticated");
    try {
      return await q(sql, params);
    } finally {
      await db.exec("RESET ROLE");
    }
  };

  beforeAll(async () => {
    await db.exec(stub);
    await db.exec(readFileSync(resolve(root, "supabase/migrations/20261111180000_invite_signup_company_guard.sql"), "utf8"));
    await db.exec(`
      CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
    `);
  }, 30000);

  it("files an unconfirmed invite as staff, and accepts it only after the email is confirmed", async () => {
    await db.exec(`
      INSERT INTO public.team_invites (email, company_id, role, dispatch_role)
      VALUES ('cloetealmari@gmail.com', '${MASSAIR}', 'dispatcher', 'sales');
      INSERT INTO auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
      VALUES ('${SALES}', 'cloetealmari@gmail.com', '{}'::jsonb, '{}'::jsonb);
    `);
    const profile = (await q(`SELECT full_name, company_id, dispatch_role, signup_role, network_status, onboarding_completed FROM public.profiles WHERE id = '${SALES}'`))[0];
    expect(profile).toMatchObject({
      full_name: "cloetealmari",
      company_id: MASSAIR,
      dispatch_role: "sales",
      signup_role: null,
      network_status: null,
      onboarding_completed: false,
    });
    expect((await q(`SELECT role::text FROM public.user_roles WHERE user_id = '${SALES}'`))[0].role).toBe("dispatcher");
    expect((await q(`SELECT role, is_owner FROM public.company_members WHERE user_id = '${SALES}'`))[0]).toMatchObject({ role: "member", is_owner: false });
    expect((await q(`SELECT accepted_at FROM public.team_invites WHERE email = 'cloetealmari@gmail.com'`))[0].accepted_at).toBeNull();
    expect((await q(`SELECT count(*)::int n FROM public.notifications WHERE related_id = '${SALES}'`))[0].n).toBe(0);

    await db.exec(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${SALES}'`);
    await db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES ('${SALES}')`);
    const accepted = (await q(`SELECT apply_team_invite('${SALES}', 'cloetealmari@gmail.com') id`))[0].id;
    expect(accepted).toBeTruthy();
    const after = (await q(`SELECT full_name, signup_role, signup_company, network_status, onboarding_completed FROM public.profiles WHERE id = '${SALES}'`))[0];
    expect(after).toMatchObject({
      full_name: "cloetealmari",
      signup_role: null,
      signup_company: null,
      network_status: "approved",
      onboarding_completed: true,
    });
    expect((await q(`SELECT accepted_user_id FROM public.team_invites WHERE email = 'cloetealmari@gmail.com'`))[0].accepted_user_id).toBe(SALES);
  });

  it("replaces a New User name when the invite is accepted, and a confirmed invite never becomes company_new", async () => {
    const stuck = "00000000-0000-4000-8000-0000000000e1";
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
      VALUES ('${stuck}', 'stuck@example.com', now(), '{}'::jsonb);
      UPDATE auth.users SET raw_user_meta_data = '{"full_name":"Almari Cloete"}'::jsonb WHERE id = '${stuck}';
      INSERT INTO public.team_invites (email, company_id, role, dispatch_role)
      VALUES ('stuck@example.com', '${MASSAIR}', 'dispatcher', 'sales');
    `);
    await db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES ('${stuck}')`);
    await q(`SELECT apply_team_invite('${stuck}', 'stuck@example.com')`);
    expect((await q(`SELECT full_name, signup_role, network_status, onboarding_completed FROM public.profiles WHERE id = '${stuck}'`))[0]).toMatchObject({
      full_name: "Almari Cloete",
      signup_role: null,
      network_status: "approved",
      onboarding_completed: true,
    });

    const ready = "00000000-0000-4000-8000-0000000000e2";
    await db.exec(`
      INSERT INTO public.team_invites (email, company_id, role, dispatch_role)
      VALUES ('ready@example.com', '${MASSAIR}', 'dispatcher', 'sales');
      INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
      VALUES ('${ready}', 'ready@example.com', now(), '{"full_name":"Ready Person"}'::jsonb, now());
    `);
    const readyProfile = (await q(`SELECT signup_role, network_status, onboarding_completed, company_id FROM public.profiles WHERE id = '${ready}'`))[0];
    expect(readyProfile).toMatchObject({ signup_role: null, network_status: "approved", onboarding_completed: true, company_id: MASSAIR });
    expect((await q(`SELECT accepted_at IS NOT NULL AS ok FROM public.team_invites WHERE email = 'ready@example.com'`))[0].ok).toBe(true);
    expect((await q(`SELECT count(*)::int n FROM public.notifications WHERE related_id = '${ready}'`))[0].n).toBe(0);
  });

  it("sends a public sign-up notice with name, email, and role, and approves a real founder without touching a company", async () => {
    await db.exec(`
      INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, created_at)
      VALUES ('${FOUNDER}', 'founder@example.com', now(), '{"full_name":"New Founder","signup_role":"company_new","company_name":"Cool Air"}'::jsonb, '2026-11-11T08:00:00Z');
    `);
    const note = (await q(`SELECT body, metadata FROM public.notifications WHERE related_id = '${FOUNDER}' AND type = 'network_applicant'`))[0];
    expect(note.body).toContain("New Founder");
    expect(note.body).toContain("founder@example.com");
    expect(note.body).toContain("company new");
    expect(note.metadata).toMatchObject({
      email: "founder@example.com",
      full_name: "New Founder",
      signup_role: "company_new",
      source: "public_signup",
    });
    const before = (await q(`SELECT name FROM public.companies WHERE id = '${MASSAIR}'`))[0].name;
    await db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES ('${JOHAN}')`);
    expect((await q(`SELECT approve_company_signup('${FOUNDER}', true, NULL) s`))[0].s).toBe("approved");
    const founder = (await q(`SELECT network_status, signup_role, company_id, onboarding_completed FROM public.profiles WHERE id = '${FOUNDER}'`))[0];
    expect(founder).toMatchObject({ network_status: "approved", signup_role: "company_new", company_id: null, onboarding_completed: false });
    expect((await q(`SELECT name FROM public.companies WHERE id = '${MASSAIR}'`))[0].name).toBe(before);
  });

  it("does not approve an invitee into company onboarding", async () => {
    const before = (await q(`SELECT name, default_rate FROM public.companies WHERE id = '${MASSAIR}'`))[0];
    await db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES ('${JOHAN}')`);
    expect((await q(`SELECT approve_company_signup('${SALES}', true, NULL) s`))[0].s).toBe("invitee");
    expect((await q(`SELECT signup_role, network_status, onboarding_completed, company_id FROM public.profiles WHERE id = '${SALES}'`))[0]).toMatchObject({
      signup_role: null,
      network_status: "approved",
      onboarding_completed: true,
      company_id: MASSAIR,
    });
    expect((await q(`SELECT name, default_rate FROM public.companies WHERE id = '${MASSAIR}'`))[0]).toEqual(before);
    const seen = (await asUser(JOHAN, `SELECT get_signup_applicant('${SALES}') j`))[0].j;
    expect(seen.email).toBe("cloetealmari@gmail.com");
    expect(seen.source).toBe("team_invite");
    expect(seen.invite_role).toBe("dispatcher");
    expect(seen.invite_lane).toBe("sales");
    expect((await asUser(SALES, `SELECT get_signup_applicant('${FOUNDER}') j`))[0].j).toBeNull();
    expect((await asUser(PARTNER_ADMIN, `SELECT get_signup_applicant('${SALES}') j`))[0].j).toBeNull();
  });

  it("lets Johan and a company admin update their company, and blocks a salesperson and a partner admin", async () => {
    const renamed = async (uid: string, company: string, name: string) => {
      const rows = await asUser(uid, `UPDATE public.companies SET name = $1 WHERE id = $2 RETURNING id`, [name, company]);
      return { rows: rows.length, name: (await q(`SELECT name FROM public.companies WHERE id = '${company}'`))[0].name };
    };
    expect(await renamed(SALES, MASSAIR, "Hijacked")).toEqual({ rows: 0, name: "Massair CT" });
    expect(await renamed(PARTNER_ADMIN, MASSAIR, "Hijacked")).toEqual({ rows: 0, name: "Massair CT" });
    expect(await renamed(PARTNER_ADMIN, PARTNER, "Other Co Updated")).toEqual({ rows: 1, name: "Other Co Updated" });
    expect(await renamed(JOHAN, MASSAIR, "Massair CT Updated")).toEqual({ rows: 1, name: "Massair CT Updated" });
    expect(await renamed(JOHAN, PARTNER, "Other Co By Johan")).toEqual({ rows: 1, name: "Other Co By Johan" });

    const rate = async (uid: string, company: string, value: number) => {
      const rows = await asUser(uid, `UPDATE public.company_settings SET default_hourly_rate = $1 WHERE company_id = $2 RETURNING id`, [value, company]);
      return { rows: rows.length, rate: Number((await q(`SELECT default_hourly_rate FROM public.company_settings WHERE company_id = '${company}'`))[0].default_hourly_rate) };
    };
    expect((await rate(SALES, MASSAIR, 1)).rows).toBe(0);
    expect((await rate(SALES, MASSAIR, 1)).rate).toBe(450);
    expect(await rate(JOHAN, MASSAIR, 500)).toEqual({ rows: 1, rate: 500 });
    expect((await rate(PARTNER_ADMIN, MASSAIR, 1)).rows).toBe(0);
    expect(await rate(PARTNER_ADMIN, PARTNER, 320)).toEqual({ rows: 1, rate: 320 });
  });
});
