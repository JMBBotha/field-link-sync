import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(path, "utf8");

describe("hang-up follow-up", () => {
  it("runs the escalation-skip and auto-read database checks", () => {
    execFileSync("node", ["supabase/tests/hangup_followup/run.mjs"], { stdio: "inherit" });
  });

  it("does not create a lead or a customer when the phone is answered", () => {
    const twilio = src("supabase/functions/twilio-inbound-call/index.ts");
    expect(twilio).not.toContain("Unknown Caller");
    expect(twilio).not.toMatch(/from\("(?:leads|customers)"\)/);
    expect(twilio).toContain("TWIML_OK");
  });

  it("files an admin follow-up from the call fields before a lead is created", () => {
    const vapi = src("supabase/functions/vapi-server-event/index.ts");
    const decide = vapi.indexOf("isBareHangup");
    const create = vapi.indexOf("receive-vapi-lead");
    expect(decide).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(decide);
    expect(vapi).toContain('outcome: "admin_followup"');
    expect(vapi).toContain("log_call_admin_followup");
    const promptAt = vapi.indexOf("Never guess or invent a name");
    const prompt = vapi.slice(promptAt, promptAt + 120);
    expect(prompt).toContain("Unknown Caller");
  });

  it("refuses a bare hang-up inside lead intake", () => {
    for (const file of ["supabase/functions/receive-vapi-lead/index.ts", "supabase/functions/ingest-lead/index.ts"]) {
      const text = src(file);
      const guard = text.indexOf('reason: "bare_hangup"');
      const insert = text.search(/from\("leads"\)[\s\S]{0,80}\.insert|from\("customers"\)[\s\S]{0,80}\.insert/);
      expect(guard).toBeGreaterThan(0);
      if (insert > 0) expect(guard).toBeLessThan(insert);
    }
  });

  it("does not delete or rewrite existing leads", () => {
    const sql = src("supabase/migrations/20261116220000_hangup_admin_followup.sql");
    expect(sql).not.toMatch(/DELETE FROM public\.leads/i);
    expect(sql).not.toMatch(/DELETE FROM public\.customers/i);
    expect(sql).toContain("lead_skips_hot_escalation");
    expect(sql).toContain("mark_lead_alerts_read");
    expect(sql).toContain("hangupSeconds");
  });
});
