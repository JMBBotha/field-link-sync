import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");

async function dbWith(sql: string) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
  `);
  await db.exec(sql);
  return db;
}

describe("weekday hours", () => {
  it("counts 24 hours from Friday afternoon to Monday afternoon and skips the weekend", async () => {
    const db = await dbWith(read("20261111215000_accepted_unbooked_reminder.sql").split("CREATE OR REPLACE FUNCTION public.sales_next_steps")[0]);
    const fri = await db.query<{ h: string }>(
      `SELECT public.fl_weekday_hours('2026-11-06 15:00:00+02', '2026-11-09 15:00:00+02') AS h`,
    );
    expect(Number(fri.rows[0].h)).toBeCloseTo(24, 5);
    const midweek = await db.query<{ h: string }>(
      `SELECT public.fl_weekday_hours('2026-11-09 10:00:00+02', '2026-11-10 09:00:00+02') AS h`,
    );
    expect(Number(midweek.rows[0].h)).toBeCloseTo(23, 5);
  });
});

describe("invoice due now in SQL", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY,
        status text,
        grand_total numeric,
        deposit_amount numeric,
        deposit_type text,
        expected_deposit_date date,
        expected_final_date date,
        due_date date,
        due_date_manual boolean DEFAULT false
      );
      CREATE TABLE public.payments (invoice_id uuid, amount numeric, status text);
      CREATE TABLE public.credit_notes (invoice_id uuid, total numeric, status text);
      CREATE TABLE public.job_done_stub (invoice_id uuid, done date);
      CREATE FUNCTION public._inv_job_done(p_invoice uuid) RETURNS date LANGUAGE sql STABLE AS $$
        SELECT done FROM public.job_done_stub WHERE invoice_id = p_invoice LIMIT 1 $$;
    `);
    const fn = read("20261111211000_invoice_due_now.sql").split("CREATE OR REPLACE FUNCTION public.notify_document_sent")[0];
    await db.exec(fn);
    await db.exec(`
      INSERT INTO public.invoices (id, status, grand_total, deposit_amount, deposit_type)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'sent', 28638.43, 20046.90, 'percent');
    `);
  });
  it("returns the deposit while the balance has no date", async () => {
    const row = await db.query<{ n: string }>(`SELECT public.invoice_due_now('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS n`);
    expect(Number(row.rows[0].n)).toBeCloseTo(20046.9, 2);
  });
  it("returns the balance after the deposit is paid and the job is done", async () => {
    await db.exec(`
      INSERT INTO public.payments (invoice_id, amount, status)
      VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 20046.90, 'paid');
      INSERT INTO public.job_done_stub VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-11-09');
    `);
    const row = await db.query<{ n: string }>(`SELECT public.invoice_due_now('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') AS n`);
    expect(Number(row.rows[0].n)).toBeCloseTo(8591.53, 2);
  });
});

describe("record_invoice_payment", () => {
  let db: PGlite;
  const invoice = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const company = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const user = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      INSERT INTO auth.me VALUES ('${user}');
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION public.get_user_company_id(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT '${company}'::uuid $$;
      CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY,
        company_id uuid,
        grand_total numeric,
        status text,
        paid_date date,
        updated_at timestamptz,
        deposit_amount numeric
      );
      CREATE TABLE public.payments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        invoice_id uuid,
        amount numeric,
        method text,
        reference text,
        payment_date timestamptz,
        gateway text,
        status text,
        company_id uuid,
        created_by uuid,
        dedupe_key text
      );
      CREATE TABLE public.credit_notes (invoice_id uuid, total numeric, status text);
      CREATE FUNCTION public.invoice_amount_paid(p_invoice_id uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
        SELECT coalesce(sum(amount), 0) FROM public.payments
         WHERE invoice_id = p_invoice_id AND status IN ('paid', 'succeeded', 'completed') $$;
      CREATE FUNCTION public.recalc_invoice_status() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_paid numeric; v_total numeric;
      BEGIN
        SELECT grand_total INTO v_total FROM public.invoices WHERE id = NEW.invoice_id;
        SELECT coalesce(sum(amount), 0) INTO v_paid FROM public.payments
         WHERE invoice_id = NEW.invoice_id AND status IN ('paid', 'succeeded', 'completed');
        UPDATE public.invoices
           SET status = CASE WHEN v_paid + 0.005 >= v_total AND v_total > 0 THEN 'paid'
                             WHEN v_paid > 0 THEN 'partially_paid' ELSE status END
         WHERE id = NEW.invoice_id;
        RETURN NEW;
      END $$;
      CREATE TRIGGER pay_recalc AFTER INSERT ON public.payments
        FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_status();
      INSERT INTO public.invoices (id, company_id, grand_total, status, deposit_amount)
      VALUES ('${invoice}', '${company}', 28638.43, 'sent', 20046.90);
    `);
    await db.exec(read("20261111210000_record_invoice_payment_guard.sql"));
  });
  it("a deposit leaves the invoice partially paid", async () => {
    await db.query(`SELECT public.record_invoice_payment($1, 20046.90, 'eft', 'POP-1', '2026-11-01', false, 'key-1')`, [invoice]);
    const row = await db.query<{ status: string }>(`SELECT status FROM public.invoices WHERE id = $1`, [invoice]);
    expect(row.rows[0].status).toBe("partially_paid");
  });
  it("the same idempotency key does not insert a second payment", async () => {
    await db.query(`SELECT public.record_invoice_payment($1, 20046.90, 'eft', 'POP-1', '2026-11-01', false, 'key-1')`, [invoice]);
    const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.payments WHERE invoice_id = $1`, [invoice]);
    expect(n.rows[0].n).toBe("1");
  });
  it("a second reference is rejected", async () => {
    await expect(db.query(
      `SELECT public.record_invoice_payment($1, 100, 'eft', 'POP-1', '2026-11-02', false, 'key-2')`,
      [invoice],
    )).rejects.toThrow(/already on this invoice/);
  });
  it("an amount above the outstanding balance is rejected until allow-overpay", async () => {
    await expect(db.query(
      `SELECT public.record_invoice_payment($1, 9000, 'eft', 'POP-2', '2026-11-02', false, 'key-3')`,
      [invoice],
    )).rejects.toThrow(/still outstanding/);
    await db.query(`SELECT public.record_invoice_payment($1, 8591.53, 'eft', 'POP-3', '2026-11-02', false, 'key-4')`, [invoice]);
    const row = await db.query<{ status: string }>(`SELECT status FROM public.invoices WHERE id = $1`, [invoice]);
    expect(row.rows[0].status).toBe("paid");
  });
});

