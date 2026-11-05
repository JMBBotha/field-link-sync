// Database regression for enforce_company_writable after the company-create crash.
// PGlite only. No network, no production database, no email or HTTP.
// node supabase/tests/dormant_company/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = path.join(here, "../../migrations");
const brokenSql = fs.readFileSync(path.join(mig, "20261105120000_archived_company_dormant.sql"), "utf8");
const fixedSql = fs.readFileSync(path.join(mig, "20261105220000_dormant_trigger_record_access.sql"), "utf8");
const db = new PGlite();
let failed = 0;
const fail = (m) => { console.error("FAIL", m); failed += 1; };
const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];
const grab = (name) => {
  const start = brokenSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) throw new Error("missing " + name);
  const end = brokenSql.indexOf("\n$$;", start);
  if (end < 0) throw new Error("unterminated " + name);
  return brokenSql.slice(start, end + 4);
};

await db.exec(`
CREATE SCHEMA auth;
CREATE FUNCTION public.invoice_amount_credited(p_invoice uuid) RETURNS numeric
  LANGUAGE sql IMMUTABLE AS $$ SELECT 0::numeric $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;

CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  dormant_payments_locked boolean NOT NULL DEFAULT false
);
CREATE TABLE public.company_assistant_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  bot_name text
);
-- company_id is not the first column, same class of row shape as real child tables.
CREATE TABLE public.customers (
  name text NOT NULL,
  note text,
  company_id uuid NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  grand_total numeric NOT NULL
);
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount numeric NOT NULL,
  status text NOT NULL DEFAULT 'paid',
  company_id uuid,
  invoice_id uuid
);
CREATE TABLE public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  lead_id uuid
);
CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid,
  description text
);

CREATE FUNCTION public._cac_new_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.company_assistant_config (company_id) VALUES (NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cac_new_company AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public._cac_new_company();
`);

for (const name of [
  "is_company_writable",
  "caller_is_service_role",
  "invoice_outstanding_amount",
  "archived_invoice_payment_ok",
  "payment_write_ok",
  "enforce_company_writable",
  "enforce_parent_company_writable",
]) await db.exec(grab(name));

const attach = async (table) => {
  await db.exec(`DROP TRIGGER IF EXISTS zz_dormant_company_write ON public.${table}`);
  await db.exec(`CREATE TRIGGER zz_dormant_company_write BEFORE INSERT OR UPDATE OR DELETE ON public.${table} FOR EACH ROW EXECUTE FUNCTION public.enforce_company_writable()`);
};
await attach("company_assistant_config");
await attach("customers");
await attach("payments");
await attach("offers");
await db.exec(`DROP TRIGGER IF EXISTS zz_dormant_parent_write ON public.invoice_items`);
await db.exec(`CREATE TRIGGER zz_dormant_parent_write BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.enforce_parent_company_writable('invoice_id', 'invoices', 'raise')`);

const ACTIVE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ARCH = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const INV = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const PAY = "cccccccc-cccc-cccc-cccc-ccccccccccc1";

const raises = async (sql, needle) => {
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    const msg = String(e.message || e);
    if (needle && !msg.includes(needle)) return msg.split("\n")[0];
    return msg;
  }
};

const expectFail = async (label, sql, needle) => {
  const msg = await raises(sql, needle);
  if (msg === null) fail(label + " was allowed");
  else if (needle && !msg.includes(needle)) fail(label + " failed with " + msg);
};

const expectOk = async (label, sql) => {
  const msg = await raises(sql);
  if (msg !== null) fail(label + " failed: " + msg.split("\n")[0]);
};

// Merged function: company insert dies inside _cac_new_company, and the row is rolled back.
await expectFail(
  "broken company create",
  `INSERT INTO public.companies (id, name, status) VALUES ('${ACTIVE}', 'Active Co', 'active')`,
  "invoice_id",
);
const none = await one(`SELECT count(*)::int n FROM public.companies`);
if (none.n !== 0) fail("failed company create must roll back, got " + none.n);

