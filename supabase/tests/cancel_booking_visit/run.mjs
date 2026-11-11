// In-memory check for cancel_booking_visit. No production database.
// node supabase/tests/cancel_booking_visit/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = fs.readFileSync(path.join(here, "../../migrations/20261111170000_cancel_booking_visit.sql"), "utf8");
const db = new PGlite();
let failed = 0;
const fail = (m) => { console.error("FAIL", m); failed += 1; };
const ok = (c, m) => { if (!c) fail(m); else console.log("ok ", m); };

const CO = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TECH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NEWREP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LEAD = "10101010-1010-4101-8101-101010101010";
const JOB = "20202020-2020-4202-8202-202020202020";
const QUOTE = "30303030-3030-4303-8303-303030303030";
const Q2 = "31313131-3131-4313-8313-313131313131";
const Q3 = "32323232-3232-4323-8323-323232323232";
const GROUP = "40404040-4040-4404-8404-404040404040";

if (/close_lead\s*\(/i.test(mig)) fail("cancel must not call close_lead");
if (/insert\s+into\s+public\.invoices/i.test(mig)) fail("cancel must not insert an invoice");
if (/call_out_excl_vat\s*=/i.test(mig)) fail("cancel must not set a call-out fee");
if (/followup_state\s*=/i.test(mig)) fail("cancel must not write followup_state");
ok(!/jsonb_array_length\(p_visits\) = 0/.test(mig), "empty visit list is allowed");

await db.exec(`
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE public.session_uid(uid uuid);
CREATE TABLE public.session_company(id uuid);
CREATE TABLE public.session_flags(admin boolean, office boolean, sales boolean, owns_lead boolean, owns_customer boolean);
INSERT INTO public.session_uid VALUES ('${ADMIN}');
INSERT INTO public.session_company VALUES ('${CO}');
INSERT INTO public.session_flags VALUES (true, false, false, false, false);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.session_uid LIMIT 1 $$;
CREATE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT id FROM public.session_company LIMIT 1 $$;
CREATE FUNCTION public.fl_job_admin_ok(_uid uuid, _company uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT admin FROM public.session_flags), false) AND _company = public.caller_company_id() $$;
CREATE FUNCTION public.is_office_staff(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT office FROM public.session_flags), false) $$;
CREATE FUNCTION public.is_sales_rep(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT sales FROM public.session_flags), false) $$;
CREATE FUNCTION public.rep_owns_lead(_uid uuid, _lead uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT owns_lead FROM public.session_flags), false) $$;
CREATE FUNCTION public.fl_rep_owns_customer(_uid uuid, _customer uuid, _company uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT owns_customer FROM public.session_flags), false) $$;
CREATE TABLE public.leads (
  id uuid PRIMARY KEY, company_id uuid, customer_id uuid, assigned_agent_id uuid,
  scheduled_date date, scheduled_time time, status text, lead_status text, notes text
);
CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, company_id uuid, lead_id uuid, customer_id uuid, status text,
  scheduled_for timestamptz, scheduled_until timestamptz, updated_at timestamptz,
  call_out_excl_vat numeric, outcome text, quote_id uuid
);
CREATE TABLE public.job_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, job_id uuid, agent_id uuid,
  scheduled_date date, start_time time, end_time time, notes text, day_index int, day_count int,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY, company_id uuid, lead_id uuid, customer_id uuid, quote_number text,
  status text, followup_state text, sales_engineer_id uuid, option_group_id uuid,
  archived_at timestamptz, total numeric
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_id uuid, quote_id uuid,
  status text, grand_total numeric
);
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, record_id uuid, action text,
  old_data jsonb, new_data jsonb, user_id uuid, company_id uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.job_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, user_id uuid, action text,
  details jsonb, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.status_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text, entity_id uuid, field_name text,
  old_status text, new_status text, changed_by uuid, company_id uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, full_name text);
INSERT INTO public.profiles VALUES ('${TECH}', '${CO}', 'Demo Tech'), ('${NEWREP}', '${CO}', 'New Rep'), ('${SALES}', '${CO}', 'Sales');
`);

await db.exec(mig);

const one = async (sql) => (await db.query(sql)).rows[0];
const setFlags = async (admin, office, sales, ownsLead, ownsCustomer, uid = ADMIN, company = CO) => {
  await db.exec(`UPDATE public.session_flags SET admin=${admin}, office=${office}, sales=${sales}, owns_lead=${ownsLead}, owns_customer=${ownsCustomer}`);
  await db.exec(`UPDATE public.session_uid SET uid='${uid}'`);
  await db.exec(`UPDATE public.session_company SET id='${company}'`);
};

await db.exec(`
INSERT INTO public.leads VALUES ('${LEAD}', '${CO}', NULL, '${TECH}', '2026-11-12', '09:00', 'assigned', 'routed', 'keep me');
INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time)
VALUES ('${LEAD}', NULL, '${TECH}', '2026-11-12', '09:00', '12:00');
INSERT INTO public.quotes VALUES ('${QUOTE}', '${CO}', '${LEAD}', NULL, 'Q-D-014', 'sent', 'quoted', '${SALES}', NULL, NULL, 1500);
INSERT INTO public.invoices (company_id, job_id, status, grand_total) VALUES ('${CO}', NULL, 'draft', 10);
`);

await setFlags(false, false, true, false, false, SALES);
let denied = "";
try { await db.query(`SELECT public.cancel_booking_visit('${LEAD}', 'no-show', 'late', NULL)`); }
catch (e) { denied = String(e.message); }
ok(denied.includes("can't cancel"), "sales on someone else's client is refused");
ok((await one(`SELECT status FROM public.leads WHERE id='${LEAD}'`)).status === "assigned", "refused cancel leaves the lead open");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.job_schedules WHERE lead_id='${LEAD}'`)).n) === 1, "refused cancel leaves the schedule");

await setFlags(false, true, false, false, false, ADMIN);
const cancelled = await one(`SELECT public.cancel_booking_visit('${LEAD}', 'Cancelled by client', 'gate code changed', NULL) AS r`);
ok(cancelled.r.invoice === false && cancelled.r.ok === true, "office cancel returns no invoice");
const lead = await one(`SELECT status, lead_status, notes, assigned_agent_id, scheduled_date::text AS d, scheduled_time::text AS t FROM public.leads WHERE id='${LEAD}'`);
ok(lead.status === "assigned" && lead.lead_status === "routed" && lead.notes === "keep me", "lead status and notes stay");
ok(lead.assigned_agent_id === null && lead.d === null && lead.t === null, "assignment and schedule times are cleared");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.job_schedules WHERE lead_id='${LEAD}'`)).n) === 0, "schedule rows are gone");
const quote = await one(`SELECT status, followup_state, total FROM public.quotes WHERE id='${QUOTE}'`);
ok(quote.status === "sent" && quote.followup_state === "quoted" && Number(quote.total) === 1500, "quote and follow-up are untouched");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.invoices`)).n) === 1, "no invoice row was added");
const audit = await one(`SELECT new_data->>'reason' AS reason, new_data->>'note' AS note, new_data->>'invoice' AS invoice FROM public.audit_log ORDER BY created_at DESC LIMIT 1`);
ok(audit.reason === "Cancelled by client" && audit.note === "gate code changed" && audit.invoice === "false", "audit note records the reason");

await db.exec(`
INSERT INTO public.jobs VALUES ('${JOB}', '${CO}', '${LEAD}', NULL, 'scheduled', '2026-11-12 07:00+00', NULL, now(), NULL, NULL, '${QUOTE}');
INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time)
VALUES ('${LEAD}', '${JOB}', '${TECH}', '2026-11-12', '09:00', '12:00');
UPDATE public.leads SET assigned_agent_id='${TECH}', scheduled_date='2026-11-12', scheduled_time='09:00' WHERE id='${LEAD}';
`);
await setFlags(true, false, false, false, false, ADMIN);
const jobCancel = await one(`SELECT public.cancel_booking_visit('${LEAD}', 'no_show', NULL, '${JOB}') AS r`);
ok(jobCancel.r.job_status === "cancelled", "job cancel sets status cancelled");
const job = await one(`SELECT status, call_out_excl_vat, outcome FROM public.jobs WHERE id='${JOB}'`);
ok(job.status === "cancelled" && job.call_out_excl_vat === null && job.outcome === null, "job cancel does not write a call-out");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.job_schedules WHERE job_id='${JOB}' OR lead_id='${LEAD}'`)).n) === 0, "job schedule is cleared");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.invoices`)).n) === 1, "job cancel still adds no invoice");
const quoteAgain = await one(`SELECT followup_state, status FROM public.quotes WHERE id='${QUOTE}'`);
ok(quoteAgain.followup_state === "quoted" && quoteAgain.status === "sent", "job cancel leaves the quote alone");

await setFlags(true, false, false, false, false, ADMIN);
await db.exec(`INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time) VALUES ('${LEAD}', NULL, '${TECH}', '2026-11-13', '08:00', '10:00')`);
const emptied = await one(`SELECT public.set_booking_visits('${LEAD}', '[]'::jsonb) AS r`);
ok(emptied.r.changed === true, "an empty visit list saves");
ok(Number((await one(`SELECT count(*)::int AS n FROM public.job_schedules WHERE lead_id='${LEAD}' AND job_id IS NULL`)).n) === 0, "empty save clears rows");

await db.exec(`INSERT INTO public.job_schedules (lead_id, job_id, agent_id, scheduled_date, start_time, end_time) VALUES ('${LEAD}', NULL, '${TECH}', '2026-11-14', '08:00', '10:00')`);
await setFlags(false, false, true, true, false, SALES);
let repDenied = "";
try { await db.query(`SELECT public.set_booking_visits('${LEAD}', '[]'::jsonb)`); }
catch (e) { repDenied = String(e.message); }
ok(repDenied.includes("Only an admin can remove visits"), "a salesperson still cannot wipe visits from the editor");

await db.exec(`
INSERT INTO public.quotes VALUES
 ('${Q2}', '${CO}', '${LEAD}', NULL, 'Q-D-015', 'sent', 'quoted', '${SALES}', '${GROUP}', NULL, 2200),
 ('${Q3}', '${CO}', '${LEAD}', NULL, 'Q-D-016', 'draft', 'quoted', '${SALES}', '${GROUP}', NULL, 2600),
 ('44444444-4444-4444-8444-444444444444', '${CO}', '${LEAD}', NULL, 'Q-D-099', 'sent', 'quoted', '${SALES}', NULL, NULL, 900);
