// Company history readers. PGlite only. No production, no email.
// node supabase/tests/company_history/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = fs.readFileSync(path.join(here, "../../migrations/20261105235000_company_history_reader.sql"), "utf8");
const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.company_history_invoices"), sql.indexOf("REVOKE ALL ON FUNCTION"));
const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const db = new PGlite();
let failed = 0;
const fail = (m) => { console.error("FAIL", m); failed += 1; };

await db.exec(`
CREATE SCHEMA auth;
CREATE TABLE public.session_uid(uid uuid);
INSERT INTO public.session_uid VALUES ('${JOHAN}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.session_uid LIMIT 1 $$;
CREATE TABLE public.company_members(user_id uuid, company_id uuid);
INSERT INTO public.company_members VALUES ('${JOHAN}', '${IND}');
CREATE FUNCTION public.p4_co_ok(c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.company_members m WHERE m.user_id = auth.uid() AND m.company_id = c) $$;
CREATE TABLE public.customers(id uuid PRIMARY KEY, company_id uuid, name text, status text, email text, phone text);
CREATE TABLE public.invoices(
  id uuid PRIMARY KEY, company_id uuid, invoice_number text, customer_name text, customer_id uuid,
  status text, grand_total numeric, issue_date date, due_date date, archived_at timestamptz
);
CREATE TABLE public.invoice_items(
  id uuid PRIMARY KEY, invoice_id uuid, description text, line_name text, quantity numeric,
  unit_price numeric, amount numeric, sort_order int, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.payments(
  id uuid PRIMARY KEY, invoice_id uuid, company_id uuid, amount numeric, status text,
  method text, reference text, payment_date date
);
CREATE TABLE public.quotes(
  id uuid PRIMARY KEY, company_id uuid, quote_number text, customer_name text, status text,
  total numeric, archived_at timestamptz, created_at timestamptz DEFAULT now()
);
INSERT INTO public.customers VALUES
  ('cccccccc-cccc-cccc-cccc-ccccccccccc1', '${IND}', 'Open Client', 'active', null, null),
  ('cccccccc-cccc-cccc-cccc-ccccccccccc2', '${IND}', 'PGE Construction', 'archived', null, null);
INSERT INTO public.invoices VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '${IND}', '0001774', 'Open Client', 'cccccccc-cccc-cccc-cccc-ccccccccccc1', 'sent', 100, '2026-09-09', '2026-10-09', null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', '${IND}', '0000001', 'PGE Construction', 'cccccccc-cccc-cccc-cccc-ccccccccccc2', 'sent', 40, '2014-01-01', null, null),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '${CT}', 'CT-1', 'CT Client', null, 'sent', 999, '2026-01-01', null, null);
INSERT INTO public.invoice_items VALUES
  ('dddddddd-dddd-dddd-dddd-ddddddddddd1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Install', 'Install', 1, 100, 100, 1, now());
INSERT INTO public.payments VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', '${IND}', 25, 'paid', 'eft', 'ref', '2026-09-10'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', '${CT}', 999, 'paid', 'eft', 'ct', '2026-01-02');
INSERT INTO public.quotes VALUES
  ('ffffffff-ffff-ffff-ffff-fffffffffff1', '${IND}', 'IND-1', 'Open Client', 'sent', 100, null, now()),
  ('ffffffff-ffff-ffff-ffff-fffffffffff2', '${CT}', 'CT-Q', 'CT Client', 'sent', 999, null, now());
`);
await db.exec(body);

const list = (await db.query(`SELECT public.company_history_invoices('${IND}') AS j`)).rows[0].j;
const numbers = list.map((r) => r.invoice_number).sort();
if (JSON.stringify(numbers) !== JSON.stringify(["0000001", "0001774"])) fail("Ind list mixed or missing: " + JSON.stringify(numbers));
const open = list.find((r) => r.invoice_number === "0001774");
if (Number(open.paid) !== 25) fail("paid should be 25, got " + open.paid);
if (list.find((r) => r.invoice_number === "0000001").customer_status !== "archived") fail("PGE client must stay archived");

let blocked = "";
try { await db.query(`SELECT public.company_history_invoices('${CT}')`); }
catch (e) { blocked = String(e.message); }
if (!blocked.includes("Not allowed")) fail("CT history must be refused for an Ind-only member, got " + blocked);

const detail = (await db.query(`SELECT public.company_history_invoice('${IND}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1') AS j`)).rows[0].j;
if (detail.lines.length !== 1 || detail.lines[0].line_name !== "Install") fail("line missing " + JSON.stringify(detail.lines));
if (detail.payments.length !== 1 || Number(detail.payments[0].amount) !== 25) fail("payment missing " + JSON.stringify(detail.payments));
if (detail.invoice.company_id !== IND) fail("detail company drifted");

let wrong = "";
try { await db.query(`SELECT public.company_history_invoice('${IND}', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3')`); }
catch (e) { wrong = String(e.message); }
if (!wrong.includes("Invoice not found")) fail("CT invoice must not open inside Ind, got " + wrong);

const pays = (await db.query(`SELECT public.company_history_payments('${IND}') AS j`)).rows[0].j;
if (pays.length !== 1 || pays[0].invoice_number !== "0001774") fail("payments leaked " + JSON.stringify(pays));
const quotes = (await db.query(`SELECT public.company_history_quotes('${IND}') AS j`)).rows[0].j;
if (quotes.length !== 1 || quotes[0].quote_number !== "IND-1") fail("quotes leaked " + JSON.stringify(quotes));

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("company history reader regression passed");
