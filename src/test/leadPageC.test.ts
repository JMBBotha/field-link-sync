import { describe, it, expect } from "vitest";
import { summaryBullets } from "@/lib/callSummary";
import { leadStageC, callOutTitle } from "@/components/leads/LeadPageC";

describe("lead page C helpers", () => {
  it("splits the call summary into bullets, never the transcript", () => {
    expect(summaryBullets({ call_summary: "Wants a quote for the main bedroom. About 5 x 4 m · same outside wall" })).toEqual(["Wants a quote for the main bedroom.", "About 5 x 4 m", "same outside wall"]);
    const b = summaryBullets({ notes: "Source: grok\nTranscript:\nUser: I need a quote for my lounge please\nAI: Sure" });
    expect(b.join(" ")).not.toMatch(/AI:|User:/);
  });
  it("stage follows the flow", () => {
    expect(leadStageC({ status: "pending" })).toBe(0);
    expect(leadStageC({ status: "pending", assigned_agent_id: "x" })).toBe(1);
    expect(leadStageC({ status: "claimed" }, { quoteStatus: "sent" })).toBe(2);
    expect(leadStageC({ status: "claimed" }, { quoteStatus: "accepted" })).toBe(3);
    expect(leadStageC({ status: "in_progress" })).toBe(4);
    expect(leadStageC({ status: "completed" }, { invoiceStatus: "paid" })).toBe(5);
  });
  it("call-out fee comes from settings, no hardcoded amount", () => {
    expect(callOutTitle(782)).toBe("Book call-out (R782 incl VAT)");
    expect(callOutTitle(null)).toBe("Book call-out");
  });
});