describe("installation link remap", () => {
  it("points unit_item_id at the unit's new id when the payload still has the old one", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TABLE public.quotes (id uuid PRIMARY KEY, subtotal numeric, vat_rate numeric, vat_amount numeric, total numeric);
      CREATE TABLE public.quote_areas (id uuid PRIMARY KEY, quote_id uuid, name text, sort_order int);
      CREATE TABLE public.quote_items (
        id uuid PRIMARY KEY, quote_id uuid, area_id uuid, parent_item_id uuid, product_id uuid,
        item_name text, item_number text, description text, quantity numeric, length numeric,
        unit_price numeric, total_price numeric, is_bundle boolean, item_type text, metadata jsonb,
        sort_order int, notes text, source text, supplier text
      );
    `);
    await db.exec(read("20261111213000_install_link_remap.sql"));
    const quote = "11111111-1111-1111-1111-111111111111";
    const oldArea = "22222222-2222-2222-2222-222222222222";
    const oldUnit = "33333333-3333-3333-3333-333333333333";
    const oldLine = "44444444-4444-4444-4444-444444444444";
    const newArea = "55555555-5555-5555-5555-555555555555";
    const newUnit = "66666666-6666-6666-6666-666666666666";
    const newLine = "77777777-7777-7777-7777-777777777777";
    await db.exec(`
      INSERT INTO public.quotes (id, total) VALUES ('${quote}', 100);
      INSERT INTO public.quote_areas (id, quote_id, name, sort_order) VALUES ('${oldArea}', '${quote}', 'Lounge', 0);
      INSERT INTO public.quote_items (id, quote_id, area_id, item_name, item_type, metadata)
      VALUES
        ('${oldUnit}', '${quote}', '${oldArea}', 'Unit', 'unit', '{}'),
        ('${oldLine}', '${quote}', '${oldArea}', 'Trunking', 'material',
         '{"install":{"unit_item_id":"${oldUnit}","role":"trunking_main"}}');
    `);
    const areas = JSON.stringify([{ id: newArea, old_id: oldArea, name: "Lounge", sort_order: 0 }]);
    const items = JSON.stringify([
      { id: newUnit, old_id: oldUnit, quote_id: quote, area_id: newArea, item_name: "Unit", item_type: "unit", metadata: {}, sort_order: 0 },
      { id: newLine, old_id: oldLine, quote_id: quote, area_id: newArea, item_name: "Trunking", item_type: "material",
        metadata: { install: { unit_item_id: oldUnit, role: "trunking_main" }, unit_cost: 5 }, sort_order: 1 },
    ]);
    await db.query(`SELECT public.replace_quote_from_builder($1, $2::jsonb, $3::jsonb, 0, 0.15, 0, 100)`, [quote, areas, items]);
    const link = await db.query<{ id: string; unit: string; cost: string }>(
      `SELECT id::text, metadata #>> '{install,unit_item_id}' AS unit, metadata->>'unit_cost' AS cost
         FROM public.quote_items WHERE item_name = 'Trunking'`,
    );
    expect(link.rows[0].id).toBe(newLine);
    expect(link.rows[0].unit).toBe(newUnit);
    expect(link.rows[0].cost).toBe("5");
    const gone = await db.query(`SELECT id FROM public.quote_items WHERE id = '${oldUnit}'`);
    expect(gone.rows).toHaveLength(0);
  });
});

describe("no second invoice for a quote billed in full", () => {
  it("returns the existing full invoice and does not insert another", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY, status text, total numeric, vat_amount numeric, vat_rate numeric,
        quote_number text, customer_id uuid, customer_name text, sales_engineer_id uuid,
        created_by uuid, lead_id uuid, company_id uuid
      );
      CREATE TABLE public.customers (id uuid PRIMARY KEY, name text, phone text, email text, address text);
      CREATE TABLE public.jobs (id uuid PRIMARY KEY, quote_id uuid, status text, lead_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid, lead_id uuid, agent_id uuid, customer_id uuid,
        customer_name text, customer_phone text, customer_email text, customer_address text,
        invoice_number text, subtotal numeric, tax_rate numeric, tax_amount numeric, grand_total numeric,
        due_date date, status text, line_items jsonb, company_id uuid, notes text, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.invoice_items (invoice_id uuid, description text, quantity numeric, unit_price numeric, amount numeric);
      CREATE FUNCTION public.generate_invoice_number() RETURNS text LANGUAGE sql AS $$ SELECT 'INV-TEST' $$;
    `);
    await db.exec(read("20261111214000_no_second_full_invoice.sql"));
    const quote = "88888888-8888-8888-8888-888888888888";
    const invoice = "99999999-9999-9999-9999-999999999999";
    await db.exec(`
      INSERT INTO public.quotes (id, status, total, quote_number) VALUES ('${quote}', 'accepted', 1000, 'Q-1');
      INSERT INTO public.invoices (id, quote_id, grand_total, status, notes, invoice_number)
      VALUES ('${invoice}', '${quote}', 1000, 'partially_paid', 'Quote Q-1: total R 1000.00 incl VAT. 70% deposit due now.', 'INV-041');
    `);
    const got = await db.query<{ id: string }>(`SELECT public._create_balance_invoice('${quote}') AS id`);
    expect(got.rows[0].id).toBe(invoice);
    const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE quote_id = '${quote}'`);
    expect(n.rows[0].n).toBe("1");
    const notes = await db.query<{ notes: string }>(`SELECT notes FROM public.invoices WHERE id = '${invoice}'`);
    expect(notes.rows[0].notes).toMatch(/^Quote Q-1/);
  });
  it("a legacy partial deposit invoice can still raise only the remainder", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY, status text, total numeric, vat_amount numeric, vat_rate numeric,
        quote_number text, customer_id uuid, customer_name text, sales_engineer_id uuid,
        created_by uuid, lead_id uuid, company_id uuid
      );
      CREATE TABLE public.customers (id uuid PRIMARY KEY, name text, phone text, email text, address text);
      CREATE TABLE public.jobs (id uuid PRIMARY KEY, quote_id uuid, status text, lead_id uuid, created_at timestamptz DEFAULT now());
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quote_id uuid, lead_id uuid, agent_id uuid, customer_id uuid,
        customer_name text, customer_phone text, customer_email text, customer_address text,
        invoice_number text, subtotal numeric, tax_rate numeric, tax_amount numeric, grand_total numeric,
        due_date date, status text, line_items jsonb, company_id uuid, notes text, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.invoice_items (invoice_id uuid, description text, quantity numeric, unit_price numeric, amount numeric);
      CREATE FUNCTION public.generate_invoice_number() RETURNS text LANGUAGE sql AS $$ SELECT 'INV-BAL' $$;
    `);
    await db.exec(read("20261111214000_no_second_full_invoice.sql"));
    const quote = "12121212-1212-1212-1212-121212121212";
    const agent = "13131313-1313-1313-1313-131313131313";
    await db.exec(`
      INSERT INTO public.quotes (id, status, total, vat_amount, vat_rate, quote_number, sales_engineer_id)
      VALUES ('${quote}', 'accepted', 1000, 130.43, 15, 'Q-OLD', '${agent}');
      INSERT INTO public.invoices (quote_id, grand_total, status, notes, invoice_number)
      VALUES ('${quote}', 700, 'paid', 'DEPOSIT — 70% of quote Q-OLD', 'INV-DEP');
      INSERT INTO public.jobs (id, quote_id, status) VALUES (gen_random_uuid(), '${quote}', 'completed');
    `);
    const got = await db.query<{ id: string }>(`SELECT public._create_balance_invoice('${quote}') AS id`);
    expect(got.rows[0].id).toBeTruthy();
    const rows = await db.query<{ grand_total: string; notes: string }>(
      `SELECT grand_total::text, notes FROM public.invoices WHERE quote_id = '${quote}' ORDER BY created_at`,
    );
    expect(rows.rows).toHaveLength(2);
    expect(Number(rows.rows[1].grand_total)).toBeCloseTo(300, 2);
    expect(rows.rows[1].notes).toMatch(/Remaining balance/);
    expect(rows.rows[0].notes).toMatch(/^DEPOSIT/);
  });
});
