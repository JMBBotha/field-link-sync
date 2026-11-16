import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
const BOT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FNB = "a21423e6-3c82-4db7-b42b-23ffba1a0564";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TWIN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TWIN2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

type Row = { result: string; id: string; account_id: string; balance: string; as_at: string; source: string };

describe("walda_record_bank_balance", () => {
  let db: PGlite;
  let today = "";

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
      INSERT INTO public.companies VALUES ('${CT}', 'active'), ('${IND}', 'archived');
      CREATE TABLE public.walda_session (company_id uuid, allowed boolean);
      INSERT INTO public.walda_session VALUES ('${CT}', true);
      CREATE FUNCTION public._walda_co() RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE co uuid;
      BEGIN
        SELECT company_id INTO co FROM public.walda_session WHERE allowed IS TRUE;
        IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE = '42501'; END IF;
        RETURN co;
      END $$;
      CREATE FUNCTION public.is_company_writable(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active') $$;
      CREATE TABLE public.bot_audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid, actor_id uuid, action text, target_table text, target_id uuid,
        before jsonb, after jsonb, proposal_id uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE FUNCTION public._bot_audit(p_co uuid, p_action text, p_table text, p_id uuid, p_before jsonb, p_after jsonb, p_proposal uuid DEFAULT NULL)
      RETURNS void LANGUAGE sql AS $$
        INSERT INTO public.bot_audit_log (company_id, actor_id, action, target_table, target_id, before, after, proposal_id)
        VALUES (p_co, auth.uid(), p_action, p_table, p_id, p_before, p_after, p_proposal) $$;
      CREATE TABLE public.cf_bank_accounts (
        id uuid PRIMARY KEY, company_id uuid NOT NULL, label text NOT NULL, account_ref text, include boolean NOT NULL DEFAULT true
      );
      INSERT INTO public.cf_bank_accounts VALUES
        ('${FNB}', '${CT}', 'FNB Business', '…563591', true),
        ('${OTHER}', '${IND}', 'Old FNB', '…563591', true),
        ('${TWIN}', '${CT}', 'Card', '1111', true),
        ('${TWIN2}', '${CT}', 'Card copy', '…1111', true);
      CREATE TABLE public.cf_bank_balances (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid NOT NULL, account_id uuid NOT NULL, balance numeric NOT NULL,
        as_of date NOT NULL DEFAULT current_date, entered_by uuid, created_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await db.exec(readFileSync("supabase/migrations/20261116121500_walda_record_bank_balance.sql", "utf8"));
    const day = await db.query<{ d: string }>(`SELECT (now() AT TIME ZONE 'Africa/Johannesburg')::date::text AS d`);
    today = day.rows[0].d;
  }, 30000);

  async function call(sql: string) {
    const res = await db.query<{ j: Row }>(`SELECT public.walda_record_bank_balance(${sql}) AS j`);
    return res.rows[0].j;
  }

  it("inserts for the bot's company, then skips an identical retry and updates a correction", async () => {
    const first = await call(`p_amount => 412550.255, p_as_at => DATE '${today}', p_account_ref => '563591', p_note => 'FNB checked', p_source_ref => 'fnb-${today}'`);
    expect(first.result).toBe("inserted");
    expect(first.account_id).toBe(FNB);
    expect(Number(first.balance)).toBe(412550.26);
    expect(first.source).toBe("walda");
    expect(first.as_at).toBe(today);

    const again = await call(`p_amount => 412550.255, p_as_at => DATE '${today}', p_account_ref => '…563591', p_note => 'FNB checked', p_source_ref => 'fnb-${today}'`);
    expect(again.result).toBe("skipped");
    expect(again.id).toBe(first.id);

    const fixed = await call(`p_amount => 400000, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid, p_account_ref => '563591'`);
    expect(fixed.result).toBe("updated");
    expect(fixed.id).toBe(first.id);
    expect(Number(fixed.balance)).toBe(400000);

    const rows = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.cf_bank_balances WHERE account_id = '${FNB}' AND as_of = DATE '${today}' AND source = 'walda'`);
    expect(rows.rows[0].n).toBe("1");
    const audit = await db.query<{ action: string }>(`SELECT action FROM public.bot_audit_log WHERE target_id = '${first.id}' ORDER BY created_at, action`);
    expect(audit.rows.map((r) => r.action)).toEqual(["bank_balance_inserted", "bank_balance_skipped", "bank_balance_updated"]);
  });

  it("leaves a typed row and an older date alone", async () => {
    await db.exec(`
      INSERT INTO public.cf_bank_balances (company_id, account_id, balance, as_of, source)
      VALUES ('${CT}', '${FNB}', 1, DATE '2026-11-01', 'manual'),
             ('${CT}', '${FNB}', 2, DATE '${today}', 'manual');
    `);
    const older = await call(`p_amount => 50, p_as_at => DATE '2026-11-01', p_account => '${FNB}'::uuid`);
    expect(older.result).toBe("inserted");
    const manual = await db.query<{ balance: string; source: string }>(`
      SELECT balance::text, source FROM public.cf_bank_balances
      WHERE account_id = '${FNB}' AND source = 'manual' ORDER BY as_of`);
    expect(manual.rows).toEqual([{ balance: "1", source: "manual" }, { balance: "2", source: "manual" }]);
    const beforeToday = await db.query<{ n: string; total: string }>(`
      SELECT count(*)::text AS n, coalesce(sum(balance), 0)::text AS total
      FROM public.cf_bank_balances WHERE source = 'walda' AND as_of = DATE '${today}'`);
    await call(`p_amount => -12.5, p_as_at => DATE '2026-11-01', p_account => '${FNB}'::uuid, p_note => 'overdrawn'`);
    const afterToday = await db.query<{ n: string; total: string }>(`
      SELECT count(*)::text AS n, coalesce(sum(balance), 0)::text AS total
      FROM public.cf_bank_balances WHERE source = 'walda' AND as_of = DATE '${today}'`);
    expect(afterToday.rows[0]).toEqual(beforeToday.rows[0]);
    const corrected = await db.query<{ balance: string }>(`SELECT balance::text FROM public.cf_bank_balances WHERE id = '${older.id}'`);
    expect(Number(corrected.rows[0].balance)).toBe(-12.5);
    const nov1 = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.cf_bank_balances WHERE account_id = '${FNB}' AND as_of = DATE '2026-11-01' AND source = 'walda'`);
    expect(nov1.rows[0].n).toBe("1");
  });

  it("refuses a future date, a bad amount, a dormant company, another company's account, and a caller who is not the bot", async () => {
    await expect(call(`p_amount => 10, p_as_at => (DATE '${today}' + 1), p_account => '${FNB}'::uuid`)).rejects.toThrow(/future/);
    await expect(call(`p_amount => NULL, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid`)).rejects.toThrow(/Amount is required/);
    await expect(call(`p_amount => 1000000001, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid`)).rejects.toThrow(/not a bank balance/);
    await expect(call(`p_amount => 10, p_as_at => DATE '${today}'`)).rejects.toThrow(/account id or the account reference/);
    await expect(call(`p_amount => 10, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid, p_account_ref => '9999'`)).rejects.toThrow(/does not match/);
    await expect(call(`p_amount => 10, p_as_at => DATE '${today}', p_account_ref => '1111'`)).rejects.toThrow(/More than one/);
    await expect(call(`p_amount => 10, p_as_at => DATE '${today}', p_account => '${OTHER}'::uuid`)).rejects.toThrow(/not found/);
    await db.exec(`UPDATE public.companies SET status = 'archived' WHERE id = '${CT}'`);
    try {
      await expect(call(`p_amount => 10, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid`)).rejects.toThrow(/not active/);
    } finally {
      await db.exec(`UPDATE public.companies SET status = 'active' WHERE id = '${CT}'`);
    }
    await db.exec(`UPDATE public.walda_session SET allowed = false`);
    try {
      await expect(call(`p_amount => 10, p_as_at => DATE '${today}', p_account => '${FNB}'::uuid`)).rejects.toThrow(/not allowed/);
    } finally {
      await db.exec(`UPDATE public.walda_session SET allowed = true`);
    }
    const authz = await db.query<{ ok: boolean; anon: boolean; pub: boolean }>(`
      SELECT has_function_privilege('authenticated', 'public.walda_record_bank_balance(numeric,date,uuid,text,text,text)', 'execute') AS ok,
             has_function_privilege('anon', 'public.walda_record_bank_balance(numeric,date,uuid,text,text,text)', 'execute') AS anon,
             has_function_privilege('public', 'public.walda_record_bank_balance(numeric,date,uuid,text,text,text)', 'execute') AS pub`);
    expect(authz.rows[0]).toEqual({ ok: true, anon: false, pub: false });
  });
});
