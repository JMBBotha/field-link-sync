import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { filterVisitsBooked, filterLeadsByLane, filterDepositsDue, D1_TILE_LINKS, parseLaneParam, resolveMoneyFilter } from "@/lib/drilldown";
import { buildBoardRows, filterBoardRows, FILTER_KEYS } from "@/lib/jobsBoard";
import { computeMoneySummary, invoiceMoney, matchesMoneyFilter } from "@/lib/moneySummary";

const now = new Date("2026-09-28T08:00:00Z"); // 10:00 Johannesburg
const e = (o: any) => ({ id: o.lead_id, lead_id: o.lead_id, job_id: null, agent_id: "a1", date: "2026-09-28", start_time: "09:00", customer_name: "C", customer_address: "", status: "pending", service_type: "Sales/Consultation", primary_intent: "sales", ...o });

describe("Visits booked", () => {
  const jobs = [
    { id: "j1", status: "scheduled", job_type: "quote", scheduled_for: "2026-09-28T10:00:00+02:00" },
    { id: "j2", status: "completed", job_type: "quote", scheduled_for: "2026-09-28T09:00:00+02:00" },
    { id: "j3", status: "scheduled", job_type: "install", scheduled_for: "2026-09-28T09:00:00+02:00" },
    { id: "j4", status: "scheduled", job_type: "sales", scheduled_for: "2026-09-29T09:00:00+02:00" },
    { id: "j5", status: "cancelled", job_type: "sales", scheduled_for: "2026-09-28T09:00:00+02:00" },
  ];
  const entries = [e({ lead_id: "l1" }), e({ lead_id: "l2", primary_intent: "service", service_type: "Repair" }), e({ lead_id: "l3", status: "completed" })] as any[];
  const rows = buildBoardRows(jobs, entries);
  it("counts only open sales visits today", () => {
    expect(filterVisitsBooked(rows, {}, now).map((r) => r.id).sort()).toEqual(["j1", "l1"]);
  });
  it("tile count equals the board list for the tile URL", () => {
    const p = new URLSearchParams(D1_TILE_LINKS.visitsBooked.split("?")[1]);
    const f = Object.fromEntries(FILTER_KEYS.map((k) => [k, p.get(k)]));
    expect(filterBoardRows(rows, f, {}, now).length).toBe(filterVisitsBooked(rows, {}, now).length);
  });
});

describe("Service leads", () => {
  const leads = [{ primary_intent: "service" }, { primary_intent: "sales" }, { primary_intent: null }, { primary_intent: "service" }];
  it("count equals inbox list with ?lane=service", () => {
    const lane = parseLaneParam(new URLSearchParams(D1_TILE_LINKS.serviceLeads.split("?")[1]))!;
    expect(lane).toBe("service");
    expect(filterLeadsByLane(leads, lane).length).toBe(2);
  });
});

describe("Installs awaiting deposit", () => {
  const inv = [
    { id: "i1", status: "draft", grand_total: 1000, quote_id: "q1" },
    { id: "i2", status: "sent", grand_total: 1000, quote_id: "q2" },
    { id: "i3", status: "paid", grand_total: 1000, quote_id: "q3" },
    { id: "i4", status: "sent", grand_total: 500, quote_id: null },
    { id: "i5", status: "sent", grand_total: 1000, notes: "DEPOSIT for install" },
  ];
  const pays = [{ invoice_id: "i2", amount: 200, status: "completed" }];
  it("tile count equals invoices list money=deposits_due", () => {
    const m = resolveMoneyFilter(new URLSearchParams(D1_TILE_LINKS.depositsDue.split("?")[1]))!;
    const list = inv.filter((i) => { const { paid, balance } = invoiceMoney(i, pays); return matchesMoneyFilter(i, paid, balance, m); });
    expect(filterDepositsDue(inv, pays).map((i) => i.id)).toEqual(list.map((i) => i.id));
    expect(computeMoneySummary(inv, pays).depositsDue.count).toBe(list.length);
  });
});
