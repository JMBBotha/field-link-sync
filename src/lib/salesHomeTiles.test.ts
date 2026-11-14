import { describe, expect, it } from "vitest";
import type { TrackerRow } from "@/lib/salesTracker";
import { commissionThisMonth, draftsToSend, followUpsDue, jobsBeingDoneToday, johannesburgMonth, salesHomeTiles } from "@/lib/salesHomeTiles";
import { SALES_HOME_ROUTES } from "@/lib/roleHome";

const row = (p: Partial<TrackerRow>): TrackerRow => ({
  grp: "pipeline", frozen: false, snapshot_id: null, quote_id: "q", quote_number: "Q-1", rep_id: "rep", rep_name: "Demo",
  percent: 8, items_sell_ex_vat: 1000, items_cost: 600, items_profit: 400, commission: 100, unknown_cost_count: 0,
  accepted_at: "2026-11-02T08:00:00+02:00", earned_at: null, invoice_paid_date: null, paid_at: null, ...p,
});

const NOW = new Date("2026-11-12T08:00:00+02:00");

describe("sales home figures", () => {
  it("counts commission earned in this Johannesburg month, and pending from the pipeline", () => {
    expect(johannesburgMonth(NOW)).toBe("2026-11");
    const figures = commissionThisMonth([
      row({ quote_id: "earned-now", grp: "earned", commission: 1840.5, earned_at: "2026-11-04T10:00:00+02:00" }),
      row({ quote_id: "paid-now", grp: "paid_out", commission: 100, earned_at: "2026-11-01T10:00:00+02:00", paid_at: "2026-11-10" }),
      row({ quote_id: "earned-last", grp: "earned", commission: 900, earned_at: "2026-10-20T10:00:00+02:00" }),
      row({ quote_id: "live-paid", grp: "earned", commission: 50, earned_at: null, invoice_paid_date: "2026-11-08" }),
      row({ quote_id: "unknown-when", grp: "earned", commission: 77, earned_at: null, invoice_paid_date: null }),
      row({ quote_id: "pipe", grp: "pipeline", commission: 620 }),
      row({ quote_id: "pipe-2", grp: "pipeline", commission: 10.25 }),
    ], NOW);
    expect(figures.earned).toBe(1990.5);
    expect(figures.pending).toBe(630.25);
  });

  it("counts follow-up and cold steps only", () => {
    expect(followUpsDue([
      { rule: "followup" }, { rule: "cold" }, { rule: "new_lead" }, { rule: "no_quote" }, { rule: "deposit_invoice" },
    ])).toBe(2);
  });

  it("counts only this salesperson's unsent drafts", () => {
    const quotes = [
      { status: "draft", sales_engineer_id: "me" },
      { status: "Draft", sales_engineer_id: "me" },
      { status: "sent", sales_engineer_id: "me" },
      { status: "draft", sales_engineer_id: "other" },
    ];
    expect(draftsToSend(quotes, "me")).toBe(2);
    expect(draftsToSend(quotes, null)).toBe(0);
  });

  it("counts today's visits and in-progress jobs once per lead", () => {
    expect(jobsBeingDoneToday(
      [{ lead_id: "L1" }, { lead_id: "L2" }],
      [
        { job_id: "J1", lead_id: "L1", scheduled_date: "2026-11-12", stage: "assigned" },
        { job_id: "J2", lead_id: "L9", scheduled_date: "2026-11-12", stage: "on_site" },
        { job_id: "J3", lead_id: "L8", scheduled_date: "2026-11-13", stage: "en_route" },
        { job_id: "J4", lead_id: "L7", scheduled_date: "2026-11-12", stage: "completed" },
        { job_id: "J5", lead_id: "L6", scheduled_date: "2026-11-20", stage: "assigned" },
      ],
      "2026-11-12",
    )).toBe(4);
  });

  it("puts commission first and keeps the existing list routes", () => {
    const tiles = salesHomeTiles({ earned: 1840, pending: 620, followUps: 3, jobsToday: 2, drafts: 4 });
    expect(tiles.map((t) => t.key)).toEqual(["commission", "followups", "today", "drafts"]);
    expect(tiles[0].lead).toBe(true);
    expect(tiles[0].value).toBe("R 1 840,00");
    expect(tiles[0].hint).toBe("R 620,00 pending");
    expect(tiles[0].href).toBe(SALES_HOME_ROUTES.commission);
    expect(tiles[1].href).toBe("/admin/quotes?status=sent,viewed&type=estimate");
    expect(tiles[2].href).toBe("/admin/schedule");
    expect(tiles[3].href).toBe("/admin/quotes?status=draft");
    expect(salesHomeTiles({ earned: null, pending: null, followUps: null, jobsToday: null, drafts: null }).map((t) => t.value)).toEqual(["…", "…", "…", "…"]);
  });
});
