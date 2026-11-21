// Mark-completed days and stock draws. PGlite only. No production database.
// node supabase/tests/complete_bookings/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migration = fs.readFileSync(path.join(here, "../../migrations/20261107173000_admin_complete_bookings.sql"), "utf8");
const db = new PGlite();
let failed = 0;
const fail = (m) => { console.error("FAIL", m); failed += 1; };
const q = async (sql) => (await db.query(sql)).rows;

const CO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ADMIN = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const JOB = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const JOB2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const LEAD = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const LEAD2 = "11111111-1111-1111-1111-111111111111";
const TECH = "22222222-2222-2222-2222-222222222222";
const STOCK = "33333333-3333-3333-3333-333333333333";
const STOCK2 = "44444444-4444-4444-4444-444444444444";
const STOCK_OTHER = "55555555-5555-5555-5555-555555555555";

await db.exec(`
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE TABLE public.session_uid(uid uuid);
INSERT INTO public.session_uid VALUES ('${ADMIN}');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.session_uid LIMIT 1 $$;
CREATE FUNCTION public.fl_job_admin_ok(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u = '${ADMIN}' AND c = '${CO}' $$;
CREATE FUNCTION public.fl_is_company_admin(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT u = '${ADMIN}' AND c = '${CO}' $$;

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY, company_id uuid, lead_id uuid, title text, status text, quote_id uuid,
  completed_at timestamptz, started_at timestamptz, scheduled_for timestamptz, scheduled_until timestamptz,
  estimated_duration interval, updated_at timestamptz
);
CREATE TABLE public.leads (id uuid PRIMARY KEY, company_id uuid, scheduled_date date, scheduled_time time, assigned_agent_id uuid, status text);
CREATE TABLE public.job_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, job_id uuid, agent_id uuid,
  scheduled_date date, start_time time, end_time time, notes text, day_index int, day_count int,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, profile_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.job_time_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, work_date date, checked_in_at timestamptz, checked_out_at timestamptz, end_time time, hours_auto numeric, hours_worked numeric);
CREATE TABLE public.job_activity_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, user_id uuid, action text, details jsonb);
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_name text, record_id uuid, action text, old_data jsonb, new_data jsonb, user_id uuid, company_id uuid);
CREATE TABLE public.notifications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text);
CREATE TABLE public.invoices (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, company_id uuid, notes text, status text);
CREATE TABLE public.cf_stock_items (id uuid PRIMARY KEY, company_id uuid, item text, qty_on_hand numeric, stock_unit text, updated_at timestamptz);
CREATE TABLE public.job_materials_used (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_id uuid, item text, qty numeric,
  stock_item_id uuid, draw_stock boolean, drawn_qty numeric, draw_note text, entered_by uuid, quote_item_id uuid
);
CREATE TABLE public.cf_commitments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, job_id uuid, item text, status text, qty numeric, updated_at timestamptz);
CREATE TABLE public.cf_stock_allocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, commitment_id uuid, stock_item_id uuid, qty numeric, drawn_at timestamptz);
CREATE TABLE public.stock_movements (id uuid PRIMARY KEY, company_id uuid, job_id uuid, qty numeric, kind text, bucket text);

INSERT INTO public.leads VALUES ('${LEAD}', '${CO}', '2026-11-04', '12:00', '${TECH}', 'converted'), ('${LEAD2}', '${CO}', '2026-11-02', '09:00', '${TECH}', 'converted');
INSERT INTO public.jobs VALUES
  ('${JOB}', '${CO}', '${LEAD}', 'Install', 'scheduled', null, null, null, '2026-11-04 10:00+00', null, '3 hours', now()),
  ('${JOB2}', '${CO}', '${LEAD2}', 'Other', 'scheduled', null, null, null, '2026-11-02 07:00+00', null, '2 hours', now());
INSERT INTO public.assignments (job_id, profile_id) VALUES ('${JOB}', '${TECH}');
INSERT INTO public.cf_stock_items VALUES
  ('${STOCK}', '${CO}', 'Copper pipe', 10, 'm', now()),
  ('${STOCK2}', '${CO}', 'Wall brackets', 8, 'each', now()),
  ('${STOCK_OTHER}', '${OTHER}', 'Other co copper', 50, 'm', now());
INSERT INTO public.stock_movements VALUES ('66666666-6666-6666-6666-666666666666', '${CO}', '${JOB2}', -1, 'use', 'material_pool');
`);

