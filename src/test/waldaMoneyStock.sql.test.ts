import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "11111111-1111-4111-8111-111111111111";
const HOUSE = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const CUST = "44444444-4444-4444-8444-444444444444";
const INV = "55555555-5555-4555-8555-555555555555";
const LINE = "66666666-6666-4666-8666-666666666666";
const PROD = "77777777-7777-4777-8777-777777777777";

describe("walda expected money and stock intake", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      INSERT INTO auth.me VALUES ('${BOT}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE TABLE public.companies (id uuid PRIMARY KEY, status text NOT NULL);
      INSERT INTO public.companies VALUES ('${CT}', 'active');
      CREATE TABLE public.walda_session (company_id uuid, allowed boolean);
      INSERT INTO public.walda_session VALUES ('${CT}', true);
      CREATE FUNCTION public._walda_co() RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE co uuid; BEGIN
        SELECT company_id INTO co FROM public.walda_session WHERE allowed IS TRUE;
        IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
        RETURN co; END $$;
      CREATE FUNCTION public.is_company_writable(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active') $$;
      CREATE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${CT}'::uuid $$;
      CREATE FUNCTION public._cf_ok(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT cid = '${CT}'::uuid $$;
      CREATE FUNCTION public._stock_reject_bot() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN IF coalesce(current_setting('test.bot', true), '') = '1' THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF; END $$;
      CREATE TABLE public.bot_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, actor_id uuid, action text,
        target_table text, target_id uuid, before jsonb, after jsonb, proposal_id uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION public._bot_audit(p_co uuid, p_action text, p_table text, p_id uuid, p_before jsonb, p_after jsonb, p_proposal uuid DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $$
        INSERT INTO public.bot_audit_log (company_id, actor_id, action, target_table, target_id, before, after, proposal_id)
        VALUES (p_co, auth.uid(), p_action, p_table, p_id, p_before, p_after, p_proposal) $$;
      CREATE TABLE public.customers (id uuid PRIMARY KEY, company_id uuid, name text);
      INSERT INTO public.customers VALUES ('${CUST}', '${CT}', 'Harbour');
      CREATE TABLE public.invoices (id uuid PRIMARY KEY, company_id uuid, invoice_number text, grand_total numeric);
      INSERT INTO public.invoices VALUES ('${INV}', '${CT}', 'INV-9', 8000);
      CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid, customer_id uuid, name text);
      INSERT INTO public.projects VALUES ('${PROJECT}', '${CT}', '${CUST}', 'AVEC');
      CREATE TABLE public.project_houses (id uuid PRIMARY KEY, project_id uuid, company_id uuid, house_no text);
      INSERT INTO public.project_houses VALUES ('${HOUSE}', '${PROJECT}', '${CT}', '12');
      CREATE TABLE public.jobs (id uuid PRIMARY KEY, company_id uuid, customer_id uuid, job_type text, title text, description text, created_at timestamptz DEFAULT now());
      INSERT INTO public.jobs VALUES ('${JOB}', '${CT}', '${CUST}', 'installation', 'Installation — AVEC House 12', NULL, now());
      CREATE TABLE public.bank_lines (id uuid PRIMARY KEY, company_id uuid, reference text, amount numeric, status text);
      INSERT INTO public.bank_lines VALUES ('${LINE}', '${CT}', 'FNB-88', -25000, 'matched');
      CREATE TABLE public.cf_stock_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, item text NOT NULL,
        qty_on_hand numeric NOT NULL DEFAULT 0, unit_cost_excl numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.supplier_products (id uuid PRIMARY KEY, product_code text, product_type text);
      INSERT INTO public.supplier_products VALUES ('${PROD}', 'FCMI-24', 'ac_unit');
      CREATE TABLE public.supplier_job_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, supplier_name text,
        doc_type text NOT NULL, doc_number text, doc_date date, storage_path text, notes text,
        source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','assistant')), source_ref text, created_by uuid, created_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX sjd_source_ref_uq ON public.supplier_job_documents (company_id, source_ref) WHERE source_ref IS NOT NULL;
      CREATE TABLE public.supplier_job_document_lines (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL, company_id uuid, line_no int,
        description text, model_number text, qty numeric, job_id uuid, unit_cost_excl numeric, receive_bucket text,
        delivered_with_doc boolean NOT NULL DEFAULT false, received_at timestamptz
      );
      CREATE TABLE public.stock_movements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        kind text NOT NULL CHECK (kind IN ('receive','allocate','use','adjust','return')),
        bucket text NOT NULL CHECK (bucket IN ('material_pool','job_unit','general_unit')),
        stock_item_id uuid, product_id uuid, item_label text NOT NULL, qty numeric NOT NULL,
        unit_cost_excl numeric, value_adjust numeric NOT NULL DEFAULT 0, vat_amount numeric, job_id uuid,
        supplier_document_id uuid, supplier_document_line_id uuid, serial_no text, unit_id uuid, reason text,
        allowance_id uuid, count_line_id uuid, transfer_id uuid, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.stock_units (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL, stock_item_id uuid NOT NULL,
        product_id uuid, supplier_code text, origin text NOT NULL, received_job_id uuid, unit_cost_excl numeric NOT NULL,
        supplier_document_id uuid, supplier_document_line_id uuid, returned_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
        CHECK ((origin = 'job_received' AND received_job_id IS NOT NULL) OR (origin = 'general_stock' AND received_job_id IS NULL))
      );
      CREATE TABLE public.job_activity_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL, user_id uuid, action text NOT NULL, details jsonb, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.cf_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid NOT NULL,
        source text NOT NULL DEFAULT 'manual' CHECK (source IN ('field_lynk','manual','freshbooks')),
        invoice_id uuid, ref text NOT NULL DEFAULT '', client text,
        part text NOT NULL DEFAULT 'full' CHECK (part IN ('deposit','progress','final','full')),
        amount_incl numeric NOT NULL DEFAULT 0, vat_incl numeric NOT NULL DEFAULT 0,
        expected_date date, leeway_days integer NOT NULL DEFAULT 7, confidence integer NOT NULL DEFAULT 60,
        status text NOT NULL DEFAULT 'expected' CHECK (status IN ('expected','received','written_off')),
        note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.payments (id uuid PRIMARY KEY, invoice_id uuid, amount numeric);
      INSERT INTO public.payments VALUES ('88888888-8888-4888-8888-888888888888', '${INV}', 100);
      CREATE FUNCTION public.material_avg_cost(p_item uuid, p_as_of timestamptz DEFAULT now()) RETURNS numeric LANGUAGE sql AS $$
        SELECT 10::numeric $$;
      CREATE FUNCTION public._stock_move(
        p_company uuid, p_kind text, p_bucket text, p_item uuid, p_product uuid, p_label text,
        p_qty numeric, p_cost numeric, p_vat numeric, p_job uuid, p_doc uuid, p_line uuid,
        p_serial text, p_unit uuid, p_reason text, p_allowance uuid, p_count_line uuid, p_transfer uuid, p_value numeric
      ) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE v uuid := gen_random_uuid();
      BEGIN
        INSERT INTO public.stock_movements (id, company_id, kind, bucket, stock_item_id, product_id, item_label, qty, unit_cost_excl, value_adjust, job_id, supplier_document_id, supplier_document_line_id, unit_id, reason, transfer_id)
        VALUES (v, p_company, p_kind, p_bucket, p_item, p_product, left(coalesce(p_label,'Item'),160), p_qty, p_cost, coalesce(p_value,0), p_job, p_doc, p_line, p_unit, p_reason, p_transfer);
        RETURN v;
      END $$;
    `);
    await db.exec(readFileSync("supabase/migrations/20261116143000_walda_money_and_stock.sql", "utf8"));
  }, 30000);

  it("records expected money once, skips a retry, and does not touch the invoice or the payment", async () => {
    const first = await call(`public.walda_record_expected_money(p_amount => 8000, p_expected_on => DATE '2026-11-20', p_kind => 'deposit', p_client => 'Harbour', p_invoice => '${INV}'::uuid, p_source_ref => 'exp-1')`);
    expect(first.result).toBe("inserted");
    const again = await call(`public.walda_record_expected_money(p_amount => 8000, p_expected_on => DATE '2026-11-20', p_kind => 'deposit', p_client => 'Harbour', p_invoice => '${INV}'::uuid, p_source_ref => 'exp-1')`);
    expect(again.result).toBe("skipped");
    expect(again.id).toBe(first.id);
    const fixed = await call(`public.walda_record_expected_money(p_amount => 7500, p_expected_on => DATE '2026-11-21', p_kind => 'deposit', p_client => 'Harbour', p_invoice => '${INV}'::uuid, p_source_ref => 'exp-1')`);
    expect(fixed.result).toBe("updated");
    expect(fixed.id).toBe(first.id);
    const pays = await db.query<{ n: string; total: string }>(`SELECT count(*)::text AS n, coalesce(sum(amount),0)::text AS total FROM public.payments`);
    expect(pays.rows[0]).toEqual({ n: "1", total: "100" });
    const inv = await db.query<{ grand_total: string }>(`SELECT grand_total::text FROM public.invoices WHERE id = '${INV}'`);
    expect(inv.rows[0].grand_total).toBe("8000");
    const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.cf_receipts WHERE source_ref = 'exp-1'`);
    expect(rows.rows[0].n).toBe("1");
  });

  it("books a materials purchase into the pool only, then skips and updates", async () => {
    const first = await call(`public.walda_record_material_purchase(p_item => 'Copper pipe', p_qty => 100, p_unit => 'm', p_total_cost => 25600, p_doc_date => DATE '2026-11-03', p_supplier => 'One Stop', p_doc_ref => 'CU-1', p_invoice_ref => 'CU-1', p_paid => false, p_source_ref => 'cu-1', p_attachment => 'purchase-slips/${CT}/cu-1.jpg', p_already_used => 0)`);
    expect(first.result).toBe("inserted");
    expect(first.bucket).toBe("material_pool");
    const buckets = await db.query<{ bucket: string; qty: string }>(`SELECT bucket, sum(qty)::text AS qty FROM public.stock_movements WHERE intake_id = '${first.id}' GROUP BY bucket`);
    expect(buckets.rows).toHaveLength(1);
    expect(buckets.rows[0].bucket).toBe("material_pool");
    expect(Number(buckets.rows[0].qty)).toBe(100);
    const again = await call(`public.walda_record_material_purchase(p_item => 'Copper pipe', p_qty => 100, p_unit => 'm', p_total_cost => 25600, p_doc_date => DATE '2026-11-03', p_supplier => 'One Stop', p_doc_ref => 'CU-1', p_invoice_ref => 'CU-1', p_paid => false, p_source_ref => 'cu-1', p_attachment => 'purchase-slips/${CT}/cu-1.jpg', p_already_used => 0)`);
    expect(again.result).toBe("skipped");
    const paid = await call(`public.walda_link_purchase_payment(p_source_ref => 'cu-1', p_bank_line => '${LINE}'::uuid, p_bank_line_ref => 'FNB-88')`);
    expect(paid.result).toBe("updated");
    const paidAgain = await call(`public.walda_link_purchase_payment(p_source_ref => 'cu-1', p_bank_line => '${LINE}'::uuid)`);
    expect(paidAgain.result).toBe("skipped");
    const retry = await call(`public.walda_record_material_purchase(p_item => 'Copper pipe', p_qty => 100, p_unit => 'm', p_total_cost => 25600, p_doc_date => DATE '2026-11-03', p_supplier => 'One Stop', p_doc_ref => 'CU-1', p_invoice_ref => 'CU-1', p_paid => false, p_source_ref => 'cu-1', p_attachment => 'purchase-slips/${CT}/cu-1.jpg', p_already_used => 0)`);
    expect(retry.result).toBe("skipped");
  });

  it("books a matched unit onto a job and an unmatched model as text for review", async () => {
    const matched = await call(`public.walda_record_unit_purchase(p_supplier => 'Samsung', p_doc_ref => 'U-1', p_doc_date => DATE '2026-11-04', p_model => 'FCMI-24', p_qty => 1, p_unit_cost => 9000, p_job => '${JOB}'::uuid, p_paid => false, p_source_ref => 'u-1', p_attachment => 'purchase-slips/${CT}/u-1.jpg')`);
    expect(matched.result).toBe("inserted");
    expect(matched.bucket).toBe("job_unit");
    expect(matched.review).toBe(false);
    expect(matched.product_id).toBe(PROD);
    const plain = await call(`public.walda_record_unit_purchase(p_supplier => 'Samsung', p_doc_ref => 'U-2', p_doc_date => DATE '2026-11-04', p_model => 'UNKNOWN-99', p_qty => 2, p_unit_cost => 1000, p_source_ref => 'u-2')`);
    expect(plain.result).toBe("inserted");
    expect(plain.bucket).toBe("general_unit");
    expect(plain.review).toBe(true);
    const units = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.stock_units WHERE origin = 'general_stock' AND product_id IS NULL`);
    expect(Number(units.rows[0].n)).toBe(2);
    const alloc = await call(`public.walda_allocate_unit(p_source_ref => 'alloc-1', p_purchase_ref => 'u-2', p_project_house => '${HOUSE}'::uuid, p_qty => 1)`);
    expect(alloc.result).toBe("inserted");
    expect(alloc.job_id).toBe(JOB);
    const allocAgain = await call(`public.walda_allocate_unit(p_source_ref => 'alloc-1', p_purchase_ref => 'u-2', p_project_house => '${HOUSE}'::uuid, p_qty => 1)`);
    expect(allocAgain.result).toBe("skipped");
  });

  it("books a credit note as its own row and leaves the original purchase unchanged", async () => {
    const before = await db.query<{ payload: unknown }>(`SELECT payload FROM public.stock_intakes WHERE source_ref = 'cu-1'`);
    const back = await call(`public.walda_record_purchase_return(p_supplier => 'One Stop', p_credit_ref => 'CN-1', p_doc_date => DATE '2026-11-10', p_lines => '[{"kind":"material","item":"Copper pipe","qty":10,"amount":2560}]'::jsonb, p_purchase_ref => 'cu-1', p_source_ref => 'cn-1')`);
    expect(back.result).toBe("inserted");
    expect(back.linked_id).toBeTruthy();
    const after = await db.query<{ payload: unknown }>(`SELECT payload FROM public.stock_intakes WHERE source_ref = 'cu-1'`);
    expect(after.rows[0].payload).toEqual(before.rows[0].payload);
    const qty = await db.query<{ qty: string }>(`SELECT sum(qty)::text AS qty FROM public.stock_movements WHERE bucket = 'material_pool' AND item_label = 'Copper pipe'`);
    expect(Number(qty.rows[0].qty)).toBe(90);
    const again = await call(`public.walda_record_purchase_return(p_supplier => 'One Stop', p_credit_ref => 'CN-1', p_doc_date => DATE '2026-11-10', p_lines => '[{"kind":"material","item":"Copper pipe","qty":10,"amount":2560}]'::jsonb, p_purchase_ref => 'cu-1', p_source_ref => 'cn-1')`);
    expect(again.result).toBe("skipped");
  });

  it("notes a direct delivery on the job and posts no stock and no cost", async () => {
    const before = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.stock_movements`);
    const note = await call(`public.walda_record_direct_delivery(p_supplier => 'RKP', p_order_ref => '21217', p_client => 'Harbour', p_job => '${JOB}'::uuid, p_units => '[{"model":"24k","qty":1}]'::jsonb, p_doc_date => DATE '2026-11-05', p_note => 'Client paid the supplier', p_source_ref => 'dd-1', p_attachment => 'purchase-slips/${CT}/rkp.jpg')`);
    expect(note.result).toBe("inserted");
    expect(note.stock).toBe(false);
    expect(Number(note.cost)).toBe(0);
    const after = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.stock_movements`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const log = await db.query<{ action: string; details: { summary?: string } }>(`SELECT action, details FROM public.job_activity_log WHERE job_id = '${JOB}'`);
    expect(log.rows[0].action).toBe("direct_delivery");
    expect(log.rows[0].details.summary).toMatch(/Not taken into stock/);
    const units = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.stock_units WHERE supplier_code ILIKE '%24k%'`);
    expect(units.rows[0].n).toBe("0");
  });

  it("lets an admin save an average and refuses the bot", async () => {
    const saved = await call(`public.save_material_average(NULL, 'Copper pipe', 'install', 12, 'm')`);
    expect(saved.id).toBeTruthy();
    const read = await call(`public.walda_read_material_averages()`);
    expect(JSON.stringify(read.averages)).toMatch(/Copper pipe/);
    await db.exec(`SELECT set_config('test.bot', '1', false)`);
    await expect(call(`public.save_material_average(NULL, 'Cabling', 'metre', 1, 'm')`)).rejects.toThrow(/not allowed/);
    await db.exec(`SELECT set_config('test.bot', '', false)`);
  });

  async function call(sql: string) {
    const res = await db.query<{ j: Record<string, unknown> }>(`SELECT ${sql} AS j`);
    return res.rows[0].j;
  }
});
