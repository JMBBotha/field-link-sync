import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// 3 Nov 2026: jobs created before the lead was dispatched showed "No tech yet".
const dir = resolve(__dirname, "../../supabase/migrations");
const up = readFileSync(resolve(dir, "20261103140000_lead_tech_to_job.sql"), "utf8");
const down = readFileSync(resolve(dir, "../manual/20261103140000_lead_tech_to_job_ROLLBACK.sql"), "utf8");

describe("lead tech -> job copy migration", () => {
  it("fires after the lead's tech changes, last among lead triggers", () => {
    expect(up).toMatch(/CREATE TRIGGER trg_zz_lead_tech_to_job\s+AFTER UPDATE OF assigned_agent_id ON public\.leads/);
  });
  it("only touches open jobs with no active tech", () => {
    expect(up).toMatch(/NOT IN \('completed', 'cancelled', 'canceled', 'invoiced'\)/);
    expect(up).toMatch(/NOT EXISTS \(SELECT 1 FROM public\.assignments a/);
  });
  it("copies tech, links unlinked lead slots and fills an empty job time", () => {
    expect(up).toMatch(/INSERT INTO public\.assignments/);
    expect(up).toMatch(/UPDATE public\.job_schedules SET job_id = j\.id[\s\S]*job_id IS NULL/);
    expect(up).toMatch(/j\.scheduled_for IS NULL AND NEW\.scheduled_date IS NOT NULL/);
  });
  it("skips the duplicate assignment and schedule notices, and restores the flags", () => {
    expect(up).toMatch(/TG_OP = 'INSERT' AND current_setting\('app\.lead_tech_to_job', true\) = 'on' THEN RETURN NEW/);
    expect(up).toMatch(/set_config\('app\.job_days_writing', '1', true\)/);
    expect(up).toMatch(/set_config\('app\.job_days_writing', COALESCE\(v_prev_days, ''\), true\)/);
  });
  it("rollback drops the trigger and restores the original notice function", () => {
    expect(down).toMatch(/DROP TRIGGER IF EXISTS trg_zz_lead_tech_to_job/);
    expect(down).toMatch(/DROP FUNCTION IF EXISTS public\.copy_lead_tech_to_job/);
    expect(down).toMatch(/CREATE OR REPLACE FUNCTION public\.notify_assignment_status_change/);
    expect(down).not.toMatch(/app\.lead_tech_to_job/);
  });
});
