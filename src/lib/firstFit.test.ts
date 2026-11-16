import { describe, expect, it } from "vitest";
import { STATUS_META } from "@/lib/projectTracker";
import { r0Quote } from "@/lib/zeroPriceGuard";
import { housePhotoStoragePath, jobPhotoStoragePath } from "@/lib/jobPhotoPath";
import {
  alreadyInvoicedOn,
  balanceAmount,
  coversErfLine,
  depositAmount,
  firstFitReady,
  issuePlan,
  normalizeUnitSize,
  parsePipeMetres,
  quoteTotals,
  snapOnOrAfter,
} from "@/lib/firstFit";

describe("first fit rules", () => {
  it("keeps the labour chip label and uses a different name for the new status", () => {
    expect(STATUS_META.in_progress.label).toBe("First fit done");
  });

  it("normalises the size pick-list and the pipe metres", () => {
    expect(normalizeUnitSize("12k")).toBe("12K");
    expect(normalizeUnitSize("9000")).toBe("9K");
    expect(normalizeUnitSize("18 BTU")).toBe("18K");
    expect(normalizeUnitSize("10kW")).toBeNull();
    expect(parsePipeMetres("6,5m")).toBe(6.5);
    expect(parsePipeMetres("0")).toBeNull();
    expect(parsePipeMetres("201")).toBeNull();
  });

  it("snaps to the next 15th on or after the date, and adds 60 days for the balance", () => {
    expect(snapOnOrAfter("2026-10-16", 15)).toBe("2026-11-15");
    expect(snapOnOrAfter("2026-11-15", 15)).toBe("2026-11-15");
    const plan = issuePlan({
      completeOn: "2026-09-01",
      today: "2026-11-16",
      snapDay: 15,
      depositDays: 45,
      balanceDays: 60,
      prepareDays: 7,
    });
    expect(plan.depositOn).toBe("2026-11-15");
    expect(plan.depositState).toBe("overdue");
    expect(plan.prepareDeposit).toBe(true);
    expect(plan.balanceOn).toBe("2027-01-15");
    expect(plan.balanceEstimated).toBe(true);
    expect(plan.balanceState).toBe("estimated");
    expect(plan.prepareBalance).toBe(false);
    const issued = issuePlan({
      completeOn: "2026-09-01",
      today: "2026-11-16",
      snapDay: 15,
      depositIssuedOn: "2026-09-01",
    });
    expect(issued.balanceEstimated).toBe(false);
    expect(issued.balanceOn).toBe("2026-11-15");
    expect(issued.balanceState).toBe("overdue");
    expect(issued.prepareBalance).toBe(true);
  });

  it("gates the tap on a complete point for every listed area, and allows a manual point when the list is empty", () => {
    expect(firstFitReady([], []).ok).toBe(false);
    expect(firstFitReady([], [{ area: "Lounge", unitSize: "12K", pipeM: 6.5 }]).ok).toBe(true);
    const missing = firstFitReady(
      [{ area: "Lounge" }, { area: "Kitchen" }],
      [{ area: "Lounge", unitSize: "12K", pipeM: 4 }],
    );
    expect(missing.ok).toBe(false);
    expect(missing.reason).toMatch(/Kitchen/);
  });

  it("splits the quote 50/50 with one discount and leaves piping at R0 blocked on send", () => {
    const totals = quoteTotals(8000, 5);
    expect(totals.total).toBe(8740);
    expect(totals.subtotal).toBe(8000);
    const deposit = depositAmount(totals.total, 0);
    const balance = balanceAmount(totals.total, deposit);
    expect(deposit + balance).toBe(totals.total);
    expect(deposit).toBe(4370);
    expect(r0Quote([{ item_name: "Piping — Lounge 12K (price needed)", unit_price: 0, quantity: 6.5, metadata: { price_needed: true } }])).toMatch(/Piping/);
  });

  it("names a covered house and the invoice line without splitting the invoice", () => {
    expect(alreadyInvoicedOn("0010021")).toBe("Already invoiced on 0010021");
    expect(coversErfLine(["17529", "17528", "17528"])).toBe("Covers ERF 17528, ERF 17529");
    expect(coversErfLine(["ERF 17533", "17534"])).toBe("Covers ERF 17533, ERF 17534");
  });

  it("prefixes new job photos with the company and leaves a legacy path when the company is unknown", () => {
    expect(jobPhotoStoragePath("co", "lead", "a.jpg")).toBe("co/lead/a.jpg");
    expect(jobPhotoStoragePath(null, "lead", "a.jpg")).toBe("lead/a.jpg");
    expect(housePhotoStoragePath("co", "proj", "house", "a.jpg")).toBe("co/proj/house/a.jpg");
  });
});
