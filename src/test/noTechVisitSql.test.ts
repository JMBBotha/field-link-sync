import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261117120000_service_visit_technician.sql"), "utf8");

function grab(name: string) {
  const start = sql.indexOf(`FUNCTION public.${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  return sql.slice(start, sql.indexOf("$function$;", start) > -1 ? sql.indexOf("$function$;", start) : sql.indexOf("$$;", start));
}

describe("service visit technician migration", () => {
  it("does not copy a non-technician onto agent_id", () => {
    const sync = grab("sync_lead_schedule()");
    expect(sync).toContain("public._visit_tech_id");
    expect(sql).toContain("WHEN public._company_tech_ok(p_person, p_company) THEN p_person");
    expect(sql).toContain("ELSE NULL");
    expect(sql).not.toContain("e2c04758-795d-4bf2-9bae-6ed77672ca88");
    expect(sql).not.toMatch(/UPDATE\s+public\.invoices/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.payments/i);
  });

  it("rejects a named person who is not a company technician", () => {
    expect(grab("set_booking_visits")).toContain("needs a technician in this company");
    expect(grab("set_booking_visits")).toContain("public._company_tech_ok");
    expect(grab("schedule_job_days")).toContain("Pick a technician in this company");
    expect(grab("schedule_job_days")).toContain("public._company_tech_ok");
    expect(grab("set_job_visits")).toContain("public._company_tech_ok");
  });

  it("keeps alerts unique per visit, level and person", () => {
    expect(sql).toContain("UNIQUE (schedule_id, level, user_id)");
    expect(sql).toContain("ON CONFLICT (schedule_id, level, user_id) DO NOTHING");
    expect(sql).toContain("fl_service_no_tech_mark_read");
    expect(sql).toContain("'h48'");
    expect(sql).toContain("'h24'");
    expect(sql).toContain("service-no-tech-reminder");
  });
});