// Same session, same triggers: replace the function only.
await db.exec(fixedSql);

await expectOk("company create", `INSERT INTO public.companies (id, name, status) VALUES ('${ACTIVE}', 'Active Co', 'active')`);
const cfg = await one(`SELECT count(*)::int n FROM public.company_assistant_config WHERE company_id = '${ACTIVE}'`);
if (cfg.n !== 1) fail("new company should get one assistant config row, got " + cfg.n);

await expectOk("second company", `INSERT INTO public.companies (id, name) VALUES ('${ARCH}', 'History Co')`);
await db.exec(`UPDATE public.companies SET status = 'archived' WHERE id = '${ARCH}'`);

// Active company: insert, update, delete.
await expectOk("active customer insert", `INSERT INTO public.customers (name, note, company_id) VALUES ('Pat', 'a', '${ACTIVE}')`);
await expectOk("active customer update", `UPDATE public.customers SET note = 'b' WHERE company_id = '${ACTIVE}'`);
const updated = await one(`SELECT note FROM public.customers WHERE company_id = '${ACTIVE}'`);
if (updated.note !== "b") fail("active customer update did not stick");
await expectOk("active customer delete", `DELETE FROM public.customers WHERE company_id = '${ACTIVE}'`);
if ((await one(`SELECT count(*)::int n FROM public.customers WHERE company_id = '${ACTIVE}'`)).n !== 0) fail("active delete left a row");
await expectOk("active customer reinsert", `INSERT INTO public.customers (name, company_id) VALUES ('Pat', '${ACTIVE}')`);

// Archived company data writes. Seed the row only while the import flag is on.
await db.exec(`SELECT set_config('app.archived_import', 'on', false)`);
await expectOk("import seed", `INSERT INTO public.customers (name, note, company_id) VALUES ('Old', 'keep', '${ARCH}')`);
await db.exec(`SELECT set_config('app.archived_import', '', false)`);
await expectFail("archived insert", `INSERT INTO public.customers (name, company_id) VALUES ('No', '${ARCH}')`, "not active");
await expectFail("archived update", `UPDATE public.customers SET note = 'changed' WHERE company_id = '${ARCH}'`, "not active");
await expectFail("archived delete", `DELETE FROM public.customers WHERE company_id = '${ARCH}'`, "not active");
const kept = await one(`SELECT note FROM public.customers WHERE company_id = '${ARCH}'`);
if (kept.note !== "keep") fail("archived customer must stay unchanged, got " + kept.note);

// Assistant config for an archived company is a normal data write, not a side-effect skip.
await expectFail(
  "archived assistant config",
  `INSERT INTO public.company_assistant_config (company_id, bot_name) VALUES ('${ARCH}', 'x')`,
  "not active",
);

// Offers are skipped, not rejected, so a background insert does not abort the caller.
await expectOk("archived offer", `INSERT INTO public.offers (company_id) VALUES ('${ARCH}')`);
if ((await one(`SELECT count(*)::int n FROM public.offers WHERE company_id = '${ARCH}'`)).n !== 0) fail("archived offer must be skipped");
await expectOk("active offer", `INSERT INTO public.offers (company_id) VALUES ('${ACTIVE}')`);
if ((await one(`SELECT count(*)::int n FROM public.offers WHERE company_id = '${ACTIVE}'`)).n !== 1) fail("active offer must be stored");

// Parent trigger (invoice lines) has no company_id of its own and must not touch OLD on insert.
await expectOk("active invoice", `INSERT INTO public.invoices (id, company_id, status, grand_total) VALUES ('${INV}', '${ACTIVE}', 'sent', 100)`);
await expectOk("active line", `INSERT INTO public.invoice_items (invoice_id, description) VALUES ('${INV}', 'work')`);
await expectOk("active line update", `UPDATE public.invoice_items SET description = 'work 2' WHERE invoice_id = '${INV}'`);
await db.exec(`SELECT set_config('app.archived_import', 'on', false)`);
const ARCH_INV = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
await expectOk("seed archived invoice", `INSERT INTO public.invoices (id, company_id, status, grand_total) VALUES ('${ARCH_INV}', '${ARCH}', 'sent', 100)`);
await db.exec(`SELECT set_config('app.archived_import', '', false)`);
await expectFail("archived line", `INSERT INTO public.invoice_items (invoice_id, description) VALUES ('${ARCH_INV}', 'no')`, "not active");