await db.exec(migration);
await db.exec(`
CREATE OR REPLACE FUNCTION public._quiet_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.backfill', true) = '1' THEN RETURN NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_backfill_quiet BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public._quiet_notify();

CREATE OR REPLACE FUNCTION public._sched_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.job_days_writing', true) = '1' THEN RETURN NEW; END IF;
  INSERT INTO public.notifications (user_id, type, title, body) VALUES ('${ADMIN}', 'job_schedule', 'Job Scheduled', 'ping');
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sched_notify AFTER INSERT ON public.job_schedules FOR EACH ROW EXECUTE FUNCTION public._sched_notify();

CREATE OR REPLACE FUNCTION public._balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.backfill', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    INSERT INTO public.invoices (quote_id, company_id, notes, status) VALUES (NEW.quote_id, NEW.company_id, 'BALANCE', 'draft');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_balance AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public._balance();
CREATE TRIGGER trg_job_days_on_complete AFTER UPDATE OF status ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.job_days_on_complete();
`);

const at = "2026-11-02 10:00:00+02";
const one = await q(`SELECT public.admin_mark_job_completed('${JOB}', '${at}', 'logged', '[{"date":"2026-11-02","start":"08:00","end":"16:00"}]'::jsonb, null, null, null) AS j`);
if (!one[0].j.ok || !one[0].j.quiet) fail("one day did not complete quietly: " + JSON.stringify(one[0].j));
const rows1 = await q(`SELECT scheduled_date::text AS d, to_char(start_time,'HH24:MI') AS s, to_char(end_time,'HH24:MI') AS e FROM public.job_schedules WHERE job_id = '${JOB}'`);
if (rows1.length !== 1 || rows1[0].d !== "2026-11-02" || rows1[0].s !== "08:00") fail("one past day was not written: " + JSON.stringify(rows1));
const done = await q(`SELECT status, (completed_at AT TIME ZONE 'Africa/Johannesburg')::date::text AS d FROM public.jobs WHERE id = '${JOB}'`);
if (done[0].status !== "completed" || done[0].d !== "2026-11-02") fail("completed_at not Johannesburg date: " + JSON.stringify(done));
const notes = await q(`SELECT count(*)::int AS n FROM public.notifications`);
const inv = await q(`SELECT count(*)::int AS n FROM public.invoices`);
if (notes[0].n !== 0) fail("alert was sent");
if (inv[0].n !== 0) fail("balance invoice was raised");

// reopen the job in place so the next checks can call the RPC again
await db.exec(`UPDATE public.jobs SET status = 'scheduled', completed_at = null WHERE id = '${JOB}'`);
await db.exec(`DELETE FROM public.job_schedules WHERE job_id = '${JOB}'`);
await db.exec(`
INSERT INTO public.job_schedules (id, lead_id, job_id, agent_id, scheduled_date, start_time, end_time, notes)
VALUES ('77777777-7777-7777-7777-777777777777', '${LEAD}', '${JOB}', '${TECH}', '2026-11-10', '09:00', '12:00', 'future slot'),
       ('88888888-8888-8888-8888-888888888888', '${LEAD}', '${JOB}', '${TECH}', '2026-11-04', '12:00', '14:00', 'old slot');
INSERT INTO public.job_schedules (id, lead_id, job_id, agent_id, scheduled_date, start_time, end_time)
VALUES ('99999999-9999-9999-9999-999999999999', '${LEAD2}', '${JOB2}', '${TECH}', '2026-11-02', '09:00', '12:00');
INSERT INTO public.job_materials_used (id, company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty)
VALUES ('abababab-abab-abab-abab-abababababab', '${CO}', '${JOB}', 'Copper pipe', 4, '${STOCK}', true, 4);
INSERT INTO public.job_materials_used (id, company_id, job_id, item, qty, stock_item_id, draw_stock, drawn_qty)
VALUES ('cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd', '${CO}', '${JOB2}', 'Copper pipe', 2, '${STOCK}', true, 2);
DELETE FROM public.notifications;
`);

let blocked = "";
try {
  await db.query(`SELECT public.admin_mark_job_completed('${JOB}', '${at}', null, '[{"date":"2026-11-01","start":"08:00","end":"10:00"}]'::jsonb, null, null, null)`);
} catch (e) { blocked = String(e.message); }
if (!blocked.includes("add these days or replace")) fail("missing mode must refuse, got " + blocked);
const still = await q(`SELECT status FROM public.jobs WHERE id = '${JOB}'`);
if (still[0].status !== "scheduled") fail("refused save still changed status");

