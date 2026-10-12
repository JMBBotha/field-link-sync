import { describe, expect, it } from "vitest";
import { dupHeadline, flagsByLead, pickPrimary, whenText, type ClientBooking, type DupFlag } from "@/lib/sameClient";

const b = (o: Partial<ClientBooking>): ClientBooking => ({ lead_id: "x", customer_name: "Johan Botha", status: "pending", scheduled_date: null,
  scheduled_time: null, tech_id: null, tech_name: null, booked: false, match: "strong", ...o });

describe("same-client duplicates", () => {
  it("prefers the booked strong match", () => {
    const rows = [b({ lead_id: "soft", match: "soft", booked: true }), b({ lead_id: "open" }), b({ lead_id: "booked", booked: true })];
    expect(pickPrimary(rows)?.lead_id).toBe("booked");
    expect(pickPrimary([])).toBeNull();
  });
  it("formats the warning", () => {
    expect(whenText("2026-10-13", "10:00:00")).toMatch(/13 Oct 10:00/);
    expect(dupHeadline(b({ booked: true, scheduled_date: "2026-10-13", scheduled_time: "10:00:00", tech_name: "Thabo Mokoena" })))
      .toMatch(/^This client already has a booking on .*13 Oct 10:00 with Thabo Mokoena$/);
    expect(dupHeadline(b({}))).toMatch(/open lead \(no date yet\)/);
    expect(dupHeadline(b({ match: "soft" }))).toMatch(/may be the same client/);
  });
  it("keeps one flag per lead, booked strong first", () => {
    const f = (o: Partial<DupFlag>): DupFlag => ({ lead_id: "a", other_lead_id: "o", other_status: "pending", other_date: null, other_time: null,
      other_tech: null, other_booked: false, match: "strong", n_others: 2, ...o });
    const m = flagsByLead([f({ other_lead_id: "o1", match: "soft" }), f({ other_lead_id: "o2", other_booked: true }), f({ lead_id: "b" })]);
    expect(m.get("a")?.other_lead_id).toBe("o2");
    expect(m.size).toBe(2);
  });
});
