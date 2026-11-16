import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE = "22222222-2222-4222-8222-222222222222";
const HOUSE2 = "22222222-2222-4222-8222-222222222223";
const OTHER = "22222222-2222-4222-8222-222222222224";
const PROJECT = "33333333-3333-4333-8333-333333333333";
const PROJECT2 = "33333333-3333-4333-8333-333333333334";
const CUST = "3dde87f5-60cf-5cda-bc54-edd8b0e553cc";
const OLD = "55555555-5555-4555-8555-555555555555";
const PROD = "77777777-7777-4777-8777-777777777777";
const PAY = "88888888-8888-4888-8888-888888888888";

describe("first fit complete, house photos, and staged invoices", () => {
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
    await db.exec(`
      INSERT INTO public.client_issue_settings (customer_id, company_id, deposit_days, balance_days, issue_snap_day, prepare_days, discount_percent)
      VALUES ('${CUST}', '${CT}', 45, 60, 15, 7, 5)
      ON CONFLICT (customer_id) DO UPDATE SET issue_snap_day = 15, discount_percent = 5, deposit_days = 45, balance_days = 60, prepare_days = 7;
      SELECT set_config('app.backfill', '1', false);
      SELECT set_config('app.today', '2026-11-16', false);
    `);
  }, 30000);

  async function call(sql: string) {
    const res = await db.query<{ j: Record<string, unknown> }>(`SELECT ${sql} AS j`);
    return res.rows[0].j;
  }

  const path = `${CT}/${PROJECT}/${HOUSE}/p1.jpg`;

  it("files a point once, skips the same reference, and updates when the metres change", async () => {
    const first = await call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'Lounge', p_unit_size => '12k', p_pipe_m => '6,5m', p_storage_path => '${path}', p_source_ref => 'pt-1')`);
    expect(first.result).toBe("inserted");
    expect(first.unit_size).toBe("12K");
    expect(Number(first.pipe_m)).toBe(6.5);
    const again = await call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'Lounge', p_unit_size => '12K', p_pipe_m => '6.5', p_storage_path => '${path}', p_source_ref => 'pt-1')`);
    expect(again.result).toBe("skipped");
    expect(again.id).toBe(first.id);
    const fixed = await call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'Lounge', p_unit_size => '12K', p_pipe_m => '7', p_storage_path => '${path}', p_source_ref => 'pt-1')`);
    expect(fixed.result).toBe("updated");
    expect(fixed.id).toBe(first.id);
    const n = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.first_fit_points WHERE source_ref = 'pt-1'`);
    expect(n.rows[0].n).toBe("1");
  });

  it("bounces a missing area, a size that is not 9/12/18/24, a long pipe, and an ambiguous house number", async () => {
    await expect(call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => '  ', p_unit_size => '12K', p_pipe_m => '4', p_storage_path => '${path}', p_source_ref => 'bad-area')`)).rejects.toThrow(/Area is required/);
    await expect(call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'Lounge', p_unit_size => '10kW', p_pipe_m => '4', p_storage_path => '${path}', p_source_ref => 'bad-size')`)).rejects.toThrow(/9K, 12K, 18K or 24K/);
    await expect(call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'Lounge', p_unit_size => '12K', p_pipe_m => '250', p_storage_path => '${path}', p_source_ref => 'bad-pipe')`)).rejects.toThrow(/at most 200/);
    await expect(call(`public.walda_record_first_fit_point(p_house_no => '32', p_area => 'Lounge', p_unit_size => '12K', p_pipe_m => '4', p_storage_path => '${path}', p_source_ref => 'bad-house')`)).rejects.toThrow(/More than one house/);
    const via = await call(`public.walda_record_first_fit_point(p_house_no => 'AVEC 32', p_area => 'Bed 2', p_unit_size => '9', p_pipe_m => '4', p_storage_path => '${CT}/${PROJECT}/${HOUSE}/p2.jpg', p_source_ref => 'pt-2')`);
    expect(via.house_id).toBe(HOUSE);
    expect(via.result).toBe("inserted");
  });

  it("refuses First fit complete until every listed area has a point, then opens one live draft quote", async () => {
    await call(`public.save_house_unit_list('${HOUSE}'::uuid, '[{"area":"Lounge","unit_size":"12K"},{"area":"Kitchen","unit_size":"18K"}]'::jsonb)`);
    await expect(call(`public.set_first_fit_complete('${HOUSE}'::uuid)`)).rejects.toThrow(/Kitchen still needs a point/);
    await call(`public.walda_record_first_fit_point(p_house => '${HOUSE}'::uuid, p_area => 'kitchen', p_unit_size => '18K', p_pipe_m => '3', p_storage_path => '${CT}/${PROJECT}/${HOUSE}/p3.jpg', p_source_ref => 'pt-3')`);
    const done = await call(`public.set_first_fit_complete('${HOUSE}'::uuid)`);
    expect(done.result).toBe("complete");
    expect(done.is_live).toBe(true);
    const quote = done.quote as { id: string; result: string };
    expect(quote.result).toBe("inserted");
    const row = await db.query<{ discount_type: string; discount_value: string; total: string; status: string; sent_at: string | null; n: string }>(`
      SELECT q.discount_type, q.discount_value::text, q.total::text, q.status, q.sent_at::text, count(q2.id)::text AS n
      FROM public.quotes q
      LEFT JOIN public.quotes q2 ON q2.project_house_id = q.project_house_id AND q2.origin = 'first_fit'
      WHERE q.id = '${quote.id}'
      GROUP BY q.discount_type, q.discount_value, q.total, q.status, q.sent_at
    `);
    expect(row.rows[0].discount_type).toBe("percent");
    expect(Number(row.rows[0].discount_value)).toBe(5);
    expect(row.rows[0].status).toBe("draft");
    expect(row.rows[0].sent_at).toBeNull();
    expect(row.rows[0].n).toBe("1");
    const lines = await db.query<{ item_name: string; unit_price: string; quantity: string }>(`
      SELECT item_name, unit_price::text, quantity::text FROM public.quote_items WHERE quote_id = '${quote.id}' ORDER BY sort_order
    `);
    const pipe = lines.rows.filter((l) => l.item_name.includes("price needed"));
    expect(pipe.length).toBeGreaterThan(0);
    expect(pipe.every((l) => Number(l.unit_price) === 0)).toBe(true);
    const unit = lines.rows.find((l) => l.item_name.includes("12K") && !l.item_name.includes("Piping"));
    expect(Number(unit?.unit_price)).toBe(8000);
    // 12K 8000 + 9K unmatched 0 + 18K unmatched 0 = 8000. 5% once, then VAT.
    expect(Number(row.rows[0].total)).toBe(8740);
    const again = await call(`public.set_first_fit_complete('${HOUSE}'::uuid)`);
    expect(again.result).toBe("skipped");
    const still = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.quotes WHERE origin = 'first_fit' AND project_house_id = '${HOUSE}'`);
    expect(still.rows[0].n).toBe("1");
    const step = await db.query<{ done: boolean }>(`SELECT done FROM public.project_house_steps WHERE house_id = '${HOUSE}' AND step_key = 'first_fit'`);
    expect(step.rows[0].done).toBe(false);
  });

  it("prepares a numbered deposit draft inside the 7 day window and keeps the balance as an estimate", async () => {
    await db.exec(`UPDATE public.project_houses SET first_fit_complete_at = '2026-09-01 08:00:00+02' WHERE id = '${HOUSE}'`);
    const refreshed = await call(`public.refresh_house_issue_drafts('${HOUSE}'::uuid)`);
    expect(refreshed.deposit_due_on).toBe("2026-11-15");
    expect(refreshed.balance_estimated).toBe(true);
    expect(refreshed.balance_due_on).toBe("2027-01-15");
    expect(refreshed.deposit_id).toBeTruthy();
    expect(refreshed.balance_id).toBeNull();
    const dep = await db.query<{ invoice_number: string; status: string; sent_at: string | null; grand_total: string }>(`
      SELECT invoice_number, status, sent_at::text, grand_total::text FROM public.invoices WHERE id = '${refreshed.deposit_id}'
    `);
    expect(dep.rows[0].status).toBe("draft");
    expect(dep.rows[0].sent_at).toBeNull();
    expect(dep.rows[0].invoice_number).toMatch(/^INV-/);
    expect(Number(dep.rows[0].grand_total)).toBe(4370);
    const digest = await call(`public.walda_first_fit_issue_digest(DATE '2026-11-16')`);
    const rows = digest.rows as { kind: string; state: string; estimated?: boolean }[];
    expect(rows.some((r) => r.kind === "deposit" && r.state === "overdue")).toBe(true);
    expect(rows.some((r) => r.kind === "balance")).toBe(false);
  });

  it("issues the balance only after the deposit is issued, and the two drafts add up to the quote", async () => {
    const dep = await db.query<{ id: string; grand_total: string }>(`SELECT id::text, grand_total::text FROM public.invoices WHERE project_house_id = '${HOUSE}' AND issue_stage = 'deposit'`);
    await db.exec(`UPDATE public.invoices SET status = 'sent', sent_at = '2026-09-01 10:00:00+02' WHERE id = '${dep.rows[0].id}'`);
    const refreshed = await call(`public.refresh_house_issue_drafts('${HOUSE}'::uuid)`);
    expect(refreshed.balance_estimated).toBe(false);
    expect(refreshed.balance_id).toBeTruthy();
    const sums = await db.query<{ deposit: string; balance: string }>(`
      SELECT
        max(grand_total) FILTER (WHERE issue_stage = 'deposit')::text AS deposit,
        max(grand_total) FILTER (WHERE issue_stage = 'balance')::text AS balance
      FROM public.invoices
      WHERE project_house_id = '${HOUSE}' AND issue_stage IS NOT NULL AND coalesce(status, '') <> 'void'
    `);
    expect(Number(sums.rows[0].deposit) + Number(sums.rows[0].balance)).toBe(8740);
    expect(Number(sums.rows[0].deposit)).toBe(Number(dep.rows[0].grand_total));
    const old = await db.query<{ invoice_number: string; grand_total: string; status: string }>(`SELECT invoice_number, grand_total::text, status FROM public.invoices WHERE id = '${OLD}'`);
    expect(old.rows[0]).toEqual({ invoice_number: "INV-OLD", grand_total: "100", status: "sent" });
    const pays = await db.query<{ n: string; total: string }>(`SELECT count(*)::text AS n, coalesce(sum(amount),0)::text AS total FROM public.payments`);
    expect(pays.rows[0]).toEqual({ n: "1", total: "100" });
  });

  it("undoes Live, clears the dates, flags drafts, and does not delete them", async () => {
    const before = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE project_house_id = '${HOUSE}' AND issue_stage IS NOT NULL`);
    const undone = await call(`public.undo_first_fit_complete('${HOUSE}'::uuid)`);
    expect(undone.result).toBe("undone");
    expect(undone.is_live).toBe(false);
    const house = await db.query<{ is_live: boolean; deposit_due_on: string | null; balance_due_on: string | null }>(`
      SELECT is_live, deposit_due_on::text, balance_due_on::text FROM public.project_houses WHERE id = '${HOUSE}'
    `);
    expect(house.rows[0].is_live).toBe(false);
    expect(house.rows[0].deposit_due_on).toBeNull();
    expect(house.rows[0].balance_due_on).toBeNull();
    const after = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.invoices WHERE project_house_id = '${HOUSE}' AND issue_stage IS NOT NULL`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const flagged = await db.query<{ n: string }>(`
      SELECT count(*)::text AS n FROM public.invoices
      WHERE project_house_id = '${HOUSE}' AND status = 'draft' AND review_flag LIKE 'First fit complete was undone%'
    `);
    expect(Number(flagged.rows[0].n)).toBeGreaterThan(0);
    const quote = await db.query<{ n: string; flag: string }>(`
      SELECT count(*)::text AS n, max(review_flag) AS flag FROM public.quotes WHERE project_house_id = '${HOUSE}' AND origin = 'first_fit'
    `);
    expect(quote.rows[0].n).toBe("1");
    expect(quote.rows[0].flag).toMatch(/undone/);
    const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.bot_audit_log WHERE action = 'first_fit_undone'`);
    expect(audit.rows[0].n).toBe("1");
    const sent = await db.query<{ status: string; grand_total: string }>(`
      SELECT status, grand_total::text FROM public.invoices WHERE project_house_id = '${HOUSE}' AND issue_stage = 'deposit'
    `);
    expect(sent.rows[0].status).toBe("sent");
    expect(Number(sent.rows[0].grand_total)).toBe(4370);
  });
});
