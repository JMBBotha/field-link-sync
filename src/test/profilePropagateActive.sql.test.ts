import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const CT_CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const IND_CO = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
const OTHER_CO = "11111111-1111-4111-8111-111111111111";
const CT = "8ebd6434-3fca-5a8d-8476-270e994dcb46";
const IND = "e4030429-0f61-5c0c-8bd2-f20b0ea162ef";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OLD = "BANKING DETAILS: FNB\n\nWARRANTY: One year on all moving parts, and a five year manufacturer's warranty on the compressor subject to a service contract. Please Note: The service contract extends the manufacturer's warranty on the compressor for 5 years should the compressor fail we will install the replacement compressor free of charge.\n\nTERMS OF PAYMENT: on completion.";
const NEW = "Two years warranty on all moving parts and a 3-year manufacturer's warranty on the compressor, subject to a service contract. Our service contract extends the manufacturer's warranty on the compressor to 5 years. If the compressor fails, we will install the replacement compressor free of charge.";

const migration = readFileSync(
  "supabase/migrations/20261117123000_profile_propagate_skip_inactive.sql",
  "utf8",
);

describe("fl_profiles_after skips inactive companies", () => {
  it("does not replace the writable check or mention Ind", () => {
    expect(migration).not.toMatch(/create or replace function public\.enforce_company_writable/i);
    expect(migration).not.toMatch(/disable trigger/i);
    expect(migration).not.toContain(IND);
    expect(migration).toContain(CT);
    expect(migration).toContain("public.is_company_writable(p.company_id)");
    expect(migration).toContain("Two years warranty on all moving parts and a 3-year manufacturer''s warranty");
    expect(migration).toContain("LIKE '%One year on all moving parts, and a five year manufacturer''s warranty%'");
  });

  it("saves the master profile and the CT warranty sentence while leaving Ind untouched", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE public.companies (id uuid PRIMARY KEY, status text NOT NULL);
      INSERT INTO public.companies VALUES ('${CT_CO}', 'active'), ('${IND_CO}', 'archived'), ('${OTHER_CO}', 'active');
      CREATE FUNCTION public.fl_master_company_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${CT_CO}'::uuid $$;
      CREATE FUNCTION public.is_company_writable(cid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
        SELECT cid IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id = cid AND c.status = 'active') $$;
      CREATE TABLE public.company_profiles (
        id uuid PRIMARY KEY,
        company_id uuid,
        legal_name text,
        terms_text text,
        updated_at timestamptz NOT NULL DEFAULT '2026-01-01'
      );
      INSERT INTO public.company_profiles (id, company_id, legal_name, terms_text) VALUES
        ('${CT}', '${CT_CO}', 'MASSAIR CT (PTY) LTD', '${OLD.replace(/'/g, "''")}'),
        ('${IND}', '${IND_CO}', 'MASSAIR IND CC', '${OLD.replace(/'/g, "''")}'),
        ('${OTHER}', '${OTHER_CO}', 'Downline', 'own terms');
      CREATE TABLE public.profile_touches (id uuid, op text);
      CREATE FUNCTION public.note_profile_touch() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO public.profile_touches VALUES (NEW.id, TG_OP);
        RETURN NEW;
      END $$;
      CREATE TRIGGER aa_note_profile_touch BEFORE UPDATE ON public.company_profiles
        FOR EACH ROW EXECUTE FUNCTION public.note_profile_touch();
      CREATE FUNCTION public.enforce_company_writable() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE cid uuid;
      BEGIN
        cid := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
        IF TG_OP = 'UPDATE' AND OLD.company_id IS NOT NULL AND NOT public.is_company_writable(OLD.company_id) THEN
          RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
        END IF;
        IF cid IS NULL OR public.is_company_writable(cid) THEN
          RETURN COALESCE(NEW, OLD);
        END IF;
        RAISE EXCEPTION 'This company is not active. % on % is not allowed.', TG_OP, TG_TABLE_NAME USING ERRCODE = '42501';
      END $$;
      CREATE TRIGGER zz_dormant_company_write BEFORE INSERT OR UPDATE OR DELETE ON public.company_profiles
        FOR EACH ROW EXECUTE FUNCTION public.enforce_company_writable();
      CREATE FUNCTION public.fl_profiles_after() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.company_id = public.fl_master_company_id() THEN
          UPDATE public.company_profiles SET updated_at = updated_at WHERE company_id IS DISTINCT FROM NEW.company_id;
        END IF;
        RETURN NULL;
      END $$;
      CREATE TRIGGER zz_fl_profiles_after AFTER UPDATE OF terms_text, legal_name ON public.company_profiles
        FOR EACH ROW EXECUTE FUNCTION public.fl_profiles_after();
    `);

    await expect(
      db.exec(`UPDATE public.company_profiles SET legal_name = legal_name WHERE id = '${CT}'`),
    ).rejects.toThrow(/not active/);

    const before = await db.query<{ id: string; terms_text: string; updated_at: string }>(
      "SELECT id, terms_text, updated_at::text FROM public.company_profiles ORDER BY id",
    );
    expect(before.rows.find((r) => r.id === IND)?.terms_text).toContain("One year on all moving parts");

    await db.exec("DELETE FROM public.profile_touches");
    await db.exec(migration);

    const after = await db.query<{ id: string; terms_text: string; updated_at: string }>(
      "SELECT id, terms_text, updated_at::text FROM public.company_profiles ORDER BY id",
    );
    const ct = after.rows.find((r) => r.id === CT);
    const ind = after.rows.find((r) => r.id === IND);
    const other = after.rows.find((r) => r.id === OTHER);
    expect(ct?.terms_text).toContain(NEW);
    expect(ct?.terms_text).toContain("BANKING DETAILS: FNB");
    expect(ct?.terms_text).toContain("TERMS OF PAYMENT: on completion.");
    expect(ct?.terms_text).not.toContain("One year on all moving parts");
    expect(ind?.terms_text).toBe(before.rows.find((r) => r.id === IND)?.terms_text);
    expect(ind?.updated_at).toBe(before.rows.find((r) => r.id === IND)?.updated_at);
    expect(other?.terms_text).toBe("own terms");

    const touches = await db.query<{ id: string }>("SELECT id FROM public.profile_touches");
    const touched = touches.rows.map((r) => r.id);
    expect(touched).toContain(CT);
    expect(touched).toContain(OTHER);
    expect(touched).not.toContain(IND);

    const fn = await db.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE proname = 'enforce_company_writable'",
    );
    expect(fn.rows[0]?.prosrc).toContain("This company is not active");
    const prop = await db.query<{ prosrc: string }>(
      "SELECT prosrc FROM pg_proc WHERE proname = 'fl_profiles_after'",
    );
    expect(prop.rows[0]?.prosrc).toContain("is_company_writable");
  });
});
