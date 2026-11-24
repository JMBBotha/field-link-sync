/**
 * Invoice on a draft/sent/viewed quote accepts it. PGlite only. No live database.
 * The deposit function here is the live guard plus a side effect, so a second
 * invoice or a client send would show up in the assertions.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("supabase/migrations/20261123180000_accept_quote_when_invoiced.sql", "utf8");
const backfill = readFileSync("docs/backfill/quotes-with-invoice-not-accepted.sql", "utf8");

const CO = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DORMANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REP = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const schema = `
CREATE TABLE public.companies (id uuid PRIMARY KEY, writable boolean NOT NULL DEFAULT true);
INSERT INTO public.companies VALUES ('${CO}', true), ('${DORMANT}', false);

CREATE TABLE public.customers (id uuid PRIMARY KEY, name text);
CREATE TABLE public.quotes (
  id uuid PRIMARY KEY,
  company_id uuid,
  customer_id uuid,
  customer_name text,
  quote_number text,
  status text,
  total numeric,
  archived_at timestamptz,
  followup_state text,
  followup_next_at timestamptz,
  sent_at timestamptz,
  accepted_at timestamptz,
  accepted_by text,
  locked_at timestamptz,
  locked_by uuid,
  locked_reason text,
  is_variation boolean DEFAULT false,
  sales_engineer_id uuid,
  option_group_id uuid
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid,
  company_id uuid,
  invoice_number text,
  status text,
  grand_total numeric,
  notes text,
  issue_date date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.status_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text,
  entity_id uuid,
  field_name text,
  old_status text,
  new_status text,
  changed_by text,
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.quote_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid,
  quote_id uuid,
  from_status text,
  to_status text,
  kind text,
  reason text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.quote_lock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid,
  company_id uuid,
  action text,
  reason text,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text,
  record_id uuid,
  action text,
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  company_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  type text,
  title text,
  body text,
  related_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.deposit_calls (quote_id uuid, action text, created_at timestamptz DEFAULT now());
CREATE TABLE public.client_outbox (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), invoice_id uuid, channel text);

CREATE OR REPLACE FUNCTION public.enforce_company_writable() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cid uuid;
BEGIN
  cid := nullif(to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END)->>'company_id', '')::uuid;
  IF cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND NOT c.writable) THEN
    RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
-- UPDATE only: the accept path is a quote update, and that must still hit this check.
CREATE TRIGGER zz_dormant_company_write BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_company_writable();

CREATE OR REPLACE FUNCTION public.fl_quote_autolock_on_accept() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'accepted' AND OLD.status IS DISTINCT FROM 'accepted' AND NEW.locked_at IS NULL THEN
    NEW.locked_at := now();
    NEW.locked_by := NULL;
    NEW.locked_reason := 'accepted';
    INSERT INTO public.quote_lock_events (quote_id, company_id, action, reason)
    VALUES (NEW.id, NEW.company_id, 'lock', 'accepted');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_quotes_autolock_on_accept BEFORE UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_autolock_on_accept();

CREATE OR REPLACE FUNCTION public._quote_followup_on_send() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('accepted','declined','superseded','void','option_not_chosen')
     AND NEW.followup_state IS DISTINCT FROM 'closed' AND NEW.followup_state IS NOT NULL THEN
    NEW.followup_state := 'closed';
    NEW.followup_next_at := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_followup_on_send BEFORE UPDATE OF sent_at, status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public._quote_followup_on_send();

CREATE OR REPLACE FUNCTION public.fl_quote_stage_log() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.quote_stage_events (company_id, quote_id, from_status, to_status, kind)
    VALUES (NEW.company_id, NEW.id, OLD.status, NEW.status, 'change');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER trg_quote_stage_log AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.fl_quote_stage_log();

CREATE OR REPLACE FUNCTION public.audit_trigger() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, new_data)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW));
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER audit_quotes AFTER INSERT OR UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE OR REPLACE FUNCTION public.notify_quote_status_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'accepted'
       AND position(',' || NEW.id::text || ',' IN COALESCE(current_setting('app.isa_alerted_quotes', true), '')) > 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (NEW.sales_engineer_id, 'quote_status_change', 'Quote ' || initcap(NEW.status),
            'Quote ' || NEW.quote_number || ' has been ' || NEW.status, NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_notify_quote_status AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.notify_quote_status_change();

-- Live oneinv guard, then a deposit insert and a client send. A hit past the
-- guard is the failure this feature must not cause.
CREATE OR REPLACE FUNCTION public.create_deposit_invoice_for_quote(p_quote_id uuid) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE v_existing uuid; v_id uuid;
BEGIN
  SELECT id INTO v_existing FROM public.invoices
   WHERE quote_id = p_quote_id AND COALESCE(status, '') NOT IN ('void', 'cancelled')
   ORDER BY created_at ASC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    INSERT INTO public.deposit_calls (quote_id, action) VALUES (p_quote_id, 'returned_existing');
    RETURN v_existing;
  END IF;
  INSERT INTO public.deposit_calls (quote_id, action) VALUES (p_quote_id, 'created');
  INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total, notes)
  SELECT p_quote_id, q.company_id, 'INV-AUTO', 'draft', q.total, 'DEPOSIT'
    FROM public.quotes q WHERE q.id = p_quote_id
  RETURNING id INTO v_id;
  INSERT INTO public.client_outbox (invoice_id, channel) VALUES (v_id, 'email');
  INSERT INTO public.client_outbox (invoice_id, channel) VALUES (v_id, 'whatsapp');
  INSERT INTO public.client_outbox (invoice_id, channel) VALUES (v_id, 'sms');
  RETURN v_id;
END $$;

-- Same shape as production: the quote trigger calls create_invoice_from_accepted_quote,
-- and the migration replaces that function with the guard.
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.is_variation, false) THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER on_quote_accepted AFTER UPDATE OF status ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.create_invoice_from_accepted_quote();
`;

async function quoteOf(db: PGlite, id: string) {
  const r = await db.query<Record<string, string | null>>(
    `SELECT status, accepted_by, followup_state, locked_reason,
            (accepted_at IS NOT NULL) AS has_accepted_at,
            (followup_next_at IS NULL) AS followup_cleared
       FROM public.quotes WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

describe("accept quote when an invoice is created", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;`);
    await db.exec(schema);
    await db.exec(migration);
    await db.exec(`
      INSERT INTO public.customers VALUES ('11111111-1111-1111-1111-111111111111', 'Harbour View');
      INSERT INTO public.quotes (id, company_id, customer_id, customer_name, quote_number, status, total, followup_state, followup_next_at, sales_engineer_id)
      VALUES
        ('10000000-0000-0000-0000-000000000001', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-2026-0142', 'sent', 18400, 'quoted', now() + interval '2 days', '${REP}'),
        ('10000000-0000-0000-0000-000000000002', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-DRAFT', 'draft', 5000, 'quoted', now() + interval '1 day', '${REP}'),
        ('10000000-0000-0000-0000-000000000003', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-VIEW', 'viewed', 900, NULL, NULL, '${REP}'),
        ('10000000-0000-0000-0000-000000000004', '${CO}', '11111111-1111-1111-1111-111111111111', 'Declined Client', 'Q-DEC', 'declined', 100, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000005', '${CO}', '11111111-1111-1111-1111-111111111111', 'Lost Client', 'Q-LOST', 'lost', 100, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000006', '${CO}', '11111111-1111-1111-1111-111111111111', 'Archived Client', 'Q-ARCH', 'sent', 100, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000007', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-LINK', 'sent', 2500, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000008', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-VOID', 'sent', 800, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000009', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-FULL', 'sent', 4200, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000010', '${DORMANT}', '11111111-1111-1111-1111-111111111111', 'Dormant Co', 'Q-DORM', 'sent', 300, 'quoted', now(), '${REP}'),
        ('10000000-0000-0000-0000-000000000011', '${CO}', '11111111-1111-1111-1111-111111111111', 'Harbour View', 'Q-MARK', 'sent', 7000, 'quoted', now(), '${REP}');
      UPDATE public.quotes SET archived_at = now() WHERE id = '10000000-0000-0000-0000-000000000006';
    `);
  });

  it("accepts a sent quote when a deposit invoice is created, and does not make a second one", async () => {
    await db.exec(`
      INSERT INTO public.invoices (id, quote_id, company_id, invoice_number, status, grand_total, notes, issue_date)
      VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '${CO}', 'INV-1042', 'draft', 12880, 'DEPOSIT 70%', '2026-11-23');
    `);
    const q = await quoteOf(db, "10000000-0000-0000-0000-000000000001");
    expect(q).toMatchObject({
      status: "accepted",
      accepted_by: "system:invoice INV-1042",
      has_accepted_at: true,
      followup_state: "closed",
      followup_cleared: true,
      locked_reason: "accepted",
    });

    const invoices = await db.query<{ n: string; status: string; notes: string; total: string }>(
      `SELECT count(*)::text AS n, max(status) AS status, max(notes) AS notes, max(grand_total)::text AS total
         FROM public.invoices WHERE quote_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(invoices.rows[0].n).toBe("1");
    expect(invoices.rows[0].status).toBe("draft");
    expect(invoices.rows[0].notes).toBe("DEPOSIT 70%");
    expect(Number(invoices.rows[0].total)).toBe(12880);

    const calls = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.deposit_calls WHERE quote_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(calls.rows[0].n).toBe("0");
    const sent = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM public.client_outbox`);
    expect(sent.rows[0].n).toBe("0");

    const stage = await db.query<{ from_status: string; to_status: string }>(
      `SELECT from_status, to_status FROM public.quote_stage_events WHERE quote_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(stage.rows).toEqual([{ from_status: "sent", to_status: "accepted" }]);

    const lock = await db.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM public.quote_lock_events WHERE quote_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(lock.rows).toEqual([{ action: "lock", reason: "accepted" }]);

    const audit = await db.query<{ action: string; status: string; by: string }>(
      `SELECT action, new_data->>'status' AS status, new_data->>'accepted_by' AS by
         FROM public.audit_log
        WHERE table_name = 'quotes' AND record_id = '10000000-0000-0000-0000-000000000001' AND action = 'update'`,
    );
    expect(audit.rows).toEqual([{ action: "update", status: "accepted", by: "system:invoice INV-1042" }]);

    const log = await db.query<{ old_status: string; new_status: string; changed_by: string }>(
      `SELECT old_status, new_status, changed_by FROM public.status_change_log WHERE entity_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(log.rows).toEqual([{ old_status: "sent", new_status: "accepted", changed_by: "system:invoice INV-1042" }]);

    const notice = await db.query<{ title: string; type: string; user_id: string }>(
      `SELECT title, type, user_id::text FROM public.notifications WHERE related_id = '10000000-0000-0000-0000-000000000001'`,
    );
    expect(notice.rows).toEqual([{ title: "Quote Accepted", type: "quote_status_change", user_id: REP }]);
  });

  it("accepts a draft quote and a viewed quote, including a full invoice", async () => {
    await db.exec(`
      INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total, notes)
      VALUES
        ('10000000-0000-0000-0000-000000000002', '${CO}', 'INV-1043', 'draft', 5000, 'Quote Q-DRAFT'),
        ('10000000-0000-0000-0000-000000000003', '${CO}', 'INV-1044', 'sent', 900, 'Quote Q-VIEW'),
        ('10000000-0000-0000-0000-000000000009', '${CO}', 'INV-1048', 'sent', 4200, 'Quote Q-FULL');
    `);
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000002")).accepted_by).toBe("system:invoice INV-1043");
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000003")).status).toBe("accepted");
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000009")).accepted_by).toBe("system:invoice INV-1048");
    const extra = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.invoices WHERE invoice_number = 'INV-AUTO'`,
    );
    expect(extra.rows[0].n).toBe("0");
  });

  it("does not accept on a void or cancelled invoice", async () => {
    await db.exec(`
      INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total)
      VALUES
        ('10000000-0000-0000-0000-000000000008', '${CO}', 'INV-VOID', 'void', 800),
        ('10000000-0000-0000-0000-000000000008', '${CO}', 'INV-CAN', 'cancelled', 800);
    `);
    const q = await quoteOf(db, "10000000-0000-0000-0000-000000000008");
    expect(q.status).toBe("sent");
    expect(q.accepted_by).toBeNull();
    expect(q.locked_reason).toBeNull();
    expect(q.followup_state).toBe("quoted");
  });

  it("leaves declined, lost and archived quotes unchanged", async () => {
    await db.exec(`
      INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total)
      VALUES
        ('10000000-0000-0000-0000-000000000004', '${CO}', 'INV-DEC', 'draft', 100),
        ('10000000-0000-0000-0000-000000000005', '${CO}', 'INV-LOST', 'paid', 100),
        ('10000000-0000-0000-0000-000000000006', '${CO}', 'INV-ARCH', 'draft', 100);
    `);
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000004")).status).toBe("declined");
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000005")).status).toBe("lost");
    const archived = await quoteOf(db, "10000000-0000-0000-0000-000000000006");
    expect(archived.status).toBe("sent");
    expect(archived.accepted_by).toBeNull();
  });

  it("accepts when an existing invoice is linked, without rewriting the invoice", async () => {
    await db.exec(`
      INSERT INTO public.invoices (id, quote_id, company_id, invoice_number, status, grand_total, notes, issue_date)
      VALUES ('20000000-0000-0000-0000-000000000070', NULL, '${CO}', 'INV-1070', 'draft', 2500, 'Standing draft', '2026-11-20');
    `);
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000007")).status).toBe("sent");
    await db.exec(`
      UPDATE public.invoices SET quote_id = '10000000-0000-0000-0000-000000000007'
       WHERE id = '20000000-0000-0000-0000-000000000070';
    `);
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000007")).accepted_by).toBe("system:invoice INV-1070");
    const inv = await db.query<{ invoice_number: string; status: string; notes: string; total: string }>(
      `SELECT invoice_number, status, notes, grand_total::text AS total FROM public.invoices WHERE id = '20000000-0000-0000-0000-000000000070'`,
    );
    expect(inv.rows[0]).toEqual({ invoice_number: "INV-1070", status: "draft", notes: "Standing draft", total: "2500" });
  });

  it("does not accept a dormant company, and does not bypass the writable check", async () => {
    await expect(db.exec(`
      INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total)
      VALUES ('10000000-0000-0000-0000-000000000010', '${DORMANT}', 'INV-DORM', 'draft', 300);
    `)).rejects.toThrow(/not active/i);
    const q = await quoteOf(db, "10000000-0000-0000-0000-000000000010");
    expect(q.status).toBe("sent");
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.invoices WHERE invoice_number = 'INV-DORM'`,
    );
    expect(n.rows[0].n).toBe("0");
  });

  it("still creates one deposit invoice when Mark accepted runs and no invoice exists yet", async () => {
    await db.exec(`
      UPDATE public.quotes SET status = 'accepted', accepted_at = now(), accepted_by = 'staff:Johan Botha'
       WHERE id = '10000000-0000-0000-0000-000000000011';
    `);
    const q = await quoteOf(db, "10000000-0000-0000-0000-000000000011");
    expect(q.status).toBe("accepted");
    expect(q.locked_reason).toBe("accepted");
    expect(q.accepted_by).toBe("staff:Johan Botha");
    const rows = await db.query<{ invoice_number: string; notes: string }>(
      `SELECT invoice_number, notes FROM public.invoices WHERE quote_id = '10000000-0000-0000-0000-000000000011' ORDER BY created_at`,
    );
    expect(rows.rows).toEqual([{ invoice_number: "INV-AUTO", notes: "DEPOSIT" }]);
    const calls = await db.query<{ action: string }>(
      `SELECT action FROM public.deposit_calls WHERE quote_id = '10000000-0000-0000-0000-000000000011'`,
    );
    expect(calls.rows.map((r) => r.action)).toEqual(["created"]);
    const channels = await db.query<{ channel: string }>(`SELECT channel FROM public.client_outbox ORDER BY channel`);
    expect(channels.rows.map((r) => r.channel)).toEqual(["email", "sms", "whatsapp"]);
  });

  it("the existing deposit guard sees the invoice inside the same transaction", async () => {
    // Take the explicit early return off, so the accept trigger calls
    // create_deposit_invoice_for_quote the way it did before this migration.
    // That function's own SELECT must see the invoice inserted in this
    // transaction and return it, with no second invoice and no client send.
    await db.exec(`
      CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF COALESCE(NEW.is_variation, false) THEN RETURN NEW; END IF;
        IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
          PERFORM public.create_deposit_invoice_for_quote(NEW.id);
        END IF;
        RETURN NEW;
      END $$;
      INSERT INTO public.quotes (id, company_id, customer_name, quote_number, status, total, followup_state, sales_engineer_id)
      VALUES ('10000000-0000-0000-0000-000000000012', '${CO}', 'Probe', 'Q-PROBE', 'sent', 111, 'quoted', '${REP}');
      INSERT INTO public.invoices (quote_id, company_id, invoice_number, status, grand_total, notes)
      VALUES ('10000000-0000-0000-0000-000000000012', '${CO}', 'INV-PROBE', 'draft', 111, 'DEPOSIT');
    `);
    const calls = await db.query<{ action: string }>(
      `SELECT action FROM public.deposit_calls WHERE quote_id = '10000000-0000-0000-0000-000000000012'`,
    );
    expect(calls.rows.map((r) => r.action)).toEqual(["returned_existing"]);
    const n = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.invoices WHERE quote_id = '10000000-0000-0000-0000-000000000012'`,
    );
    expect(n.rows[0].n).toBe("1");
    const probeSent = await db.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM public.client_outbox o
         JOIN public.invoices i ON i.id = o.invoice_id
        WHERE i.quote_id = '10000000-0000-0000-0000-000000000012'`,
    );
    expect(probeSent.rows[0].n).toBe("0");
    expect((await quoteOf(db, "10000000-0000-0000-0000-000000000012")).status).toBe("accepted");
  });

  it("lists only draft and sent quotes that already have a live invoice", async () => {
    const listed = await db.query<{ quote_number: string; client: string; status: string; invoice_numbers: string; invoice_statuses: string; invoice_dates: string }>(
      backfill.replace(/;$/, ""),
    );
    const numbers = listed.rows.map((r) => r.quote_number);
    expect(numbers).toEqual(["Q-ARCH"]);
    const archived = listed.rows.find((r) => r.quote_number === "Q-ARCH");
    expect(archived).toMatchObject({
      client: "Archived Client",
      status: "sent",
      invoice_numbers: "INV-ARCH",
      invoice_statuses: "draft",
    });
    expect(archived?.invoice_dates).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const writes = backfill.replace(/--[^\n]*/g, "");
    expect(writes).not.toMatch(/\b(insert|update|delete|alter|drop|truncate)\b/i);
  });
});
