// Escalation skip and auto-read. PGlite only. No production database.
// node supabase/tests/hangup_followup/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../../..");
const mig = fs.readFileSync(path.join(root, "supabase/migrations/20261116220000_hangup_admin_followup.sql"), "utf8");

const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALES = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const db = new PGlite();
let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) fail++; };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = async (uid) => {
  await db.exec("DELETE FROM public.session_uid");
  if (uid) await db.query("INSERT INTO public.session_uid VALUES ($1)", [uid]);
};

await db.exec(fs.readFileSync(path.join(here, "stub.sql"), "utf8"));
await db.exec(mig);

await q(`INSERT INTO companies (id, name) VALUES ($1, 'Massair')`, [CO]);
await q(`INSERT INTO profiles (id, company_id, full_name) VALUES ($1, $2, 'Office Admin'), ($3, $2, 'Sales')`, [ADMIN, CO, SALES]);
await q(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'dispatcher')`, [ADMIN, SALES]);
await q(`INSERT INTO company_settings (company_id, sales_stage_limits) VALUES ($1, '{"hangupSeconds":15}'::jsonb)`, [CO]);
await q(
  `INSERT INTO customers (id, company_id, name, phone) VALUES ($1, $2, 'Blue Crane Cafe', '+27606037097')`,
  [CLIENT, CO],
);

const ago = new Date(Date.now() - 20 * 60 * 1000).toISOString();
const hangup = (await q(
  `INSERT INTO leads (company_id, customer_name, customer_phone, customer_address, status, created_at)
   VALUES ($1, 'Unknown Caller', '+27606037097', 'Address pending — inbound call', 'pending', $2) RETURNING id`,
  [CO, ago],
))[0].id;
const cold = (await q(
  `INSERT INTO leads (company_id, customer_name, customer_address, status, created_at)
   VALUES ($1, 'Sara Adams', '12 Main Road', 'pending', $2) RETURNING id`,
  [CO, ago],
))[0].id;
const real = (await q(
  `INSERT INTO leads (company_id, customer_name, customer_address, status, created_at, assigned_agent_id)
   VALUES ($1, 'Thabo Nkosi', '4 Beach Road', 'pending', $2, $3) RETURNING id`,
  [CO, ago, SALES],
))[0].id;

await q(
  `INSERT INTO vapi_calls (company_id, lead_id, caller_phone, duration_seconds) VALUES ($1, $2, '+27606037097', 5)`,
  [CO, hangup],
);
await q(
  `INSERT INTO call_reports (lead_id, company_id, lead_level, score, next_action, status)
   VALUES ($1, $2, 'cold', 1, 'No follow-up required', 'done')`,
  [cold, CO],
);

ok((await q(`SELECT public.lead_skips_hot_escalation($1) AS s`, [hangup]))[0].s === true, "5s Unknown Caller skips hot escalation");
ok((await q(`SELECT public.lead_skips_hot_escalation($1) AS s`, [cold]))[0].s === true, "cold score 1 / no follow-up skips hot escalation");
ok((await q(`SELECT public.lead_skips_hot_escalation($1) AS s`, [real]))[0].s === false, "a named lead with an address still escalates");

await db.exec("SELECT public.process_sales_escalations()");
const escalated = await q(`SELECT entity_id::text FROM sales_escalations ORDER BY entity_id`);
ok(escalated.length === 1 && escalated[0].entity_id === real, "cron writes one hot-lead row, for the real lead only");
ok((await q(`SELECT count(*)::int n FROM notifications WHERE type = 'sales_nudge' AND related_id = $1`, [hangup]))[0].n === 0, "hang-up lead gets no hot-lead notification");

// Auto-read on a lead the cron did not touch. New Lead, Call Logged, hot-lead.
const closing = (await q(
  `INSERT INTO leads (company_id, customer_name, status) VALUES ($1, 'Close me', 'pending') RETURNING id`,
  [CO],
))[0].id;
const quoteId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const callId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
await q(
  `INSERT INTO notifications (user_id, type, title, read, related_id, metadata) VALUES
     ($1, 'new_lead', 'New Lead', false, $2::uuid, '{}'),
     ($3, 'new_lead', 'New Lead', false, $2::uuid, '{}'),
     ($1, 'call_logged', 'Call Logged', false, $4::uuid, $5::jsonb),
     ($1, 'sales_nudge', 'Hot lead waiting', false, $2::uuid, '{"entity":"lead","stage":"new","level":1}'),
     ($1, 'sales_nudge', 'Quote follow-up', false, $6::uuid, '{"entity":"quote","stage":"followup"}')`,
  [ADMIN, closing, SALES, callId, JSON.stringify({ lead_id: closing }), quoteId],
);

await q(`UPDATE leads SET dismissed_at = now() WHERE id = $1::uuid`, [closing]);
const afterDismiss = await q(
  `SELECT type, read, coalesce(metadata->>'entity','') AS entity
     FROM notifications
    WHERE related_id = $1::uuid OR metadata->>'lead_id' = $1::text
    ORDER BY type`,
  [closing],
);
ok(afterDismiss.length === 4 && afterDismiss.every((r) => r.read === true), "dismiss marks New Lead, Call Logged, and hot-lead read for every recipient");
const quoteNudge = (await q(`SELECT read FROM notifications WHERE related_id = $1::uuid AND metadata->>'entity' = 'quote'`, [quoteId]))[0];
ok(quoteNudge.read === false, "a quote nudge is left unread");

await q(`UPDATE leads SET notes = 'still dismissed' WHERE id = $1::uuid`, [closing]);
ok((await q(`SELECT count(*)::int n FROM notifications WHERE (related_id = $1::uuid OR metadata->>'lead_id' = $1::text) AND read`, [closing]))[0].n === 4, "a later update does not unread or duplicate");

const archived = (await q(
  `INSERT INTO leads (company_id, customer_name, status) VALUES ($1, 'Archive me', 'pending') RETURNING id`,
  [CO],
))[0].id;
await q(`INSERT INTO notifications (user_id, type, title, read, related_id) VALUES ($1, 'new_lead', 'New Lead', false, $2)`, [ADMIN, archived]);
await q(`UPDATE leads SET archived_at = now() WHERE id = $1`, [archived]);
ok((await q(`SELECT read FROM notifications WHERE related_id = $1`, [archived]))[0].read === true, "archive marks New Lead read");

const accepted = (await q(
  `INSERT INTO leads (company_id, customer_name, status) VALUES ($1, 'Accept me', 'pending') RETURNING id`,
  [CO],
))[0].id;
await q(`INSERT INTO notifications (user_id, type, title, read, related_id) VALUES ($1, 'new_lead', 'New Lead', false, $2)`, [SALES, accepted]);
await q(`UPDATE leads SET status = 'accepted' WHERE id = $1`, [accepted]);
ok((await q(`SELECT read FROM notifications WHERE related_id = $1`, [accepted]))[0].read === true, "accept marks New Lead read");

const resolved = (await q(
  `INSERT INTO leads (company_id, customer_name, status, lead_status) VALUES ($1, 'Resolve me', 'pending', 'new') RETURNING id`,
  [CO],
))[0].id;
await q(`INSERT INTO notifications (user_id, type, title, read, related_id) VALUES ($1, 'sales_nudge', 'Hot lead', false, $2)`, [ADMIN, resolved]);
await q(`UPDATE leads SET lead_status = 'resolved_before_visit' WHERE id = $1`, [resolved]);
ok((await q(`SELECT read FROM notifications WHERE related_id = $1`, [resolved]))[0].read === true, "resolved marks the hot-lead alert read");

// Follow-up: no new customer, link an existing one, one admin notification, idempotent.
const beforeCustomers = (await q(`SELECT count(*)::int n FROM customers`))[0].n;
const follow = (await q(
  `SELECT public.log_call_admin_followup($1, '+27606037097', '2026-11-16 13:17:00+00', 5, NULL, 'call-sid-1') AS id`,
  [CO],
))[0].id;
ok(!!follow, "follow-up row created");
ok((await q(`SELECT count(*)::int n FROM customers`))[0].n === beforeCustomers, "follow-up does not create a customer");
const row = (await q(`SELECT customer_id::text, phone, duration_seconds, status FROM call_admin_followups WHERE id = $1`, [follow]))[0];
ok(row.customer_id === CLIENT && row.duration_seconds === 5 && row.status === "open", "follow-up links the existing client and keeps the length");
const notices = await q(`SELECT user_id::text, title, body, read FROM notifications WHERE type = 'call_admin_followup' AND related_id = $1`, [follow]);
ok(notices.length === 1 && notices[0].user_id === ADMIN && notices[0].read === false, "one unread notification, and only for the admin");
ok(notices[0].body.includes("+27606037097") && notices[0].body.includes("5s"), "notification carries the number and the length");
ok(!/unknown caller/i.test(notices[0].body + notices[0].title), "notification does not invent an Unknown Caller");

const again = (await q(
  `SELECT public.log_call_admin_followup($1, '+27606037097', '2026-11-16 13:17:00+00', 5, NULL, 'call-sid-1') AS id`,
  [CO],
))[0].id;
ok(again === follow, "logging the same call again returns the same follow-up");
ok((await q(`SELECT count(*)::int n FROM call_admin_followups`))[0].n === 1, "the second log does not insert another row");
ok((await q(`SELECT count(*)::int n FROM notifications WHERE type = 'call_admin_followup'`))[0].n === 1, "the second log does not insert another notification");

const stranger = (await q(
  `SELECT public.log_call_admin_followup($1, '+27821234567', now(), 4, NULL, 'call-sid-2') AS id`,
  [CO],
))[0].id;
ok((await q(`SELECT customer_id FROM call_admin_followups WHERE id = $1`, [stranger]))[0].customer_id === null, "an unknown number is not linked to a client");
ok((await q(`SELECT count(*)::int n FROM customers`))[0].n === beforeCustomers, "an unknown number still does not create a customer");

await as(SALES);
let salesBlocked = "";
try { await q(`SELECT public.convert_call_admin_followup($1)`, [stranger]); }
catch (e) { salesBlocked = String(e.message); }
ok(/not allowed/i.test(salesBlocked), "a salesperson cannot turn the follow-up into a lead");

await as(ADMIN);
const made = (await q(`SELECT public.convert_call_admin_followup($1) AS j`, [stranger]))[0].j;
const leadId = made.lead_id;
const madeLead = (await q(`SELECT customer_name, customer_id, source FROM leads WHERE id = $1`, [leadId]))[0];
ok(madeLead.customer_name === "+27821234567" && madeLead.customer_id === null, "Make it a lead uses the number and does not create Unknown Caller");
ok((await q(`SELECT count(*)::int n FROM customers`))[0].n === beforeCustomers, "Make it a lead does not create a customer");
const madeAgain = (await q(`SELECT public.convert_call_admin_followup($1) AS j`, [stranger]))[0].j;
ok(madeAgain.lead_id === leadId, "Make it a lead is idempotent");

await q(`SELECT public.dismiss_call_admin_followup($1)`, [follow]);
await q(`SELECT public.dismiss_call_admin_followup($1)`, [follow]);
ok((await q(`SELECT status FROM call_admin_followups WHERE id = $1`, [follow]))[0].status === "dismissed", "dismiss is idempotent");
ok((await q(`SELECT read FROM notifications WHERE related_id = $1 AND type = 'call_admin_followup'`, [follow]))[0].read === true, "dismiss marks the admin follow-up read");

const untouched = (await q(`SELECT customer_name, dismissed_at IS NULL AS open FROM leads WHERE id = $1`, [hangup]))[0];
ok(untouched.customer_name === "Unknown Caller" && untouched.open === true, "the existing Unknown Caller lead is left as it was");

if (fail) {
  console.error(`${fail} failed`);
  process.exit(1);
}
console.log("ALL TESTS PASSED");
