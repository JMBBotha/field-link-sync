import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE = "22222222-2222-4222-8222-222222222222";
const HOUSE2 = "22222222-2222-4222-8222-222222222223";
const OTHER = "22222222-2222-4222-8222-222222222224";
const LABOUR = "22222222-2222-4222-8222-222222222230";
const NEEDED = "22222222-2222-4222-8222-222222222231";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const PROJECT2 = "33333333-3333-4333-8333-333333333334";
const SV = "b00dc016-822d-411f-bf72-26a05537018f";
const CUST = "3dde87f5-60cf-5cda-bc54-edd8b0e553cc";
const OLD = "55555555-5555-4555-8555-555555555555";
const PROD = "77777777-7777-4777-8777-777777777777";
const PAY = "88888888-8888-4888-8888-888888888888";
const SEED = "supabase/migrations/20261116214000_seed_stellenbosch_invoice_house_coverage.sql";

describe("invoice house coverage seed text", () => {
  const sql = readFileSync(SEED, "utf8");
  it("only inserts links and refuses to rewrite invoices or payments", () => {
    expect(sql).not.toMatch(/\bUPDATE\s+public\.invoices\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+public\.payments\b/i);
    expect(sql).not.toMatch(/\bDELETE\s+FROM\s+public\.(invoices|payments)\b/i);
    expect(sql).toMatch(/0010021/);
    expect(sql).toMatch(/102354\.50/);
    expect(sql).toMatch(/24652\.26/);
  });
});

