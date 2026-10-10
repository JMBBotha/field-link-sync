import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { bucketOf, byJob, summarizeMine, type MyEarningRow } from "@/lib/myEarnings";
const src = (p: string) => readFileSync(p, "utf8");
const row = (o: Partial<MyEarningRow>): MyEarningRow => ({ row_key: Math.random().toString(), job_id: "j1", job_name: "TEST job", job_date: "2026-10-10", hours: 3.5, kind: "completion", status: "payable", amount: 100, release_after: null, paid_at: null, ...o });

describe("My earnings (Johan 09:27)", () => {
  it("buckets: pending / paid / retention held", () => {
    expect(bucketOf({ kind: "completion", status: "payable" })).toBe("pending");
    expect(bucketOf({ kind: "completion", status: "accrued" })).toBe("pending");
    expect(bucketOf({ kind: "completion", status: "paid" })).toBe("paid");
    expect(bucketOf({ kind: "retention", status: "held" })).toBe("held");
    expect(bucketOf({ kind: "retention", status: "released" })).toBe("paid");
  });
  it("week/month totals in SAST + per-job grouping", () => {
    const now = new Date("2026-10-10T08:00:00Z"); // Sat 10 Oct
    const rows = [row({ amount: 1190 }), row({ kind: "retention", status: "held", amount: 238 }),
      row({ job_id: "j2", job_date: "2026-10-05", status: "paid", amount: 500 }), row({ job_id: "j3", job_date: "2026-09-20", status: "paid", amount: 70 })];
    const s = summarizeMine(rows, now);
    expect(s).toMatchObject({ week: 1928, month: 1928, pending: 1190, paid: 570, held: 238 });
    const jobs = byJob(rows);
    expect(jobs[0]).toMatchObject({ key: "j1", total: 1428, hours: 3.5 });
    expect(jobs).toHaveLength(3);
  });
  it("reachable: /field card (phone + desktop), desktop header link, field-shell desktop nav; techs get the own view", () => {
    const fa = src("src/pages/FieldAgent.tsx");
    expect((fa.match(/<MyEarningsPeek/g) || []).length).toBe(2);
    expect(fa).toContain('data-testid="hdr-my-earnings"');
    expect(src("src/components/field/FieldShell.tsx")).toContain('to="/field/earnings"');
    const page = src("src/pages/FieldEarningsPage.tsx");
    expect(page).toMatch(/isFieldAgent && !isAdmin && !isDispatcher\) \{\s*return <FieldShell title="My earnings"><MyEarningsView \/>/);
  });
  it("RPC is own-rows-only and never returns percent, labour base, quote or invoice figures", () => {
    const m = src("supabase/migrations/20261010093000_my_tech_earnings.sql");
    expect(m).toMatch(/RETURNS TABLE\(row_key text, job_id uuid, job_name text, job_date date, hours numeric, kind text, status text, amount numeric, release_after date, paid_at date\)/);
    expect(m).toContain("WHERE l.tech_id = v_uid");
    expect(m).toContain("a.profile_id = v_uid");
    expect(m).not.toMatch(/invoices|labour_base,|grand_total|quote_number/);
    expect(src("src/components/field/MyEarnings.tsx")).not.toMatch(/percent|quote_number|invoice/i);
  });
});
