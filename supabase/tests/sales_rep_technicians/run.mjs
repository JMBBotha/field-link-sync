// In-memory checks for the salesperson/technician assignment migration. No live database.
// node supabase/tests/sales_rep_technicians/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "../../..");
const mig = path.join(root, "supabase/migrations/20261111180000_sales_rep_technicians.sql");
const rollback = path.join(root, "supabase/manual/20261111180000_sales_rep_technicians_rollback.sql");

const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const JOHAN = "420c7731-e8a4-4355-80ca-51c684b42a2c";
const ALMARI = "f7503c66-0000-4000-8000-000000000001";
const INNOCENT = "09a7f5af-2752-4835-8738-54f7b53083ea";
const OTHER = "11111111-1111-4111-8111-111111111111";
const NOLOGIN = "22222222-2222-4222-8222-222222222222";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER_JOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const db = new PGlite();
let fail = 0;
const ok = (c, m) => { console.log((c ? "ok  " : "FAIL") + " " + m); if (!c) fail++; };
const q = async (sql, params) => (await db.query(sql, params)).rows;
const as = (uid) => db.exec(`DELETE FROM auth.me; INSERT INTO auth.me VALUES (${uid ? `'${uid}'` : "NULL"})`);
const throws = async (fn, re, m) => {
  try { await fn(); ok(false, m + " (no error)"); }
  catch (e) { ok(re.test(String(e.message)), `${m}: ${e.message}`); }
};

await db.exec(fs.readFileSync(path.join(here, "stub.sql"), "utf8"));

const person = async (id, name, role, dispatch, extra = {}) => {
  await q(
    `INSERT INTO profiles (id, full_name, company_id, dispatch_role, participant_type, no_login, dispatch_active)
     VALUES ($1,$2,$3,$4,$5,$6,true)`,
    [id, name, CO, dispatch, extra.participant || "company_staff", !!extra.noLogin],
  );
  await q(`INSERT INTO company_members (user_id, company_id, role) VALUES ($1,$2,$3)`, [id, CO, extra.member || "staff"]);
  if (extra.appRole) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [id, extra.appRole]);
  if (extra.appRole2) await q(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [id, extra.appRole2]);
};

await q(`INSERT INTO companies (id) VALUES ($1)`, [CO]);
await person(JOHAN, "Johan Sales", "sales", "sales", { appRole: "dispatcher" });
await person(ALMARI, "Almari", "sales", "sales", { appRole: "dispatcher" });
await person(INNOCENT, "Innocent", "tech", "technician", { appRole: "field_agent" });
await person(OTHER, "Other Tech", "tech", "technician", { appRole: "field_agent" });
await person(NOLOGIN, "No Login Tech", "tech", "technician", { appRole: "field_agent", noLogin: true });
await person(ADMIN, "Office Admin", "admin", null, { appRole: "admin", member: "admin" });

await db.exec(fs.readFileSync(mig, "utf8"));

const names = async (uid) => {
  await as(uid);
  const rows = await q(`SELECT full_name FROM dispatchable_technicians($1) ORDER BY full_name`, [CO]);
  return rows.map((r) => r.full_name);
};

ok((await q(`SELECT public.sales_may_book_tech($1,$2) ok`, [ADMIN, OTHER]))[0].ok === true, "helper: office may book any tech");
ok((await q(`SELECT public.sales_may_book_tech($1,$2) ok`, [null, OTHER]))[0].ok === true, "helper: signed-out caller is not a sales filter");
ok((await q(`SELECT public.sales_may_book_tech($1,$2) ok`, [JOHAN, INNOCENT]))[0].ok === true, "helper: Johan may book Innocent");
ok((await q(`SELECT public.sales_may_book_tech($1,$2) ok`, [JOHAN, NOLOGIN]))[0].ok === true, "helper: Johan may book the no-login technician");
ok((await q(`SELECT count(*)::int n FROM sales_rep_technicians WHERE sales_rep_id = $1`, [ALMARI]))[0].n === 0, "seed: Almari gets no technicians");
ok((await q(`SELECT count(*)::int n FROM sales_rep_technicians WHERE sales_rep_id = $1`, [JOHAN]))[0].n === 3, "seed: Johan gets every current service-lane tech");