describe("invoice house coverage", () => {
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
      CREATE TYPE public.app_role AS ENUM ('admin', 'dispatcher', 'field_agent', 'viewer');
      CREATE FUNCTION public.has_role(uid uuid, role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.is_field_tech_only(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE FUNCTION public.tech_can_see_lead(uid uuid, lead uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${CT}'::uuid $$;
      CREATE FUNCTION public.photo_lead_ok(_lead uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE FUNCTION public.fl_is_company_admin(_uid uuid, _company uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE TABLE public.companies (id uuid PRIMARY KEY, status text NOT NULL);
      INSERT INTO public.companies VALUES ('${CT}', 'active');
      CREATE FUNCTION public.is_company_writable(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active') $$;
      CREATE TABLE public.walda_session (company_id uuid, allowed boolean);
      INSERT INTO public.walda_session VALUES ('${CT}', true);
      CREATE FUNCTION public._walda_co() RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE co uuid; BEGIN
        SELECT company_id INTO co FROM public.walda_session WHERE allowed IS TRUE;
        IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
        RETURN co; END $$;
      CREATE TABLE public.bot_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, actor_id uuid, action text,
        target_table text, target_id uuid, before jsonb, after jsonb, proposal_id uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION public._bot_audit(p_co uuid, p_action text, p_table text, p_id uuid, p_before jsonb, p_after jsonb, p_proposal uuid DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $$
        INSERT INTO public.bot_audit_log (company_id, actor_id, action, target_table, target_id, before, after, proposal_id)
        VALUES (p_co, auth.uid(), p_action, p_table, p_id, p_before, p_after, p_proposal) $$;
      CREATE TABLE public.profiles (id uuid PRIMARY KEY, company_id uuid, full_name text);
      INSERT INTO public.profiles VALUES ('${BOT}', '${CT}', 'WALDA');
      CREATE TABLE public.leads (id uuid PRIMARY KEY, company_id uuid);
      CREATE TABLE public.job_photos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lead_id uuid, storage_path text, uploaded_by uuid);
      CREATE TABLE public.customers (id uuid PRIMARY KEY, company_id uuid, name text, phone text, email text, address text);
      INSERT INTO public.customers VALUES ('${CUST}', '${CT}', 'CAPE ESTATES PAARL (Pty) Ltd', NULL, NULL, NULL);
      CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid, customer_id uuid, name text);
      INSERT INTO public.projects VALUES ('${PROJECT}', '${CT}', '${CUST}', 'AVEC'), ('${PROJECT2}', '${CT}', '${CUST}', 'Other estate');
      CREATE TABLE public.project_houses (
        id uuid PRIMARY KEY, project_id uuid, company_id uuid, house_no text, created_at timestamptz DEFAULT now()
      );
      INSERT INTO public.project_houses VALUES
        ('${HOUSE}', '${PROJECT}', '${CT}', '32', now()),
        ('${HOUSE2}', '${PROJECT2}', '${CT}', '99', now()),
        ('${OTHER}', '${PROJECT2}', '${CT}', '32', now());
      CREATE TABLE public.project_house_steps (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), house_id uuid, step_key text, done boolean
      );
      INSERT INTO public.project_house_steps (house_id, step_key, done) VALUES ('${HOUSE}', 'first_fit', false);
      CREATE TABLE public.company_members (user_id uuid, company_id uuid, role text, created_at timestamptz DEFAULT now());
      INSERT INTO public.company_members VALUES ('${BOT}', '${CT}', 'admin', now());
      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, company_id uuid, sales_engineer_id uuid,
        created_by uuid, owner_id uuid, status text, quote_number text, customer_name text,
        discount_type text, discount_value numeric, vat_rate numeric, notes text, subtotal numeric, vat_amount numeric,
        total numeric, sent_at timestamptz, archived_at timestamptz, created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.quote_areas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, name text, sort_order int
      );
      CREATE TABLE public.quote_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, area_id uuid, item_name text, item_number text,
        description text, quantity numeric, unit_price numeric, total_price numeric, product_id uuid, source text,
        sort_order int, unit_type text, supplier text, metadata jsonb
      );
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, agent_id uuid, customer_id uuid, customer_name text,
        customer_phone text, customer_email text, customer_address text, invoice_number text, subtotal numeric,
        tax_rate numeric, tax_amount numeric, grand_total numeric, issue_date date, status text, line_items jsonb,
        company_id uuid, project_house_id uuid, notes text, sent_at timestamptz, archived_at timestamptz,
        created_at timestamptz DEFAULT now()
      );
      INSERT INTO public.invoices (id, invoice_number, grand_total, status, company_id, project_house_id, customer_name, agent_id)
      VALUES ('${OLD}', 'INV-OLD', 100, 'sent', '${CT}', '${HOUSE2}', 'CAPE ESTATES PAARL (Pty) Ltd', '${BOT}');
      CREATE TABLE public.invoice_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid, description text, quantity numeric, unit_price numeric, amount numeric
      );
      CREATE TABLE public.payments (id uuid PRIMARY KEY, invoice_id uuid, amount numeric);
      INSERT INTO public.payments VALUES ('${PAY}', '${OLD}', 100);
      CREATE SEQUENCE invoice_number_seq START 1;
      CREATE SEQUENCE quote_number_seq START 1;
      CREATE FUNCTION public.generate_invoice_number() RETURNS text LANGUAGE sql AS $$
        SELECT 'INV-' || lpad(nextval('invoice_number_seq')::text, 3, '0') $$;
      CREATE FUNCTION public.generate_quote_number() RETURNS text LANGUAGE sql AS $$
        SELECT 'Q-TEST-' || lpad(nextval('quote_number_seq')::text, 4, '0') $$;
      CREATE TABLE public.live_supplier_products (
        id uuid, short_name text, name text, product_code text, model text, model_range text, brand text,
        selling_price numeric, price_excl_vat numeric, capacity_btu int, btu_rating int, archived boolean,
        is_active boolean, product_type text, category text, product_category text
      );
      INSERT INTO public.live_supplier_products VALUES (
        '${PROD}', 'Samsung AR40H 12K wall', 'Samsung AR40H wall 12K', 'AR40H-12', 'AR40H', 'AR40', 'Samsung',
        8000, 8000, 12000, 12000, false, true, 'wall', 'wall', 'wall'
      );
    `);
    await db.exec(readFileSync("supabase/migrations/20261116180000_first_fit_house_invoices.sql", "utf8"));
    await db.exec(readFileSync("supabase/migrations/20261116213000_invoice_house_coverage.sql", "utf8"));
    await db.exec(`
      INSERT INTO public.client_issue_settings (customer_id, company_id, deposit_days, balance_days, issue_snap_day, prepare_days, discount_percent)
      VALUES ('${CUST}', '${CT}', 45, 60, 15, 7, 5)
      ON CONFLICT (customer_id) DO UPDATE SET issue_snap_day = 15, discount_percent = 5, deposit_days = 45, balance_days = 60, prepare_days = 7;
      SELECT set_config('app.backfill', '1', false);
      SELECT set_config('app.today', '2026-11-16', false);
    `);
  }, 60000);

  async function call(sql: string) {
    const res = await db.query<{ j: Record<string, unknown> }>(`SELECT ${sql} AS j`);
    return res.rows[0].j;
  }

  async function openHouse(id: string, houseNo: string, insert = true) {
    if (insert) await db.exec(`INSERT INTO public.project_houses (id, project_id, company_id, house_no) VALUES ('${id}', '${PROJECT}', '${CT}', '${houseNo}')`);
    await call(`public.walda_record_first_fit_point(p_house => '${id}'::uuid, p_area => 'Lounge', p_unit_size => '12K', p_pipe_m => '6', p_storage_path => '${CT}/${PROJECT}/${id}/p.jpg', p_source_ref => 'pt-${houseNo}')`);
    await call(`public.set_first_fit_complete('${id}'::uuid)`);
    await db.exec(`UPDATE public.project_houses SET first_fit_complete_at = '2026-09-01 08:00:00+02' WHERE id = '${id}'`);
  }

  it("still drafts half the quote when the house has no coverage", async () => {
    await openHouse(HOUSE, "32", false);
    const refreshed = await call(`public.refresh_house_issue_drafts('${HOUSE}'::uuid)`);
    expect(refreshed.result).toBe("refreshed");
    const dep = await db.query<{ grand_total: string; status: string }>(`
      SELECT grand_total::text, status FROM public.invoices WHERE id = '${refreshed.deposit_id}'
    `);
    expect(dep.rows[0].status).toBe("draft");
    expect(Number(dep.rows[0].grand_total)).toBe(4370);
  });

  it("creates nothing when the house is already on a full-system invoice", async () => {
    await db.exec(`UPDATE public.project_houses SET is_live = true, first_fit_complete_at = '2026-09-01 08:00:00+02', deposit_due_on = '2026-11-15' WHERE id = '${HOUSE2}'`);
    const before = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE project_house_id = '${HOUSE2}' AND issue_stage IS NOT NULL`);
    const linked = await call(`public.walda_record_invoice_coverage(p_scope => 'full_system', p_amount => 100, p_source_ref => 'cov-full', p_invoice_number => 'INV-OLD', p_house => '${HOUSE2}'::uuid)`);
    expect(linked.result).toBe("inserted");
    const again = await call(`public.walda_record_invoice_coverage(p_scope => 'full_system', p_amount => 100, p_source_ref => 'cov-full', p_invoice_number => 'INV-OLD', p_house => '${HOUSE2}'::uuid)`);
    expect(again.result).toBe("skipped");
    expect(again.id).toBe(linked.id);
    const same = await call(`public.walda_record_invoice_coverage(p_scope => 'full_system', p_amount => 100, p_source_ref => 'cov-full-2', p_invoice_number => 'INV-OLD', p_house => '${HOUSE2}'::uuid)`);
    expect(same.result).toBe("skipped");
    await expect(call(`public.walda_record_invoice_coverage(p_scope => 'full_system', p_amount => 80, p_source_ref => 'cov-full-3', p_invoice_number => 'INV-OLD', p_house => '${HOUSE2}'::uuid)`)).rejects.toThrow(/already covered/);
    const refreshed = await call(`public.refresh_house_issue_drafts('${HOUSE2}'::uuid)`);
    expect(refreshed.result).toBe("covered");
    expect(refreshed.reason).toBe("Already invoiced on INV-OLD");
    expect(refreshed.deposit_id).toBeNull();
    const after = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE project_house_id = '${HOUSE2}' AND issue_stage IS NOT NULL`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const old = await db.query<{ grand_total: string; status: string; house: string | null }>(`
      SELECT grand_total::text, status, project_house_id::text AS house FROM public.invoices WHERE id = '${OLD}'
    `);
    expect(old.rows[0]).toEqual({ grand_total: "100", status: "sent", house: HOUSE2 });
    const dates = await db.query<{ deposit_due_on: string | null }>(`SELECT deposit_due_on::text FROM public.project_houses WHERE id = '${HOUSE2}'`);
    expect(dates.rows[0].deposit_due_on).toBeNull();
    const detail = await call(`public.house_first_fit_detail('${HOUSE2}'::uuid)`);
    expect(detail.already_invoiced_on).toBe("INV-OLD");
    const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.bot_audit_log WHERE action IN ('invoice_coverage_inserted', 'invoice_coverage_skipped')`);
    expect(Number(audit.rows[0].n)).toBeGreaterThanOrEqual(2);
  });

  it("bills only the units when labour was already invoiced, and leaves that invoice alone", async () => {
    await openHouse(LABOUR, "40");
    const quote = await db.query<{ id: string }>(`SELECT id::text FROM public.quotes WHERE project_house_id = '${LABOUR}' AND origin = 'first_fit'`);
    await db.exec(`
      UPDATE public.quote_items
      SET unit_price = 10000, total_price = 10000, quantity = 1,
          metadata = COALESCE(metadata, '{}'::jsonb) || '{"price_needed": false, "quote_category": "units"}'::jsonb
      WHERE quote_id = '${quote.rows[0].id}' AND COALESCE(metadata->>'quote_category', '') = 'units';
      UPDATE public.quote_items
      SET unit_price = 100, total_price = 5000, quantity = 50,
          metadata = COALESCE(metadata, '{}'::jsonb) || '{"price_needed": false, "quote_category": "materials"}'::jsonb
      WHERE quote_id = '${quote.rows[0].id}' AND COALESCE(metadata->>'quote_category', '') = 'materials';
      UPDATE public.quotes
      SET discount_type = 'none', discount_value = 0, subtotal = 15000, vat_amount = 2250, total = 17250, vat_rate = 0.15
      WHERE id = '${quote.rows[0].id}';
      INSERT INTO public.invoices (invoice_number, grand_total, status, company_id, customer_name, agent_id, issue_date)
      VALUES ('LAB-1', 24652.26, 'draft', '${CT}', 'CAPE ESTATES PAARL (Pty) Ltd', '${BOT}', '2026-11-13');
    `);
    await call(`public.walda_record_invoice_coverage(p_scope => 'labour_extraction', p_amount => 24652.26, p_source_ref => 'lab-1', p_invoice_number => 'LAB-1', p_house => '${LABOUR}'::uuid)`);
    const refreshed = await call(`public.refresh_house_issue_drafts('${LABOUR}'::uuid)`);
    expect(refreshed.result).toBe("refreshed");
    expect(refreshed.bill_units_only).toBe(true);
    const dep = await db.query<{ grand_total: string; notes: string }>(`
      SELECT grand_total::text, notes FROM public.invoices WHERE id = '${refreshed.deposit_id}'
    `);
    expect(Number(dep.rows[0].grand_total)).toBe(5750);
    expect(dep.rows[0].notes).toMatch(/Units only/);
    expect(dep.rows[0].notes).toMatch(/LAB-1/);
    const labour = await db.query<{ grand_total: string; house: string | null; issue_date: string }>(`
      SELECT grand_total::text, project_house_id::text AS house, issue_date::text FROM public.invoices WHERE invoice_number = 'LAB-1'
    `);
    expect(labour.rows[0]).toEqual({ grand_total: "24652.26", house: null, issue_date: "2026-11-13" });
  });

  it("does not guess a units price when labour is covered and the units line is still R0", async () => {
    await openHouse(NEEDED, "41");
    const quote = await db.query<{ id: string }>(`SELECT id::text FROM public.quotes WHERE project_house_id = '${NEEDED}' AND origin = 'first_fit'`);
    await db.exec(`
      UPDATE public.quote_items
      SET unit_price = 0, total_price = 0,
          metadata = COALESCE(metadata, '{}'::jsonb) || '{"price_needed": true, "quote_category": "units"}'::jsonb
      WHERE quote_id = '${quote.rows[0].id}' AND COALESCE(metadata->>'quote_category', '') = 'units';
      INSERT INTO public.invoices (invoice_number, grand_total, status, company_id, customer_name, agent_id)
      VALUES ('LAB-2', 100, 'draft', '${CT}', 'CAPE ESTATES PAARL (Pty) Ltd', '${BOT}');
    `);
    await call(`public.walda_record_invoice_coverage(p_scope => 'labour_extraction', p_amount => 100, p_source_ref => 'lab-2', p_invoice_number => 'LAB-2', p_house => '${NEEDED}'::uuid)`);
    const refreshed = await call(`public.refresh_house_issue_drafts('${NEEDED}'::uuid)`);
    expect(refreshed.result).toBe("units_needed");
    expect(refreshed.reason).toBe("units invoice needed");
    expect(refreshed.deposit_id).toBeNull();
    const drafts = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE project_house_id = '${NEEDED}' AND issue_stage IS NOT NULL`);
    expect(drafts.rows[0].n).toBe("0");
    const detail = await call(`public.house_first_fit_detail('${NEEDED}'::uuid)`);
    expect(detail.units_invoice_needed).toBe(true);
    expect(detail.labour_invoice).toBe("LAB-2");
  });

  it("seeds Stellenbosch links by invoice number and ERF, and leaves invoices and payments identical", async () => {
    const seed = readFileSync(SEED, "utf8");
    await expect(db.exec(seed)).rejects.toThrow(/Invoice 0010021 is missing or ambiguous/);
    await db.exec(`
      INSERT INTO public.projects (id, company_id, customer_id, name)
      VALUES ('${SV}', '${CT}', '${CUST}', 'Stellenbosch Village');
      INSERT INTO public.project_houses (id, project_id, company_id, house_no) VALUES
        ('935d2307-58b7-4971-a231-7d5b653c94dc', '${SV}', '${CT}', '17528'),
        ('29647326-9f47-4f7d-97bb-1ba9efa0b5c2', '${SV}', '${CT}', '17529'),
        ('2ac566e1-7ad9-4575-b4f6-856fca2f5362', '${SV}', '${CT}', '17533'),
        ('482f3c3d-7756-44f1-9bce-c93fe4cc8b9a', '${SV}', '${CT}', '17534'),
        ('9cf0760b-e037-4f80-be4b-2de0e4e319b6', '${SV}', '${CT}', '17535'),
        ('ea38ad4a-af17-46b4-a1ff-de8919473b6a', '${SV}', '${CT}', '17536');
      INSERT INTO public.invoices (id, invoice_number, grand_total, status, company_id, customer_name, agent_id, issue_date, project_house_id)
      VALUES
        ('e3c5c460-5fdd-49ed-8e34-e288f5455ab8', '0010021', 204709.00, 'draft', '${CT}', 'CAPE ESTATES PAARL (Pty) Ltd', '${BOT}', '2026-11-13', NULL),
        ('cd2781bc-4e03-4005-ad10-e25fa7ee99f4', '0010023', 98609.05, 'draft', '${CT}', 'CAPE ESTATES PAARL (Pty) Ltd', '${BOT}', '2026-11-13', NULL);
      INSERT INTO public.payments (id, invoice_id, amount)
      VALUES ('99999999-9999-4999-8999-999999999999', 'e3c5c460-5fdd-49ed-8e34-e288f5455ab8', 0);
    `);
    const before = await db.query<{ inv: string; pay: string; n: string }>(`
      SELECT
        md5(coalesce(string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.id::text), '')) AS inv,
        (SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id::text), '')) FROM public.payments p) AS pay,
        (SELECT count(*)::text FROM public.payments) AS n
      FROM public.invoices i
    `);
    await db.exec(seed);
    await db.exec(seed);
    const after = await db.query<{ inv: string; pay: string; n: string }>(`
      SELECT
        md5(coalesce(string_agg(md5(to_jsonb(i)::text), '' ORDER BY i.id::text), '')) AS inv,
        (SELECT md5(coalesce(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id::text), '')) FROM public.payments p) AS pay,
        (SELECT count(*)::text FROM public.payments) AS n
      FROM public.invoices i
    `);
    expect(after.rows[0]).toEqual(before.rows[0]);
    const links = await db.query<{ invoice_number: string; house_no: string; scope: string; amount: string }>(`
      SELECT i.invoice_number, h.house_no, c.scope::text, c.amount_incl::text AS amount
      FROM public.invoice_house_coverage c
      JOIN public.invoices i ON i.id = c.invoice_id
      JOIN public.project_houses h ON h.id = c.project_house_id
      WHERE c.source_ref LIKE 'go-live:%'
      ORDER BY i.invoice_number, h.house_no
    `);
    expect(links.rows).toEqual([
      { invoice_number: "0010021", house_no: "17528", scope: "full_system", amount: "102354.50" },
      { invoice_number: "0010021", house_no: "17529", scope: "full_system", amount: "102354.50" },
      { invoice_number: "0010023", house_no: "17533", scope: "labour_extraction", amount: "24652.26" },
      { invoice_number: "0010023", house_no: "17534", scope: "labour_extraction", amount: "24652.26" },
      { invoice_number: "0010023", house_no: "17535", scope: "labour_extraction", amount: "24652.26" },
      { invoice_number: "0010023", house_no: "17536", scope: "labour_extraction", amount: "24652.26" },
    ]);
    const drafts = await db.query<{ invoice_number: string; grand_total: string; issue_date: string; house: string | null }>(`
      SELECT invoice_number, grand_total::text, issue_date::text, project_house_id::text AS house
      FROM public.invoices WHERE invoice_number IN ('0010021', '0010023') ORDER BY invoice_number
    `);
    expect(drafts.rows).toEqual([
      { invoice_number: "0010021", grand_total: "204709.00", issue_date: "2026-11-13", house: null },
      { invoice_number: "0010023", grand_total: "98609.05", issue_date: "2026-11-13", house: null },
    ]);
    const covers = await call(`public.invoice_covers('e3c5c460-5fdd-49ed-8e34-e288f5455ab8'::uuid)`);
    const houses = covers.houses as { house_no: string }[];
    expect(houses.map((h) => h.house_no)).toEqual(["17528", "17529"]);
    await db.exec(`INSERT INTO public.project_houses (id, project_id, company_id, house_no) VALUES ('22222222-2222-4222-8222-222222222299', '${PROJECT2}', '${CT}', '17528')`);
    await expect(db.exec(seed)).rejects.toThrow(/ERF 17528 is missing or ambiguous/);
  });
});
