import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CUST = "44444444-4444-4444-8444-444444444444";
const VILLAGE = "b00dc016-822d-411f-bf72-26a05537018f";
const AVEC = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const COTTAGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("expected payment dates", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      INSERT INTO auth.me VALUES ('${BOT}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
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
        SELECT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active') $$;
      CREATE TABLE public.admin_session (uid uuid, company_id uuid, ok boolean);
      INSERT INTO public.admin_session VALUES ('${ADMIN}', '${CT}', true), ('${CLIENT}', '${CT}', false), ('${BOT}', '${CT}', false);
      CREATE FUNCTION public.can_update_company(u uuid, c uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS (SELECT 1 FROM public.admin_session s WHERE s.uid = u AND s.company_id = c AND s.ok) $$;
      CREATE FUNCTION public.is_accounts_bot(uid uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT coalesce(uid, (SELECT auth.uid())) = '${BOT}'::uuid $$;
      CREATE FUNCTION public.is_sales_rep(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE FUNCTION public.is_field_tech_only(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE TABLE public.bot_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, actor_id uuid, action text,
        target_table text, target_id uuid, before jsonb, after jsonb, proposal_id uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION public._bot_audit(p_co uuid, p_action text, p_table text, p_id uuid, p_before jsonb, p_after jsonb, p_proposal uuid DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $$
        INSERT INTO public.bot_audit_log (company_id, actor_id, action, target_table, target_id, before, after, proposal_id)
        VALUES (p_co, auth.uid(), p_action, p_table, p_id, p_before, p_after, p_proposal) $$;
      CREATE TABLE public.customers (id uuid PRIMARY KEY, company_id uuid, name text, email text);
      INSERT INTO public.customers VALUES ('${CUST}', '${CT}', 'Cape Estates', 'client@example.com');
      CREATE TABLE public.projects (id uuid PRIMARY KEY, company_id uuid NOT NULL, customer_id uuid, name text, code text);
      INSERT INTO public.projects VALUES
        ('${VILLAGE}', '${CT}', '${CUST}', 'Stellenbosch Village', 'SV'),
        ('${AVEC}', '${CT}', '${CUST}', 'AVEC', 'AVEC'),
        ('${COTTAGE}', '${CT}', '${CUST}', 'Cottage', NULL);
      CREATE TABLE public.project_houses (id uuid PRIMARY KEY, project_id uuid NOT NULL, company_id uuid NOT NULL, house_no text NOT NULL);
      INSERT INTO public.project_houses VALUES
        ('11111111-1111-4111-8111-111111111111', '${VILLAGE}', '${CT}', '4'),
        ('11111111-1111-4111-8111-111111111112', '${VILLAGE}', '${CT}', '5'),
        ('22222222-2222-4222-8222-222222222221', '${AVEC}', '${CT}', '12'),
        ('22222222-2222-4222-8222-222222222222', '${AVEC}', '${CT}', '13'),
        ('33333333-3333-4333-8333-333333333333', '${COTTAGE}', '${CT}', '1');
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY, company_id uuid, invoice_number text, status text, notes text,
        issue_date date, sent_at timestamptz, created_at timestamptz, archived_at timestamptz,
        grand_total numeric, quote_id uuid, lead_id uuid, customer_id uuid, customer_name text, project_house_id uuid
      );
      CREATE TABLE public.payments (id uuid PRIMARY KEY, invoice_id uuid, amount numeric, status text, gateway text);
      CREATE TABLE public.jobs (
        id uuid PRIMARY KEY, company_id uuid, invoice_id uuid, quote_id uuid, lead_id uuid,
        customer_id uuid, title text, description text, completed_at timestamptz, status text
      );
      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY, company_id uuid, status text, archived_at timestamptz, accepted_at timestamptz,
        total numeric, customer_id uuid, customer_name text, quote_number text, payment_plan jsonb
      );
      CREATE TABLE public.cf_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), company_id uuid, source text, invoice_id uuid, quote_id uuid,
        part text, amount_incl numeric, expected_date date, status text, client text, ref text, note text
      );
      CREATE TABLE public.company_settings (company_id uuid, default_deposit_percentage numeric, updated_at timestamptz);
      INSERT INTO public.company_settings VALUES ('${CT}', 50, now());
    `);
    await db.exec(readFileSync("supabase/migrations/20261116190000_expected_pay_dates.sql", "utf8"));
    await db.exec(`
      INSERT INTO public.invoices VALUES
        ('10000000-0000-4000-8000-000000000001', '${CT}', 'SV-D', 'sent', 'DEPOSIT', DATE '2026-11-15', NULL, now(), NULL, 15000, NULL, NULL, '${CUST}', 'Stellenbosch Village', '11111111-1111-4111-8111-111111111111'),
        ('10000000-0000-4000-8000-000000000002', '${CT}', 'SV-F', 'sent', 'Final', DATE '2026-11-15', NULL, now(), NULL, 15000, NULL, NULL, '${CUST}', 'Stellenbosch Village', '11111111-1111-4111-8111-111111111112'),
        ('10000000-0000-4000-8000-000000000003', '${CT}', 'AV-D', 'sent', 'DEPOSIT', DATE '2026-11-16', NULL, now(), NULL, 20000, NULL, NULL, '${CUST}', 'AVEC', '22222222-2222-4222-8222-222222222221'),
        ('10000000-0000-4000-8000-000000000004', '${CT}', 'N-D', 'sent', 'DEPOSIT', DATE '2026-11-16', NULL, now(), NULL, 3000, '40000000-0000-4000-8000-000000000010', NULL, '${CUST}', 'Harbour', NULL),
        ('10000000-0000-4000-8000-000000000005', '${CT}', 'N-DONE', 'sent', 'Final', DATE '2026-11-01', NULL, now(), NULL, 7000, '40000000-0000-4000-8000-000000000011', NULL, '${CUST}', 'Harbour', NULL),
        ('10000000-0000-4000-8000-000000000006', '${CT}', 'N-OPEN', 'sent', 'Final', DATE '2026-11-16', NULL, now(), NULL, 2000, '40000000-0000-4000-8000-000000000012', NULL, '${CUST}', 'Harbour', NULL),
        ('10000000-0000-4000-8000-000000000007', '${CT}', 'N-LATE', 'sent', 'DEPOSIT', DATE '2026-11-01', NULL, now(), NULL, 1800, NULL, NULL, '${CUST}', 'Harbour', NULL),
        ('10000000-0000-4000-8000-000000000008', '${CT}', 'C-D', 'sent', 'DEPOSIT', DATE '2026-11-16', NULL, now(), NULL, 2500, NULL, NULL, '${CUST}', 'Cottage', '33333333-3333-4333-8333-333333333333'),
        ('10000000-0000-4000-8000-000000000009', '${CT}', 'PAID', 'paid', 'DEPOSIT', DATE '2026-11-01', NULL, now(), NULL, 900, NULL, NULL, '${CUST}', 'Paid', NULL),
        ('10000000-0000-4000-8000-00000000000a', '${CT}', 'VOID', 'void', 'Final', DATE '2026-11-01', NULL, now(), NULL, 900, NULL, NULL, '${CUST}', 'Void', NULL),
        ('10000000-0000-4000-8000-00000000000b', '${CT}', 'ARCH', 'sent', 'Final', DATE '2026-11-01', NULL, now(), '2026-11-02', 900, NULL, NULL, '${CUST}', 'Archived', NULL);
      INSERT INTO public.payments VALUES ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 5000, 'paid', NULL);
      INSERT INTO public.jobs VALUES
        ('60000000-0000-4000-8000-000000000001', '${CT}', NULL, '40000000-0000-4000-8000-000000000011', NULL, '${CUST}', 'Install', NULL, '2026-11-09 15:00+02', 'completed'),
        ('60000000-0000-4000-8000-000000000002', '${CT}', NULL, '40000000-0000-4000-8000-000000000099', NULL, '${CUST}', 'Installation — AVEC House 12', NULL, NULL, 'scheduled');
      INSERT INTO public.quotes VALUES
        ('40000000-0000-4000-8000-000000000020', '${CT}', 'accepted', NULL, '2026-11-13 10:00+02', 20000, '${CUST}', 'Harbour', 'Q-9', '{"name":"50/50","stages":[{"pct":50},{"pct":50}]}'),
        ('40000000-0000-4000-8000-000000000099', '${CT}', 'accepted', NULL, '2026-11-13 10:00+02', 10000, '${CUST}', 'AVEC', 'Q-H', NULL);
      INSERT INTO public.pay_expect_project (project_id, timing, date_mode, day_of_month, month_offset)
      VALUES ('${VILLAGE}', 'project', 'day_of_month', 15, 1), ('${AVEC}', 'project', 'month_end', NULL, 0);
    `);
  }, 30000);

  it("names a house the same way the tracker does, and clamps a short month", async () => {
    const house = await db.query<{ ok: boolean }>(`SELECT public._pay_expect_names_house('Installation — Avec Cape Estates House 32', '32') AS ok`);
    expect(house.rows[0].ok).toBe(true);
    const miss = await db.query<{ ok: boolean }>(`SELECT public._pay_expect_names_house('House 132', '32') AS ok`);
    expect(miss.rows[0].ok).toBe(false);
    const day = await db.query<{ d: string }>(`SELECT public._pay_expect_on(DATE '2026-01-31', 'day_of_month', 0, 31, 1)::text AS d`);
    expect(day.rows[0].d).toBe("2026-02-28");
  });

  it("reads project, normal, partial, late and acceptance lines without changing invoices or payments", async () => {
    const before = await hashes();
    const data = await read("2026-11-16");
    const after = await hashes();
    expect(after).toEqual(before);
    const byRef = new Map(data.lines.map((line) => [line.ref, line]));
    expect(byRef.get("SV-D")).toMatchObject({ expected_on: "2026-12-15", amount: 15000, rule: "project", date_mode: "day_of_month", late: false });
    expect(byRef.get("SV-F")).toMatchObject({ expected_on: "2026-12-15", part: "final" });
    expect(byRef.get("AV-D")).toMatchObject({ expected_on: "2026-11-30", amount: 15000, date_mode: "month_end" });
    expect(byRef.get("N-D")).toMatchObject({ expected_on: "2026-11-19", rule: "normal" });
    expect(byRef.get("N-DONE")).toMatchObject({ expected_on: "2026-11-16", estimate: false });
    expect(byRef.get("N-OPEN")).toMatchObject({ expected_on: "2026-11-23", estimate: true });
    expect(String(byRef.get("N-OPEN")?.label)).toMatch(/estimate/);
    expect(byRef.get("N-LATE")).toMatchObject({ late: true, expected_on: "2026-11-04" });
    expect(String(byRef.get("N-LATE")?.label)).toMatch(/^Late/);
    expect(byRef.get("C-D")).toMatchObject({ expected_on: "2026-11-19", rule: "normal" });
    expect(byRef.get("PAID")).toBeUndefined();
    expect(byRef.get("VOID")).toBeUndefined();
    expect(byRef.get("ARCH")).toBeUndefined();
    const acceptance = data.lines.find((line) => line.source === "acceptance");
    expect(acceptance).toMatchObject({ amount: 10000, expected_on: "2026-11-16", ref: "Q-9" });
    expect(data.lines.some((line) => line.ref === "Q-H")).toBe(false);
    const audit = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.bot_audit_log WHERE action = 'expected_money_read'`);
    expect(Number(audit.rows[0].n)).toBeGreaterThan(0);
  });

  it("lets a WALDA row and an invoice date win, and refuses a client email", async () => {
    const before = await hashes();
    await db.exec(`INSERT INTO public.cf_receipts (company_id, source, invoice_id, part, amount_incl, expected_date, status, client) VALUES ('${CT}', 'walda', '10000000-0000-4000-8000-000000000001', 'deposit', 10, DATE '2026-12-01', 'expected', 'Village')`);
    await db.exec(`INSERT INTO public.pay_expect_invoice (invoice_id, part, expected_on) VALUES ('10000000-0000-4000-8000-000000000008', 'deposit', DATE '2026-12-25')`);
    const data = await read("2026-11-16");
    expect(data.lines.some((line) => line.ref === "SV-D")).toBe(false);
    expect(data.lines.some((line) => line.source === "walda" && line.invoice_id === "10000000-0000-4000-8000-000000000001")).toBe(true);
    const cottage = data.lines.find((line) => line.ref === "C-D");
    expect(cottage).toMatchObject({ expected_on: "2026-12-25", source: "override" });
    expect(await hashes()).toEqual(before);

    await db.exec(`UPDATE auth.me SET uid = '${CLIENT}'`);
    await expect(db.exec(`SELECT public.save_pay_expect_defaults('${CT}', 15, 15, 5, 3, 7, 3)`)).rejects.toThrow(/not allowed/);
    await db.exec(`UPDATE auth.me SET uid = '${ADMIN}'`);
    await db.exec(`SELECT public.save_pay_expect_defaults('${CT}', 16, 15, 5, 3, 7, 4)`);
    const saved = await db.query<{ d: number; g: number }>(`SELECT project_deposit_days AS d, late_grace_days AS g FROM public.pay_expect_defaults`);
    expect(saved.rows[0]).toEqual({ d: 16, g: 4 });
    expect(await hashes()).toEqual(before);
    await db.exec(`UPDATE auth.me SET uid = '${BOT}'`);
    await expect(db.exec(`SELECT public.save_pay_expect_defaults('${CT}', 15, 15, 5, 3, 7, 3)`)).rejects.toThrow(/not allowed/);
  });

  async function hashes() {
    const inv = await db.query<{ h: string }>(`SELECT md5(coalesce(string_agg(id::text || '|' || grand_total::text || '|' || coalesce(status,'') || '|' || coalesce(notes,''), ',' ORDER BY id), '')) AS h FROM public.invoices`);
    const pay = await db.query<{ h: string }>(`SELECT md5(coalesce(string_agg(id::text || '|' || amount::text || '|' || coalesce(status,''), ',' ORDER BY id), '')) AS h FROM public.payments`);
    return { inv: inv.rows[0].h, pay: pay.rows[0].h };
  }

  async function read(day: string) {
    const res = await db.query<{ j: { lines: { ref?: string; invoice_id?: string; source?: string; expected_on?: string; amount?: number; rule?: string; date_mode?: string; late?: boolean; estimate?: boolean; part?: string; label?: string }[] } }>(
      `SELECT public.walda_read_expected_money(DATE '${day}') AS j`,
    );
    return res.rows[0].j;
  }
});
