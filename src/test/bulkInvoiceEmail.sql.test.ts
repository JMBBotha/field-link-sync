import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const company = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const user = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const customer = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const other = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const inv1 = "11111111-1111-1111-1111-111111111111";
const inv2 = "22222222-2222-2222-2222-222222222222";
const invVoid = "33333333-3333-3333-3333-333333333333";
const invDraft = "44444444-4444-4444-4444-444444444444";
const invOther = "55555555-5555-5555-5555-555555555555";

describe("send_invoices_email", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid);
      INSERT INTO auth.me VALUES ('${user}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role;
      CREATE FUNCTION public.get_user_company_id(uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT '${company}'::uuid $$;
      CREATE FUNCTION public.has_role(uuid, text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.is_company_owner(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION public.is_sales_rep(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.rep_can_see_invoice(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.is_company_writable(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      CREATE FUNCTION public.fmt_rand_sql(v numeric) RETURNS text LANGUAGE sql AS $$
        SELECT 'R ' || to_char(coalesce(v, 0), 'FM999999990.00') $$;
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY,
        company_id uuid,
        customer_id uuid,
        customer_email text,
        customer_name text,
        invoice_number text,
        status text,
        grand_total numeric,
        line_items jsonb,
        sent_at timestamptz,
        sent_by uuid,
        sent_method text,
        updated_at timestamptz
      );
      CREATE FUNCTION public.invoice_due_now(p_invoice uuid) RETURNS numeric LANGUAGE sql AS $$
        SELECT coalesce(grand_total, 0) FROM public.invoices WHERE id = p_invoice $$;
      CREATE TABLE public.invoice_items (
        id uuid PRIMARY KEY,
        invoice_id uuid,
        description text,
        line_type text,
        quantity numeric,
        unit_price numeric
      );
      CREATE TABLE public.customers (id uuid PRIMARY KEY, email text);
      CREATE TABLE public.customer_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_id uuid,
        token uuid DEFAULT gen_random_uuid(),
        expires_at timestamptz,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.companies (id uuid PRIMARY KEY, name text, accounts_email text);
      CREATE TABLE public.company_profiles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id uuid,
        email text,
        legal_name text,
        archived_at timestamptz,
        is_default boolean,
        created_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.company_members (user_id uuid, company_id uuid, role text);
      CREATE TABLE public.email_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email_id text,
        event_type text,
        recipient_email text,
        quote_number text,
        event_data jsonb
      );
      CREATE TABLE public.audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        action text,
        company_id uuid,
        record_id uuid,
        table_name text,
        user_id uuid,
        new_data jsonb
      );
      CREATE TABLE public.app_webhook_config (id int PRIMARY KEY, email_webhook_token uuid);
      CREATE TABLE public.sent_emails_fired (id uuid);
      CREATE FUNCTION public.notify_document_sent() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF coalesce(current_setting('app.invoice_skip_email', true), '') = 'on' THEN RETURN NEW; END IF;
        INSERT INTO public.sent_emails_fired VALUES (NEW.id);
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_invoices_sent_email AFTER UPDATE ON public.invoices
        FOR EACH ROW WHEN (NEW.status = 'sent' AND OLD.status IS DISTINCT FROM 'sent')
        EXECUTE FUNCTION public.notify_document_sent();
      CREATE SCHEMA IF NOT EXISTS net;
      CREATE TABLE net.calls (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, url text, headers jsonb, body jsonb);
      CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE v_id bigint;
      BEGIN
        INSERT INTO net.calls (url, headers, body) VALUES (url, headers, body) RETURNING id INTO v_id;
        RETURN v_id;
      END $$;
      INSERT INTO public.companies VALUES ('${company}', 'Massair CT', 'accounts@0800becool.co.za');
      INSERT INTO public.company_profiles (company_id, email, legal_name, is_default)
        VALUES ('${company}', 'johan@0800becool.co.za', 'Massair CT (Pty) Ltd', true);
      INSERT INTO public.customers VALUES ('${customer}', 'client@example.com'), ('${other}', 'other@example.com');
      INSERT INTO public.app_webhook_config VALUES (1, gen_random_uuid());
      INSERT INTO public.invoices (id, company_id, customer_id, customer_email, customer_name, invoice_number, status, grand_total, line_items) VALUES
        ('${inv1}', '${company}', '${customer}', 'client@example.com', 'Demo Client', 'INV-1', 'draft', 1500, '[]'),
        ('${inv2}', '${company}', '${customer}', 'client@example.com', 'Demo Client', 'INV-2', 'sent', 800, '[]'),
        ('${invVoid}', '${company}', '${customer}', 'client@example.com', 'Demo Client', 'INV-3', 'void', 100, '[]'),
        ('${invDraft}', '${company}', '${customer}', 'client@example.com', 'Demo Client', 'INV-4', 'draft', 0, '[]'),
        ('${invOther}', '${company}', '${other}', 'other@example.com', 'Other Client', 'INV-9', 'sent', 50, '[]');
    `);
    await db.exec(readFileSync("supabase/migrations/20261113165000_send_invoices_email.sql", "utf8"));
  }, 30000);

  it("preview leaves void and R0 drafts out and does not send", async () => {
    const res = await db.query<{ j: any }>(`
      SELECT public.send_invoices_email(ARRAY['${inv1}','${inv2}','${invVoid}','${invDraft}']::uuid[], NULL, 'preview', NULL) AS j
    `);
    const body = res.rows[0].j;
    expect(body.ok).toBe(true);
    expect(body.subject).toBe("Invoices INV-1, INV-2 from Massair CT");
    expect(body.to).toBe("client@example.com");
    expect(body.from_email).toBe("johan@0800becool.co.za");
    expect(body.from_name).toBe("Massair CT (Pty) Ltd");
    expect(body.html).toContain("INV-1");
    expect(body.html).toContain("INV-2");
    expect(body.html).toContain("Amount due");
    expect(String(body.html).toLowerCase()).not.toContain("payfast");
    expect(body.excluded.map((e: { invoice_number: string }) => e.invoice_number).sort()).toEqual(["INV-3", "INV-4"]);
    expect(body.excluded.map((e: { reason: string }) => e.reason).join(" ")).toMatch(/void/);
    expect(body.excluded.map((e: { reason: string }) => e.reason).join(" ")).toMatch(/draft with R0/);
    const calls = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM net.calls");
    expect(calls.rows[0].n).toBe("0");
    const still = await db.query<{ status: string; grand_total: string; invoice_number: string }>(
      `SELECT status, grand_total::text, invoice_number FROM public.invoices WHERE id = '${inv1}'`,
    );
    expect(still.rows[0]).toMatchObject({ status: "draft", grand_total: "1500", invoice_number: "INV-1" });
  });

  it("refuses invoices for two clients", async () => {
    await expect(db.query(`
      SELECT public.send_invoices_email(ARRAY['${inv1}','${invOther}']::uuid[], NULL, 'preview', NULL)
    `)).rejects.toThrow(/same client/);
  });

  it("sends one email and logs every included invoice without a second mail", async () => {
    const res = await db.query<{ j: any }>(`
      SELECT public.send_invoices_email(
        ARRAY['${inv1}','${inv2}','${invVoid}','${invDraft}']::uuid[],
        'client@example.com',
        'send',
        '{"filename":"Invoices-Demo.pdf","content":"JVBERi0="}'::jsonb
      ) AS j
    `);
    expect(res.rows[0].j.ok).toBe(true);
    expect(res.rows[0].j.email_count).toBe(1);
    const calls = await db.query<{ n: string; body: any }>("SELECT count(*)::text AS n, (array_agg(body))[1] AS body FROM net.calls");
    expect(calls.rows[0].n).toBe("1");
    expect(calls.rows[0].body.to).toBe("client@example.com");
    expect(calls.rows[0].body.subject).toBe("Invoices INV-1, INV-2 from Massair CT");
    expect(calls.rows[0].body.from_email).toBe("johan@0800becool.co.za");
    expect(calls.rows[0].body.file_attachments).toHaveLength(1);
    expect(calls.rows[0].body.file_attachments[0].filename).toBe("Invoices-Demo.pdf");
    const logs = await db.query<{ email_id: string; invoice_id: string }>(`
      SELECT email_id, event_data->>'invoice_id' AS invoice_id
        FROM public.email_events WHERE event_type = 'invoice_email_queued' ORDER BY event_data->>'invoice_number'
    `);
    expect(logs.rows).toHaveLength(2);
    expect(new Set(logs.rows.map((r) => r.email_id)).size).toBe(1);
    expect(logs.rows.map((r) => r.invoice_id).sort()).toEqual([inv1, inv2].sort());
    const audits = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.audit_log WHERE new_data->>'event' = 'invoice_emailed'`);
    expect(audits.rows[0].n).toBe("2");
    const fired = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM public.sent_emails_fired");
    expect(fired.rows[0].n).toBe("0");
    const after = await db.query<{ id: string; status: string; grand_total: string; invoice_number: string; sent_method: string }>(`
      SELECT id::text, status, grand_total::text, invoice_number, coalesce(sent_method, '') AS sent_method
        FROM public.invoices WHERE id IN ('${inv1}','${inv2}','${invVoid}','${invDraft}') ORDER BY invoice_number
    `);
    const byNum = Object.fromEntries(after.rows.map((r) => [r.invoice_number, r]));
    expect(byNum["INV-1"]).toMatchObject({ status: "sent", grand_total: "1500", invoice_number: "INV-1", sent_method: "email" });
    expect(byNum["INV-2"]).toMatchObject({ status: "sent", grand_total: "800", invoice_number: "INV-2", sent_method: "email" });
    expect(byNum["INV-3"]).toMatchObject({ status: "void", grand_total: "100", invoice_number: "INV-3" });
    expect(byNum["INV-4"]).toMatchObject({ status: "draft", grand_total: "0", invoice_number: "INV-4" });
  });
});