await as(ADMIN);
await q(`DELETE FROM sales_rep_technicians WHERE sales_rep_id = $1 AND technician_id = $2`, [JOHAN, OTHER]);
ok((await q(`SELECT public.sales_may_book_tech($1,$2) ok`, [JOHAN, OTHER]))[0].ok === false, "helper: Johan may not book a tech who was removed");

ok((await names(JOHAN)).join(",") === "Innocent,No Login Tech", "dispatchable_technicians hides the unassigned tech from sales");
ok((await names(ADMIN)).join(",") === "Innocent,No Login Tech,Other Tech", "dispatchable_technicians still lists every tech for office");
ok((await names(ALMARI)).join(",") === "", "dispatchable_technicians is empty for a salesperson with nobody assigned");

await as(JOHAN);
const ranked = await q(
  `SELECT full_name FROM _rank_core('service', CURRENT_DATE, '09:00'::time, 60, NULL, NULL, NULL, NULL) ORDER BY full_name`,
);
ok(ranked.map((r) => r.full_name).join(",") === "Innocent,No Login Tech", "_rank_core returns only assigned technicians for sales");
await as(ADMIN);
const officeRank = await q(
  `SELECT full_name FROM _rank_core('service', CURRENT_DATE, '09:00'::time, 60, NULL, NULL, NULL, NULL) ORDER BY full_name`,
);
ok(officeRank.map((r) => r.full_name).join(",") === "Innocent,No Login Tech,Other Tech", "_rank_core still returns every technician for office");

await q(
  `INSERT INTO leads (id, company_id, created_by, customer_name, primary_intent, deleted_at)
   VALUES ($1,$2,$3,'Demo client','service',NULL)`,
  [LEAD, CO, JOHAN],
);
await as(JOHAN);
const denied = await q(
  `SELECT assign_lead_to_tech($1,$2,CURRENT_DATE,'09:00'::time,'11:00'::time,NULL,NULL) r`,
  [LEAD, OTHER],
);
ok(denied[0].r.ok === false && denied[0].r.code === 403 && /not assigned to you/.test(denied[0].r.message), "assign_lead_to_tech rejects an unassigned tech");
const accepted = await q(
  `SELECT assign_lead_to_tech($1,$2,CURRENT_DATE,'09:00'::time,'11:00'::time,NULL,NULL) r`,
  [LEAD, INNOCENT],
);
ok(accepted[0].r.ok === true, "assign_lead_to_tech allows an assigned tech");

const badPref = await q(
  `SELECT request_lead_reassignment($1,$2,'Earlier please') r`,
  [LEAD, OTHER],
);
ok(badPref[0].r.ok === false && /not assigned to you/.test(badPref[0].r.message), "request_lead_reassignment rejects a preferred tech who is not assigned");
const goodPref = await q(
  `SELECT request_lead_reassignment($1,$2,'Earlier please') r`,
  [LEAD, NOLOGIN],
);
ok(goodPref[0].r.ok === true, "request_lead_reassignment allows an assigned preferred tech");

await as(JOHAN);
const options = await q(`SELECT lead_assign_options($1, CURRENT_DATE) r`, [LEAD]);
const techNames = (options[0].r.techs || []).map((t) => t.full_name).sort();
ok(techNames.join(",") === "Innocent,No Login Tech", "lead_assign_options lists only assigned technicians: " + techNames.join(","));

await q(`DELETE FROM job_schedules`);
await q(
  `INSERT INTO jobs (id, company_id, created_by, status) VALUES ($1,$2,$3,'scheduled'), ($4,$2,$5,'scheduled')`,
  [JOB, CO, JOHAN, OTHER_JOB, ADMIN],
);
await q(
  `INSERT INTO assignments (job_id, profile_id, status) VALUES ($1,$2,'accepted')`,
  [JOB, OTHER],
);
await q(
  `INSERT INTO job_schedules (job_id, agent_id, scheduled_date, start_time, end_time, notes)
   VALUES ($1,$2,CURRENT_DATE,'08:00','09:00','Own job'),
          ($3,$4,CURRENT_DATE,'10:00','11:00','Busy only'),
          ($5,$6,CURRENT_DATE,'12:00','13:00','Hidden client')`,
  [JOB, INNOCENT, OTHER_JOB, NOLOGIN, OTHER_JOB, OTHER],
);

