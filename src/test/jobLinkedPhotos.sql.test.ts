import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT = "11111111-1111-4111-8111-111111111111";
const OT = "22222222-2222-4222-8222-222222222222";
const TECH = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const REP = "55555555-5555-4555-8555-555555555555";
const STRANGER = "66666666-6666-4666-8666-666666666666";
const JOB = "77777777-7777-4777-8777-777777777777";
const JOB_INV = "77777777-7777-4777-8777-777777777778";
const QUOTE = "88888888-8888-4888-8888-888888888888";
const QUOTE_B = "88888888-8888-4888-8888-888888888889";
const INV = "99999999-9999-4999-8999-999999999999";
const INV_ONLY = "99999999-9999-4999-8999-999999999998";
const LEAD_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const LEAD_VISIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LEAD_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const HOUSE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CUST = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

describe("job linked photos access", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      CREATE TABLE auth.me (uid uuid, company uuid, tech_only boolean, sales_rep boolean, office boolean);
      INSERT INTO auth.me VALUES ('${TECH}', '${CT}', true, false, false);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM auth.me LIMIT 1 $$;
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE TYPE public.app_role AS ENUM ('admin', 'dispatcher', 'field_agent', 'viewer', 'platform_super_admin', 'platform_ops');
      CREATE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT company FROM auth.me LIMIT 1 $$;
      CREATE FUNCTION public.is_field_tech_only(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS (SELECT 1 FROM auth.me m WHERE m.uid = _uid AND m.tech_only) $$;
      CREATE FUNCTION public.is_sales_rep(_uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS (SELECT 1 FROM auth.me m WHERE m.uid = _uid AND m.sales_rep) $$;
      CREATE FUNCTION public.has_role(uid uuid, role public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM auth.me m
          WHERE m.uid = has_role.uid AND m.office
            AND role IN ('admin', 'dispatcher', 'platform_super_admin', 'platform_ops')
        ) $$;

      CREATE TABLE public.jobs (
        id uuid PRIMARY KEY, company_id uuid, customer_id uuid, created_by uuid,
        quote_id uuid, variation_quote_id uuid, invoice_id uuid, lead_id uuid
      );
      CREATE TABLE public.assignments (
        job_id uuid, profile_id uuid, assigned_by uuid, status text
      );
      CREATE TABLE public.customers (
        id uuid PRIMARY KEY, company_id uuid, assigned_rep_id uuid, owner_rep_id uuid
      );
      CREATE TABLE public.job_schedules (job_id uuid, agent_id uuid);
      CREATE TABLE public.quotes (
        id uuid PRIMARY KEY, company_id uuid, quote_number text, lead_id uuid,
        sales_engineer_id uuid, owner_id uuid, created_by uuid, visual_sections jsonb, created_at timestamptz
      );
      CREATE TABLE public.leads (
        id uuid PRIMARY KEY, company_id uuid, deleted_at timestamptz, assigned_agent_id uuid, created_by uuid
      );
      CREATE TABLE public.lead_assignment_log (lead_id uuid, company_id uuid, assigned_by uuid);
      CREATE TABLE public.invoices (
        id uuid PRIMARY KEY, company_id uuid, quote_id uuid, invoice_number text, lead_id uuid
      );
      CREATE TABLE public.quote_attachments (
        id uuid PRIMARY KEY, quote_id uuid, storage_path text, caption text, filename text, created_at timestamptz
      );
      CREATE TABLE public.job_photos (
        id uuid PRIMARY KEY, lead_id uuid, storage_path text, annotated_path text, caption text, photo_type text, created_at timestamptz
      );
      CREATE TABLE public.site_surveys (
        id uuid PRIMARY KEY, company_id uuid, lead_id uuid, quote_id uuid, archived_at timestamptz
      );
      CREATE TABLE public.site_survey_media (
        id uuid PRIMARY KEY, survey_id uuid, company_id uuid, kind text, storage_path text,
        annotated_path text, caption text, archived_at timestamptz, taken_at timestamptz, created_at timestamptz
      );

      INSERT INTO public.customers VALUES ('${CUST}', '${CT}', NULL, NULL);
      INSERT INTO public.leads VALUES
        ('${LEAD_JOB}', '${CT}', NULL, NULL, NULL),
        ('${LEAD_VISIT}', '${CT}', NULL, NULL, NULL),
        ('${LEAD_OTHER}', '${OT}', NULL, NULL, NULL);
      INSERT INTO public.quotes VALUES
        ('${QUOTE}', '${CT}', 'Q-2026-0063', '${LEAD_VISIT}', '${REP}', NULL, NULL,
         '[{"images":["quote-photos:${CT}/${QUOTE}/outdoor.jpg","quote-photos:${CT}/${QUOTE}/board.jpg"]}]'::jsonb, now()),
        ('${QUOTE_B}', '${OT}', 'Q-OTHER', '${LEAD_OTHER}', NULL, NULL, NULL, NULL, now());
      INSERT INTO public.invoices VALUES
        ('${INV}', '${CT}', '${QUOTE}', 'INV-045', '${LEAD_VISIT}'),
        ('${INV_ONLY}', '${CT}', '${QUOTE_B}', 'INV-099', NULL);
      INSERT INTO public.jobs VALUES
        ('${JOB}', '${CT}', '${CUST}', NULL, '${QUOTE}', NULL, '${INV}', '${LEAD_JOB}'),
        ('${JOB_INV}', '${CT}', '${CUST}', NULL, NULL, NULL, '${INV}', '${LEAD_JOB}');
      UPDATE public.invoices SET quote_id = '${QUOTE}' WHERE id = '${INV_ONLY}';
      INSERT INTO public.assignments VALUES
        ('${JOB}', '${TECH}', '${ADMIN}', 'accepted'),
        ('${JOB_INV}', '${TECH}', '${ADMIN}', 'accepted');
      INSERT INTO public.quote_attachments VALUES
        ('aaaaaaaa-0000-4000-8000-000000000001', '${QUOTE}', '${CT}/${QUOTE}/outdoor.jpg', '', 'outdoor.jpg', now()),
        ('aaaaaaaa-0000-4000-8000-000000000002', '${QUOTE_B}', '${OT}/${QUOTE_B}/secret.jpg', 'no', 'secret.jpg', now());
      INSERT INTO public.job_photos VALUES
        ('aaaaaaaa-0000-4000-8000-000000000011', '${LEAD_VISIT}', '${CT}/${LEAD_VISIT}/front.jpg', NULL, 'Front of house', 'site', now()),
        ('aaaaaaaa-0000-4000-8000-000000000012', '${LEAD_JOB}', '${CT}/${LEAD_JOB}/own.jpg', '${CT}/${LEAD_JOB}/own-marked.jpg', 'On the job', 'site', now()),
        ('aaaaaaaa-0000-4000-8000-000000000013', '${LEAD_OTHER}', '${OT}/${LEAD_OTHER}/nope.jpg', NULL, 'Other company', 'site', now()),
        ('aaaaaaaa-0000-4000-8000-000000000014', '${LEAD_VISIT}', '../secret.jpg', NULL, 'bad', 'site', now());
      INSERT INTO public.site_surveys VALUES ('aaaaaaaa-0000-4000-8000-000000000021', '${CT}', '${LEAD_VISIT}', '${QUOTE}', NULL);
      INSERT INTO public.site_survey_media VALUES
        ('aaaaaaaa-0000-4000-8000-000000000031', 'aaaaaaaa-0000-4000-8000-000000000021', '${CT}', 'front', '${CT}/aaaaaaaa-0000-4000-8000-000000000021/front.jpg', NULL, 'Street', NULL, now(), now()),
        ('aaaaaaaa-0000-4000-8000-000000000032', 'aaaaaaaa-0000-4000-8000-000000000021', '${CT}', 'audio', '${CT}/aaaaaaaa-0000-4000-8000-000000000021/note.webm', NULL, 'Voice', NULL, now(), now());
    `);
    await db.exec(readFileSync("supabase/migrations/20261118121500_job_linked_photos.sql", "utf8"));
  }, 30000);

  async function actor(uid: string, company: string, flags: { tech?: boolean; rep?: boolean; office?: boolean }) {
    await db.exec(`UPDATE auth.me SET uid = '${uid}', company = '${company}', tech_only = ${flags.tech ? "true" : "false"}, sales_rep = ${flags.rep ? "true" : "false"}, office = ${flags.office ? "true" : "false"}`);
  }

  async function may(job = JOB) {
    const res = await db.query<{ ok: boolean }>(`SELECT public.caller_may_read_linked_job('${job}'::uuid) AS ok`);
    return res.rows[0].ok;
  }

  async function photos(job = JOB) {
    const res = await db.query<{ j: unknown }>(`SELECT public.job_linked_photos('${job}'::uuid) AS j`);
    const value = res.rows[0].j;
    return (typeof value === "string" ? JSON.parse(value) : value) as { id: string; bucket: string; storage_path: string; display_path: string; source: string; ref: string | null; lead_id: string | null }[];
  }

  it("lets the assigned technician read this company's quote, visit, and survey pictures", async () => {
    await actor(TECH, CT, { tech: true });
    expect(await may()).toBe(true);
    const rows = await photos();
    const paths = rows.map((r) => r.storage_path);
    expect(paths).toContain(`${CT}/${QUOTE}/outdoor.jpg`);
    expect(paths).toContain(`${CT}/${QUOTE}/board.jpg`);
    expect(paths).toContain(`${CT}/${LEAD_VISIT}/front.jpg`);
    expect(paths).toContain(`${CT}/aaaaaaaa-0000-4000-8000-000000000021/front.jpg`);
    expect(paths).not.toContain(`${OT}/${QUOTE_B}/secret.jpg`);
    expect(paths).not.toContain(`${OT}/${LEAD_OTHER}/nope.jpg`);
    expect(paths).not.toContain("../secret.jpg");
    expect(paths.some((p) => p.endsWith(".webm"))).toBe(false);
    const outdoor = rows.filter((r) => r.storage_path.endsWith("/outdoor.jpg"));
    expect(outdoor.every((r) => r.source === "quote" && r.ref === "Q-2026-0063")).toBe(true);
    expect(rows.find((r) => r.storage_path.endsWith("/front.jpg") && r.bucket === "job-photos")?.source).toBe("site_visit");
    expect(rows.find((r) => r.storage_path.endsWith("/own.jpg"))?.display_path).toBe(`${CT}/${LEAD_JOB}/own-marked.jpg`);
  });

  it("labels an invoice-only link with the invoice number", async () => {
    await actor(TECH, CT, { tech: true });
    const rows = await photos(JOB_INV);
    expect(rows.find((r) => r.storage_path.endsWith("/outdoor.jpg"))?.source).toBe("invoice");
    expect(rows.find((r) => r.storage_path.endsWith("/outdoor.jpg"))?.ref).toBe("INV-045");
  });

  it("refuses a technician who is not assigned, a rejected assignment, another company, and a salesperson with no link", async () => {
    await actor(TECH, CT, { tech: true });
    await db.exec(`UPDATE public.assignments SET status = 'rejected' WHERE profile_id = '${TECH}'`);
    expect(await may()).toBe(false);
    await expect(photos()).rejects.toThrow(/Job not found/);
    await db.exec(`UPDATE public.assignments SET status = 'accepted' WHERE profile_id = '${TECH}'`);

    await actor(STRANGER, CT, { tech: true });
    expect(await may()).toBe(false);

    await actor(TECH, OT, { tech: true });
    expect(await may()).toBe(false);

    await actor(ADMIN, OT, { office: true });
    expect(await may()).toBe(false);

    await actor(REP, CT, { rep: true });
    expect(await may()).toBe(true);

    await actor(STRANGER, CT, { rep: true });
    expect(await may()).toBe(false);

    await actor(ADMIN, CT, { office: true });
    expect(await may()).toBe(true);
    expect((await photos()).some((r) => r.storage_path.endsWith("/outdoor.jpg"))).toBe(true);
  });

  it("signs only a quote path and a lead path that this job links", async () => {
    await actor(TECH, CT, { tech: true });
    const quoteOk = await db.query<{ ok: boolean }>(
      `SELECT public.linked_quote_photo_readable('${CT}/${QUOTE}/outdoor.jpg') AS ok`,
    );
    const quoteNo = await db.query<{ ok: boolean }>(
      `SELECT public.linked_quote_photo_readable('${OT}/${QUOTE_B}/secret.jpg') AS ok`,
    );
    const leadOk = await db.query<{ ok: boolean }>(
      `SELECT public.linked_lead_photo_readable('${CT}/${LEAD_VISIT}/front.jpg') AS ok`,
    );
    const leadNo = await db.query<{ ok: boolean }>(
      `SELECT public.linked_lead_photo_readable('${OT}/${LEAD_OTHER}/nope.jpg') AS ok`,
    );
    expect(quoteOk.rows[0].ok).toBe(true);
    expect(quoteNo.rows[0].ok).toBe(false);
    expect(leadOk.rows[0].ok).toBe(true);
    expect(leadNo.rows[0].ok).toBe(false);
  });

  it("adds the customer's site once the house photo table exists, still inside this company", async () => {
    await actor(TECH, CT, { tech: true });
    await db.exec(`
      ALTER TABLE public.quotes ADD COLUMN project_house_id uuid;
      ALTER TABLE public.invoices ADD COLUMN project_house_id uuid;
      CREATE TABLE public.house_photos (
        id uuid PRIMARY KEY, company_id uuid, project_house_id uuid, storage_path text, caption text, created_at timestamptz
      );
      UPDATE public.quotes SET project_house_id = '${HOUSE}' WHERE id = '${QUOTE}';
      INSERT INTO public.house_photos VALUES
        ('aaaaaaaa-0000-4000-8000-000000000041', '${CT}', '${HOUSE}', '${CT}/p/${HOUSE}/site.jpg', 'Sleeve point', now()),
        ('aaaaaaaa-0000-4000-8000-000000000042', '${OT}', '${HOUSE}', '${OT}/p/${HOUSE}/other.jpg', 'Other company', now());
    `);
    const rows = await photos();
    const sites = rows.filter((r) => r.bucket === "house-photos");
    expect(sites.map((r) => r.storage_path)).toEqual([`${CT}/p/${HOUSE}/site.jpg`]);
    expect(sites[0].source).toBe("site");
  });
});
