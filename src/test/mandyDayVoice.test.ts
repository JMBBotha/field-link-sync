import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  applyVoiceConfirm,
  confirmQuestion,
  explainLeadWaiting,
  playbookBlock,
  techDaySentence,
  unpaidSentence,
} from "@/lib/mandy/dayVoice";
import { isSystemTool, toolAllowed } from "../../supabase/functions/_shared/mandyPolicy";
import { realtimeInstructions } from "../../supabase/functions/_shared/mandyRealtime";

describe("voice confirm before a write", () => {
  it("asks yes and only a yes runs the pending card", () => {
    expect(confirmQuestion("Move Yaseen's lead from Johan to Almari")).toBe("Move Yaseen's lead from Johan to Almari, yes?");
    expect(applyVoiceConfirm(true, "yes")).toBe("run");
    expect(applyVoiceConfirm(true, "yeah do it")).toBe("run");
    expect(applyVoiceConfirm(true, "no")).toBe("cancel");
    expect(applyVoiceConfirm(true, "what is the total")).toBe("ignore");
    expect(applyVoiceConfirm(false, "yes")).toBe("ignore");
  });
});

describe("day-to-day permissions", () => {
  it("gives writes only to roles the server RPCs allow", () => {
    expect(toolAllowed("admin", "set_owner_rep")).toBe(true);
    expect(toolAllowed("office", "set_owner_rep")).toBe(false);
    expect(toolAllowed("sales", "set_owner_rep")).toBe(false);
    expect(toolAllowed("sales", "assign_lead_technician")).toBe(true);
    expect(toolAllowed("sales", "cancel_visit")).toBe(true);
    expect(toolAllowed("tech", "assign_lead_technician")).toBe(false);
    expect(toolAllowed("tech", "cancel_visit")).toBe(false);
    expect(toolAllowed("tech", "tech_day")).toBe(true);
    expect(toolAllowed("tech", "report_problem")).toBe(true);
    expect(toolAllowed("viewer", "unpaid_for")).toBe(false);
  });

  it("still refuses company edits for every role", () => {
    for (const tier of ["admin", "office", "sales", "tech", "viewer"] as const) {
      expect(toolAllowed(tier, "update_company_settings")).toBe(false);
      expect(isSystemTool("edit_company_details")).toBe(true);
      expect(toolAllowed(tier, "parent_company_report")).toBe(false);
    }
  });
});

describe("look into it", () => {
  it("explains a lead that has not been offered", () => {
    expect(explainLeadWaiting({ name: "Yaseen", accepted: false, assigned: false, offerCount: 0, pendingOffers: 0, flag: "needs_time" }))
      .toMatch(/appointment time/);
    expect(explainLeadWaiting({ name: "Yaseen", accepted: false, assigned: false, offerCount: 0, pendingOffers: 2, flag: null }))
      .toMatch(/5 minutes/);
  });

  it("sums unpaid invoices and lists today's materials without prices", () => {
    expect(unpaidSentence("Yaseen", [{ label: "INV-1", amount: 100, status: "sent" }, { label: "INV-2", amount: 50, status: "overdue" }], (n) => `R${n}`))
      .toMatch(/R150/);
    expect(techDaySentence("Almari", [{ title: "Service", when: "09:00" }], [{ name: "R410a", qty: "2" }])).toMatch(/2 R410a/);
    expect(techDaySentence("Almari", [], [])).toMatch(/no jobs today/);
  });
});

describe("playbook and hand-off", () => {
  it("trims the playbook and the session tells her not to guess", () => {
    const block = playbookBlock([
      { title: "Call-out", when_to_use: "fee", answer: "R680 excl. VAT per visit, never deducted." },
      { title: "Long", when_to_use: "x", answer: "x".repeat(2000) },
    ], 80);
    expect(block).toContain("R680");
    expect(block.length).toBeLessThanOrEqual(80);
    const instructions = realtimeInstructions({ botName: "Mandy", companyName: "Massair", parent: false, tier: "sales", context: {}, playbook: block });
    expect(instructions).toContain("I can't do that yet");
    expect(instructions).toContain("R680");
  });

  it("seeds the rules and stores hand-offs without a required webhook", () => {
    const sql = readFileSync("supabase/migrations/20261111193000_mandy_handoff_playbook.sql", "utf8");
    expect(sql).toContain("mandy_handoffs");
    expect(sql).toContain("mandy_playbook");
    expect(sql).toContain("R680");
    expect(sql).toContain("5 minutes");
    expect(sql).toContain("10 minutes");
    expect(sql).toContain("sales_may_book_tech");
    expect(sql).toContain("cancel_booking_visit");
    expect(sql).toMatch(/user_id = auth.uid\(\)/);
    const fn = readFileSync("supabase/functions/mandy-handoff/index.ts", "utf8");
    expect(fn).toContain("MANDY_HANDOFF_WEBHOOK_URL");
    expect(fn).toContain("mandy_handoffs");
    expect(fn).not.toMatch(/https:\/\/hooks\./);
  });
});