const asRole = async (uid, sql, params) => {
  await as(uid);
  await db.exec("SET ROLE authenticated");
  try { return (await db.query(sql, params)).rows; }
  finally { await db.exec("RESET ROLE"); }
};

const seen = (await asRole(JOHAN, "SELECT full_name FROM profiles ORDER BY full_name")).map((r) => r.full_name);
ok(seen.includes("Johan Sales") && seen.includes("Innocent") && seen.includes("No Login Tech") && seen.includes("Other Tech"), "profiles: sales sees self, assigned techs, and a tech already on their job (" + seen.join(",") + ")");
ok(!seen.includes("Almari") && !seen.includes("Office Admin"), "profiles: sales does not see other staff");

const slots = await asRole(JOHAN, "SELECT agent_id::text AS agent_id FROM job_schedules ORDER BY start_time");
ok(slots.map((s) => s.agent_id).join(",") === [INNOCENT, NOLOGIN].join(","), "schedules: own job and an assigned tech's busy slot, not an unassigned tech (" + slots.map((s) => s.agent_id).join(",") + ")");
await q(`DELETE FROM sales_rep_technicians WHERE sales_rep_id = $1 AND technician_id = $2`, [JOHAN, NOLOGIN]);
const afterUnassign = await asRole(JOHAN, "SELECT agent_id::text AS agent_id FROM job_schedules ORDER BY start_time");
ok(afterUnassign.map((s) => s.agent_id).join(",") === INNOCENT, "schedules: a tech already on the rep's job stays visible after they are unassigned (" + afterUnassign.map((s) => s.agent_id).join(",") + ")");
await q(`DELETE FROM sales_rep_technicians WHERE sales_rep_id = $1 AND technician_id = $2`, [JOHAN, INNOCENT]);
await q(`UPDATE jobs SET created_by = $1 WHERE id = $2`, [ADMIN, JOB]);
const gone = await asRole(JOHAN, "SELECT count(*)::int n FROM job_schedules");
ok(gone[0].n === 0, "schedules: nothing left once those rows are neither the rep's job nor an assigned tech (" + gone[0].n + ")");

await throws(
  () => asRole(JOHAN, `INSERT INTO sales_rep_technicians (company_id, sales_rep_id, technician_id) VALUES ('${CO}','${JOHAN}','${OTHER}')`),
  /permission|policy|row-level|row level/i,
  "RLS: a salesperson cannot assign themselves a technician",
);
await asRole(
  ADMIN,
  `INSERT INTO sales_rep_technicians (company_id, sales_rep_id, technician_id) VALUES ($1,$2,$3)`,
  [CO, JOHAN, INNOCENT],
);
const adminLinks = await asRole(ADMIN, "SELECT technician_id::text AS technician_id FROM sales_rep_technicians WHERE sales_rep_id = $1", [JOHAN]);
ok(adminLinks.some((row) => row.technician_id === INNOCENT), "RLS: company admin can write and read the assignment rows");
const salesView = await asRole(JOHAN, "SELECT technician_id::text AS technician_id FROM sales_rep_technicians");
ok(salesView.some((row) => row.technician_id === INNOCENT), "RLS: the salesperson can read their own row");
const almariView = await asRole(ALMARI, "SELECT count(*)::int n FROM sales_rep_technicians");
ok(almariView[0].n === 0, "RLS: another salesperson cannot read Johan's row");

await db.exec(fs.readFileSync(rollback, "utf8"));
ok((await q(`SELECT to_regclass('public.sales_rep_technicians') t`))[0].t === null, "rollback drops sales_rep_technicians");
await as(JOHAN);
const after = await names(JOHAN);
ok(after.join(",") === "Innocent,No Login Tech,Other Tech", "rollback restores dispatchable_technicians without the sales filter");

console.log(fail ? `${fail} FAILED` : "ALL OK");
process.exit(fail ? 1 : 0);