const added = await q(`SELECT public.admin_mark_job_completed(
  '${JOB}', '${at}', null,
  '[{"date":"2026-11-01","start":"08:00","end":"11:00"},{"date":"2026-11-02","start":"08:00","end":"16:00"}]'::jsonb, 'keep_add',
  '[{"item":"Wall brackets","qty":2,"stock_item_id":"${STOCK2}","kind":"material"}]'::jsonb, 'keep_add') AS j`);
const days = await q(`SELECT id::text, scheduled_date::text AS d, to_char(start_time,'HH24:MI') AS s, day_count FROM public.job_schedules WHERE job_id = '${JOB}' ORDER BY scheduled_date`);
if (days.length !== 4) fail("add should keep two old days and write two new ones, got " + JSON.stringify(days));
const oldFuture = days.find((r) => r.id === "77777777-7777-7777-7777-777777777777");
const oldSlot = days.find((r) => r.id === "88888888-8888-8888-8888-888888888888");
if (!oldFuture || oldFuture.d !== "2026-11-10" || oldFuture.s !== "09:00") fail("future slot was rewritten: " + JSON.stringify(oldFuture));
if (!oldSlot || oldSlot.s !== "12:00") fail("old slot was rewritten: " + JSON.stringify(oldSlot));
if (!days.some((r) => r.d === "2026-11-01") || !days.some((r) => r.d === "2026-11-02")) fail("new days missing " + JSON.stringify(days));
const other = await q(`SELECT to_char(start_time,'HH24:MI') AS s FROM public.job_schedules WHERE id = '99999999-9999-9999-9999-999999999999'`);
if (other[0].s !== "09:00") fail("other job booking moved");
const copper = await q(`SELECT qty_on_hand::float AS q FROM public.cf_stock_items WHERE id = '${STOCK}'`);
const brackets = await q(`SELECT qty_on_hand::float AS q FROM public.cf_stock_items WHERE id = '${STOCK2}'`);
const usedCopper = await q(`SELECT qty::float AS q, drawn_qty::float AS d FROM public.job_materials_used WHERE id = 'abababab-abab-abab-abab-abababababab'`);
if (copper[0].q !== 10) fail("add changed copper on hand " + copper[0].q);
if (brackets[0].q !== 6) fail("brackets should draw 2 from 8, got " + brackets[0].q);
if (usedCopper[0].q !== 4 || usedCopper[0].d !== 4) fail("existing copper row was muddied " + JSON.stringify(usedCopper));
if (!added[0].j.clashes || added[0].j.clashes.length < 1) fail("overlap with the other job should be reported, not refused: " + JSON.stringify(added[0].j));
const moves = await q(`SELECT count(*)::int AS n FROM public.stock_movements WHERE job_id = '${JOB2}'`);
if (moves[0].n !== 1) fail("other job stock movement changed");
if ((await q(`SELECT count(*)::int AS n FROM public.notifications`))[0].n !== 0) fail("add sent an alert");
if ((await q(`SELECT count(*)::int AS n FROM public.invoices`))[0].n !== 0) fail("add raised an invoice");

await db.exec(`UPDATE public.jobs SET status = 'scheduled', completed_at = null WHERE id = '${JOB}'`);
const commit = "12121212-1212-1212-1212-121212121212";
const alloc = "13131313-1313-1313-1313-131313131313";
const allocOther = "14141414-1414-1414-1414-141414141414";
await db.exec(`
INSERT INTO public.cf_commitments (id, company_id, job_id, item, status, qty) VALUES
  ('${commit}', '${CO}', '${JOB}', 'Copper pipe', 'in_stock', 5),
  ('15151515-1515-1515-1515-151515151515', '${CO}', '${JOB2}', 'Copper pipe', 'in_stock', 7);
INSERT INTO public.cf_stock_allocations (id, company_id, commitment_id, stock_item_id, qty) VALUES
  ('${alloc}', '${CO}', '${commit}', '${STOCK}', 5),
  ('${allocOther}', '${CO}', '15151515-1515-1515-1515-151515151515', '${STOCK}', 7);
DELETE FROM public.notifications;
`);
const over = await q(`SELECT public.admin_mark_job_completed(
  '${JOB}', '2026-11-03 11:00:00+02', null,
  '[{"date":"2026-11-02","start":"08:00","end":"12:00"},{"date":"2026-11-03","start":"08:00","end":"15:00"}]'::jsonb, 'override',
  '[{"item":"Copper pipe","qty":3,"stock_item_id":"${STOCK}","kind":"material"},{"item":"Indoor cassette","qty":1,"kind":"unit"}]'::jsonb, 'override') AS j`);
