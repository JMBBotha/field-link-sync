// Column grant for the Company Management select. PGlite only. No production.
// node supabase/tests/company_list/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const select = fs.readFileSync(path.join(here, "../../../src/lib/companyManagementList.ts"), "utf8")
  .match(/COMPANY_MANAGEMENT_SELECT =\s*\n\s*"([^"]+)"/)[1];
const grantSql = fs.readFileSync(path.join(here, "../../migrations/20261105233000_company_list_lock_column_grant.sql"), "utf8")
  .split("\n").filter((l) => l.startsWith("GRANT ")).join("\n");

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
const TEST = "4ddd72cb-56b9-448a-a589-3490bbc464ae";

const db = new PGlite();
let failed = 0;
const fail = (m) => { console.error("FAIL", m); failed += 1; };

await db.exec(`
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE public.session_uid(uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT uid FROM public.session_uid LIMIT 1 $$;
CREATE TABLE public.company_members(user_id uuid, company_id uuid, role text);
CREATE FUNCTION public.is_company_member(uid uuid, cid uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = uid AND m.company_id = cid) $$;
CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text,
  logo_url text,
  status text NOT NULL DEFAULT 'active',
  dormant_payments_locked boolean NOT NULL DEFAULT false,
  default_rate numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  onboarding_completed boolean,
  is_master boolean NOT NULL DEFAULT false,
  custom_service_limit integer NOT NULL DEFAULT 5,
  vat_rate numeric,
  services text[]
);
REVOKE ALL ON public.companies FROM authenticated;
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.companies TO authenticated;
GRANT SELECT (
  id, name, slug, logo_url, status, created_at, updated_at,
  onboarding_completed, is_master, custom_service_limit, vat_rate, services
) ON public.companies TO authenticated;
INSERT INTO public.companies (id, name, status, is_master) VALUES
  ('${CT}', 'Massair CT', 'active', true),
  ('${IND}', 'Massair Ind CC', 'archived', false),
  ('${TEST}', 'TEST', 'active', false);
`);

const asUser = async (sql) => {
  await db.exec("SET ROLE authenticated");
  try {
    return await db.query(sql);
  } finally {
    await db.exec("RESET ROLE");
  }
};

const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
let denied = "";
try {
  await asUser(`SELECT ${select} FROM public.companies`);
} catch (e) {
  denied = String(e.message).split("\n")[0];
}
if (!denied.includes("permission denied for table companies")) {
  fail("ungranted list must be 42501 permission denied for table companies, got " + (denied || "success"));
}

await db.exec(grantSql);
const rows = await asUser(`SELECT ${select} FROM public.companies ORDER BY name`);
const names = rows.rows.map((r) => `${r.name}:${r.status}`);
for (const expected of ["Massair CT:active", "Massair Ind CC:archived", "TEST:active"]) {
  if (!names.includes(expected)) fail("list missing " + expected + " got " + names.join(", "));
}
if (rows.rows.length !== 3) fail("expected 3 companies before RLS, got " + rows.rows.length);

let moneyDenied = "";
try { await asUser("SELECT default_rate FROM public.companies"); }
catch (e) { moneyDenied = String(e.message); }
if (!moneyDenied.includes("permission denied for table companies")) fail("money column must stay ungranted");

await db.exec(`
INSERT INTO public.session_uid VALUES ('${JOHAN}');
INSERT INTO public.company_members VALUES
  ('${JOHAN}', '${CT}', 'admin'),
  ('${JOHAN}', '${IND}', 'admin');
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_select ON public.companies FOR SELECT TO authenticated
  USING (public.is_company_member(auth.uid(), id));
`);
const visible = await asUser(`SELECT id::text, status FROM public.companies ORDER BY name`);
const ids = visible.rows.map((r) => r.id);
if (!ids.includes(CT) || !ids.includes(IND)) fail("Johan must see CT and archived Ind, got " + ids.join(","));
if (ids.includes(TEST)) fail("membership RLS must still hide Test HVAC");
if (visible.rows.find((r) => r.id === IND)?.status !== "archived") fail("Ind must stay archived in the list");

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("company list column grant regression passed");