UPDATE public.quotes SET option_group_id='${GROUP}' WHERE id='${QUOTE}';
`);
await setFlags(true, false, false, false, false, ADMIN);
const moved = await one(`SELECT public.set_quote_group_salesperson('${QUOTE}', '${NEWREP}') AS r`);
ok(moved.r.count === 3, "salesperson change covers every option in the group");
const reps = await db.query(`SELECT id, sales_engineer_id, followup_state, status, quote_number FROM public.quotes ORDER BY quote_number`);
const grouped = reps.rows.filter((r) => r.quote_number !== "Q-D-099");
const alone = reps.rows.find((r) => r.quote_number === "Q-D-099");
ok(grouped.every((r) => r.sales_engineer_id === NEWREP), "each option has the new salesperson");
ok(alone.sales_engineer_id === SALES, "a quote outside the group is left alone");
ok(reps.rows.every((r) => r.followup_state === "quoted"), "option totals and follow-up stay");
const statuses = Object.fromEntries(reps.rows.map((r) => [r.id, r.status]));
ok(statuses[QUOTE] === "sent" && statuses[Q2] === "sent" && statuses[Q3] === "draft", "option statuses stay");

await setFlags(false, false, true, true, false, SALES);
let salesDenied = "";
try { await db.query(`SELECT public.set_quote_group_salesperson('${QUOTE}', '${SALES}')`); }
catch (e) { salesDenied = String(e.message); }
ok(salesDenied.includes("can't change the salesperson"), "a salesperson cannot move the group");

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("cancel_booking_visit ok");