if (!over[0].j.ok) fail("override failed");
const left = await q(`SELECT id::text FROM public.job_schedules WHERE job_id = '${JOB}' AND id IN ('77777777-7777-7777-7777-777777777777','88888888-8888-8888-8888-888888888888')`);
if (left.length) fail("override left old slots " + JSON.stringify(left));
const fresh = await q(`SELECT scheduled_date::text AS d, day_count FROM public.job_schedules WHERE job_id = '${JOB}' ORDER BY scheduled_date`);
if (fresh.length !== 2 || fresh[0].d !== "2026-11-02" || fresh[1].d !== "2026-11-03" || Number(fresh[0].day_count) !== 2) fail("override days " + JSON.stringify(fresh));
if ((await q(`SELECT to_char(start_time,'HH24:MI') AS s FROM public.job_schedules WHERE job_id = '${JOB2}'`))[0].s !== "09:00") fail("override moved the other job");
const copperAfter = (await q(`SELECT qty_on_hand::float AS q FROM public.cf_stock_items WHERE id = '${STOCK}'`))[0].q;
// 10 on hand, put back this job's drawn 4 → 14, draw 3 → 11. Other job's draw is not returned.
if (copperAfter !== 11) fail("override on hand should be 11, got " + copperAfter);
const thisUsed = await q(`SELECT item, qty::float AS q, drawn_qty::float AS d FROM public.job_materials_used WHERE job_id = '${JOB}' ORDER BY item`);
if (thisUsed.length !== 2) fail("override materials " + JSON.stringify(thisUsed));
const copperRow = thisUsed.find((r) => r.item === "Copper pipe");
if (!copperRow || copperRow.d !== 3) fail("new copper draw " + JSON.stringify(copperRow));
if ((await q(`SELECT count(*)::int AS n FROM public.job_materials_used WHERE id = 'abababab-abab-abab-abab-abababababab'`))[0].n !== 0) fail("old copper row was edited instead of replaced");
if ((await q(`SELECT qty::float AS q, drawn_qty::float AS d FROM public.job_materials_used WHERE job_id = '${JOB2}'`))[0].q !== 2) fail("other job materials changed");
if ((await q(`SELECT count(*)::int AS n FROM public.cf_stock_allocations WHERE id = '${alloc}'`))[0].n !== 0) fail("this job reservation stayed");
if ((await q(`SELECT qty::float AS q FROM public.cf_stock_allocations WHERE id = '${allocOther}'`))[0].q !== 7) fail("other job reservation changed");
if ((await q(`SELECT qty_on_hand::float AS q FROM public.cf_stock_items WHERE id = '${STOCK_OTHER}'`))[0].q !== 50) fail("other company stock changed");
if ((await q(`SELECT count(*)::int AS n FROM public.stock_movements`))[0].n !== 1) fail("stock movement ledger was deleted");
const lead = await q(`SELECT scheduled_date::text AS d, to_char(scheduled_time,'HH24:MI') AS t FROM public.leads WHERE id = '${LEAD}'`);
if (lead[0].d !== "2026-11-02" || lead[0].t !== "08:00") fail("lead calendar mirror " + JSON.stringify(lead));
if ((await q(`SELECT count(*)::int AS n FROM public.notifications`))[0].n !== 0) fail("override sent an alert");
if ((await q(`SELECT count(*)::int AS n FROM public.invoices`))[0].n !== 0) fail("override raised an invoice");

let foreign = "";
try {
  await db.exec(`UPDATE public.jobs SET status = 'scheduled', completed_at = null WHERE id = '${JOB}'`);
  await db.query(`SELECT public.admin_mark_job_completed('${JOB}', '${at}', null, '[{"date":"2026-11-01","start":"08:00","end":"09:00"}]'::jsonb, 'override', '[{"item":"Foreign","qty":1,"stock_item_id":"${STOCK_OTHER}","kind":"material"}]'::jsonb, 'override')`);
} catch (e) { foreign = String(e.message); }
if (!foreign.includes("not in this company")) fail("other company stock must be refused, got " + foreign);
if ((await q(`SELECT qty_on_hand::float AS q FROM public.cf_stock_items WHERE id = '${STOCK_OTHER}'`))[0].q !== 50) fail("refused draw still changed other company");

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("complete bookings regression passed");
