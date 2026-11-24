import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { handoffFingerprint } from "../../supabase/functions/_shared/mandyHandoffWebhook";

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const COMPANY = "11111111-1111-4111-8111-111111111111";

async function db() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE TABLE public.mandy_handoffs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id uuid,
      user_id uuid,
      role text,
      page text,
      entity_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
      transcript text,
      summary text NOT NULL,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await database.exec(readFileSync("supabase/migrations/20261124120000_mandy_handoff_webhook.sql", "utf8"));
  return database;
}

function savedOf(value: unknown): { id: string; deduped: boolean } {
  const row = typeof value === "string" ? JSON.parse(value) : value;
  return row as { id: string; deduped: boolean };
}

async function save(database: PGlite, summary: string, user = USER, company: string | null = COMPANY) {
  const result = await database.query<{ saved: unknown }>(
    `SELECT public.save_mandy_handoff($1::uuid, $2::uuid, 'sales', '/admin', '{}'::jsonb, 'User: hello', $3) AS saved`,
    [company, user, summary],
  );
  return savedOf(result.rows[0].saved);
}

describe("mandy hand-off dedupe in Postgres", () => {
  it("uses the same fingerprint as the webhook builder and collapses a repeat inside 5 seconds", async () => {
    const database = await db();
    const fp = await database.query<{ fp: string }>(
      `SELECT public.mandy_handoff_fingerprint('  Add a button. ') AS fp`,
    );
    expect(fp.rows[0].fp).toBe("add a button");
    expect(fp.rows[0].fp).toBe(handoffFingerprint("  Add a button. "));
    expect(handoffFingerprint("ADD   a button")).toBe(fp.rows[0].fp);

    const first = await save(database, "  Add a button. ");
    const second = await save(database, "ADD   a button");
    expect(second.id).toBe(first.id);
    expect(second.deduped).toBe(true);
    expect(first.deduped).toBe(false);

    const otherUser = await save(database, "Add a button", OTHER);
    expect(otherUser.id).not.toBe(first.id);
    expect(otherUser.deduped).toBe(false);

    await database.query(`UPDATE public.mandy_handoffs SET created_at = now() - interval '6 seconds' WHERE id = $1`, [first.id]);
    const later = await save(database, "Add a button.");
    expect(later.deduped).toBe(false);
    expect(later.id).not.toBe(first.id);

    await database.exec(`
      INSERT INTO public.mandy_handoffs (company_id, user_id, summary)
      VALUES ('${COMPANY}', '${USER}', 'Add a button');
    `);
    const rows = await database.query<{ n: string; status: string; attempts: number }>(`
      SELECT count(*)::text AS n,
             bool_and(webhook_status = 'pending')::text AS status,
             bool_and(webhook_attempts = 0)::text AS attempts
      FROM public.mandy_handoffs
    `);
    expect(rows.rows[0].n).toBe("3");
    expect(rows.rows[0].status).toBe("true");
    expect(rows.rows[0].attempts).toBe("true");

    const stored = await database.query<{ summary: string; dedupe_key: string }>(
      `SELECT summary, dedupe_key FROM public.mandy_handoffs WHERE id = $1`,
      [first.id],
    );
    expect(stored.rows[0].summary).toBe("Add a button.");
    expect(stored.rows[0].dedupe_key).toBe("add a button");
  });
});
