import { describe, it, expect } from "vitest";
import { buildHeartbeat, ecgPoints, toLimits } from "./salesHeartbeat";
const NOW = Date.parse("2026-10-20T09:00:00Z"); // Tue 11:00 SAST
const ago = (m: number) => new Date(NOW - m * 60_000).toISOString();
describe("salesHeartbeat", () => {
  it("stages, hot lead, stall and next step", () => {
    const hb = buildHeartbeat({ now: NOW,
      leads: [{ id: "l1", customer_name: "Thandi", created_at: ago(8), status: "pending" }, { id: "s", primary_intent: "service", created_at: ago(8), status: "pending" }],
      quotes: [{ id: "q1", status: "sent", total: 38400, created_at: ago(9 * 1440), sent_at: ago(8 * 1440), viewed_at: ago(4 * 1440), customer_name: "van Wyk" },
               { id: "q2", status: "accepted", total: 26000, created_at: ago(5000), accepted_at: ago(3000), customer_name: "Naidoo" }],
      invoices: [{ quote_id: "q2", status: "paid", notes: "DEPOSIT 50%", grand_total: 13000, paid_date: ago(60) }], jobs: [] });
    expect(hb.hot.map((l) => l.id)).toEqual(["l1"]);
    expect(hb.stages.find((s) => s.key === "new")!.tone).toBe("red");
    expect(hb.stages.find((s) => s.key === "deposit")!.count).toBe(1);
    expect(hb.next!.next.label).toBe("Call now");
    expect(hb.stalled.map((i) => i.id)).toContain("q1");
    expect(hb.beats.some((b) => b.label === "Deposit received")).toBe(true);
    expect(hb.flatline).toBe(false);
  });
  it("flatlines when items wait and nothing happened", () => {
    const hb = buildHeartbeat({ now: NOW, leads: [{ id: "l1", created_at: ago(26 * 60), status: "pending" }], quotes: [], invoices: [], jobs: [] });
    expect(hb.flatline).toBe(true);
    expect(ecgPoints(hb.beats, { now: NOW, width: 100, height: 40, strength: 1, flatline: true }).split(" ")).toHaveLength(2);
  });
  it("pulse counts answered within limit", () => {
    const hb = buildHeartbeat({ now: NOW, quotes: [], invoices: [], jobs: [], leads: [
      { id: "a", created_at: ago(120), first_contact_at: ago(117), status: "contacted" }, { id: "b", created_at: ago(120), first_contact_at: ago(60), status: "contacted" }] });
    expect(hb.pulse).toEqual({ pct: 50, answered: 1, total: 2 });
  });
  it("limits fall back to defaults", () => { expect(toLimits({ leadRepMin: 10, bad: 1, sentDays: -1 }).leadRepMin).toBe(10); expect(toLimits(null).sentDays).toBe(2); });
});
