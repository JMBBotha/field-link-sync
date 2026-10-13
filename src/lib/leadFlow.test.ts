import { describe, it, expect } from "vitest";
import { deriveFlow, summarise, nextUp, urgencyFor } from "./leadFlow";
import { inboxTone } from "./leadClock";

const NOW = Date.parse("2026-10-13T10:00:00+02:00"); // Tue 10:00 SAST, business hours
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const empty = { leads: [], quotes: [], invoices: [], jobs: [], payments: [] };

describe("leadFlow", () => {
  it("website lead: blue <3m, yellow 3–5m, red >5m", () => {
    const f = (m: number) => deriveFlow({ ...empty, leads: [{ id: "a", status: "pending", source: "website_form", created_at: iso(m) }] }, NOW)[0];
    expect(f(1).urgency).toBe("blue"); expect(f(4).urgency).toBe("yellow"); expect(f(6).urgency).toBe("red");
    expect(f(6).stage).toBe("NEW"); expect(f(6).label).toMatch(/OVERDUE/);
  });
  it("phone lead: confirm within 30 (amber at 20)", () => {
    const f = (m: number) => deriveFlow({ ...empty, leads: [{ id: "a", status: "pending", source: "vapi_call", created_at: iso(m) }] }, NOW)[0];
    expect(f(10).urgency).toBe("blue"); expect(f(25).urgency).toBe("yellow"); expect(f(31).urgency).toBe("red");
    expect(f(10).action).toBe("Confirm booking");
  });
  it("3 tries with no contact parks as No answer", () => {
    const [i] = deriveFlow({ ...empty, leads: [{ id: "a", status: "pending", created_at: iso(90), contact_attempts: 3 }] }, NOW);
    expect(i.parked).toBe("no_answer"); expect(summarise([i]).parked.no_answer).toBe(1);
  });
  it("accepted quote with no invoice → ACCEPTED; deposit always required", () => {
    const d = { ...empty, leads: [{ id: "l", status: "accepted", first_contact_at: iso(3000), created_at: iso(4000) }],
      quotes: [{ id: "q", lead_id: "l", status: "accepted", accepted_at: iso(60), created_at: iso(2000) }] };
    expect(deriveFlow(d, NOW)[0].stage).toBe("ACCEPTED");
    const d2 = { ...d, invoices: [{ id: "i", quote_id: "q", status: "draft", sent_at: iso(30), grand_total: 1000, deposit_amount: 0 }] };
    expect(deriveFlow(d2, NOW)[0]).toMatchObject({ stage: "DEPOSIT", action: "Chase deposit", urgency: "grey" });
  });
  it("deposit paid + awaiting stock job → parked waiting on supplier; paid in full → PAID", () => {
    const base = { ...empty, quotes: [{ id: "q", status: "accepted", accepted_at: iso(3000), created_at: iso(4000) }],
      invoices: [{ id: "i", quote_id: "q", status: "draft", sent_at: iso(2000), grand_total: 1000, deposit_amount: 500 }],
      payments: [{ invoice_id: "i", amount: 500, status: "paid", created_at: iso(1000) }] };
    const w = deriveFlow({ ...base, jobs: [{ id: "j", quote_id: "q", status: "scheduled", scheduled_for: null, awaiting_stock: true }] }, NOW)[0];
    expect(w.parked).toBe("waiting_stock");
    const p = deriveFlow({ ...base, payments: [...base.payments, { invoice_id: "i", amount: 500, status: "paid" }],
      jobs: [{ id: "j", quote_id: "q", status: "completed", scheduled_for: iso(500), completed_at: iso(400) }] }, NOW)[0];
    expect(p).toMatchObject({ stage: "PAID", done: true });
  });
  it("next up sorts red before yellow before blue; stage circle shows the worst", () => {
    const d = { ...empty, leads: [
      { id: "b", status: "pending", source: "website_form", created_at: iso(1) },
      { id: "r", status: "pending", source: "website_form", created_at: iso(9) },
      { id: "y", status: "pending", source: "website_form", created_at: iso(4) }] };
    const items = deriveFlow(d, NOW);
    expect(nextUp(items).map((i) => i.key)).toEqual(["lead:r", "lead:y", "lead:b"]);
    expect(summarise(items).stages[0]).toMatchObject({ stage: "NEW", count: 3, urgency: "red", red: 1, yellow: 1 });
  });
  it("urgencyFor waiting → grey until amber", () => {
    expect(urgencyFor(0, 100, 50, true).urgency).toBe("grey");
    expect(urgencyFor(60, 100, 50, true).urgency).toBe("yellow");
  });
  it("inboxTone takes the worst uncontacted lead, null when none", () => {
    expect(inboxTone([], NOW)).toBeNull();
    const r = inboxTone([{ status: "pending", created_at: iso(1) }, { status: "pending", created_at: iso(7) }], NOW)!;
    expect(r.tone).toBe("red"); expect(Math.round(r.oldestMs / 60000)).toBe(7);
    expect(inboxTone([{ status: "pending", created_at: iso(1), first_contact_at: iso(0) }], NOW)).toBeNull();
  });
});