// Payments. Outstanding is the invoice total minus settled payments, checked before this row.
await expectOk("active payment", `INSERT INTO public.payments (id, amount, status, company_id, invoice_id) VALUES ('${PAY}', 40, 'paid', '${ACTIVE}', '${INV}')`);
await expectOk("active payment update", `UPDATE public.payments SET amount = 30 WHERE id = '${PAY}'`);
await expectOk("active payment delete", `DELETE FROM public.payments WHERE id = '${PAY}'`);

await expectOk(
  "archived open payment",
  `INSERT INTO public.payments (id, amount, status, company_id, invoice_id) VALUES ('${PAY}', 40, 'paid', '${ARCH}', '${ARCH_INV}')`,
);
const out1 = await one(`SELECT public.invoice_outstanding_amount('${ARCH_INV}'::uuid) AS n`);
if (Number(out1.n) !== 60) fail("outstanding after R40 should be 60, got " + out1.n);
await expectOk("archived payment update while open", `UPDATE public.payments SET amount = 25 WHERE id = '${PAY}'`);
await expectFail("archived payment delete", `DELETE FROM public.payments WHERE id = '${PAY}'`, "DELETE on payments");
await expectOk("archived clearing payment", `INSERT INTO public.payments (amount, status, company_id, invoice_id) VALUES (75, 'paid', '${ARCH}', '${ARCH_INV}')`);
const out0 = await one(`SELECT public.invoice_outstanding_amount('${ARCH_INV}'::uuid) AS n`);
if (Number(out0.n) !== 0) fail("invoice should be cleared, outstanding " + out0.n);
await expectFail("archived payment when settled", `INSERT INTO public.payments (amount, status, company_id, invoice_id) VALUES (1, 'paid', '${ARCH}', '${ARCH_INV}')`, "history only");

// Blank company_id still follows the invoice. Re-open the balance under the import flag first.
await db.exec(`
  SELECT set_config('app.archived_import', 'on', false);
  DELETE FROM public.payments WHERE invoice_id = '${ARCH_INV}' AND id <> '${PAY}';
  UPDATE public.payments SET amount = 40 WHERE id = '${PAY}';
  SELECT set_config('app.archived_import', '', false);
`);
await expectOk(
  "null company_id follows invoice",
  `INSERT INTO public.payments (amount, status, invoice_id) VALUES (10, 'paid', '${ARCH_INV}')`,
);
await expectFail(
  "null company_id delete",
  `DELETE FROM public.payments WHERE company_id IS NULL AND invoice_id = '${ARCH_INV}'`,
  "DELETE on payments",
);

await db.exec(`UPDATE public.companies SET dormant_payments_locked = true WHERE id = '${ARCH}'`);
await expectFail(
  "locked archived payment",
  `INSERT INTO public.payments (amount, status, company_id, invoice_id) VALUES (1, 'paid', '${ARCH}', '${ARCH_INV}')`,
  "history only",
);

// Service role may still write archived data (history import). It must not be required for the open-invoice exception above.
await db.exec(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
await expectOk("service role archived insert", `INSERT INTO public.customers (name, company_id) VALUES ('Import', '${ARCH}')`);
await db.exec(`SELECT set_config('request.jwt.claim.role', 'authenticated', false)`);

const src = await one(`SELECT prosrc FROM pg_proc WHERE proname = 'enforce_company_writable'`);
if (/OLD\.invoice_id|NEW\.invoice_id|OLD\.company_id|NEW\.company_id/.test(src.prosrc)) {
  fail("fixed function still reads a record field by name:\n" + src.prosrc);
}

if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("dormant trigger record-access regression passed");
