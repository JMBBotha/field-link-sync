import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildCallBellBody, callKind } from "../../supabase/functions/_shared/callBellSummary";

describe("call bell summary (Johan 14:03)", () => {
  const base = { callerName: "TEST Caller", callerPhone: "+27000000000", isExistingClient: true, category: "Service Request", serviceType: null, urgency: "standard", area: "2 Thompson Street, Strand", summary: "The user called to reschedule their technical service appointment. The AI moved it to Tuesday." };
  it("2-4 short lines, no transcript", () => {
    const b = buildCallBellBody(base);
    const lines = b.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("TEST Caller · +27000000000 · Service · Existing client");
    expect(lines[1]).toBe("Wants: Reschedule their technical service appointment.");
    expect(lines[2]).toBe("Area: 2 Thompson Street, Strand · Urgency: standard");
    expect(lines[3]).toBe("Next: Confirm the booking with the customer");
    expect(b.length).toBeLessThan(320);
  });
  it("sales vs service, missing summary, long summary capped", () => {
    expect(callKind({ category: "New Quote", serviceType: null, summary: null })).toBe("Sales");
    expect(buildCallBellBody({ ...base, summary: null, area: null })).toContain("Wants: summary pending (see transcript on the lead)");
    const long = buildCallBellBody({ ...base, summary: "x".repeat(600) }).split("\n")[1];
    expect(long.length).toBeLessThanOrEqual(147);
    expect(buildCallBellBody({ ...base, category: "New Quote", summary: "Caller wants a quote for two new units." }).split("\n")[3]).toBe("Next: Call back with a quote");
  });
  it("webhook uses it; bell shows 4 lines + View transcript", () => {
    const v = readFileSync("supabase/functions/vapi-server-event/index.ts", "utf8");
    expect(v).toContain("const body = buildCallBellBody(");
    expect(v).not.toMatch(/params\.summary\.slice\(0, 180\)/);
    const n = readFileSync("src/components/notifications/NotificationsList.tsx", "utf8");
    expect(n).toContain('whitespace-pre-line line-clamp-4');
    expect(n).toContain('data-testid="view-transcript"');
  });
});
