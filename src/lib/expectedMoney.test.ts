import { describe, expect, it } from "vitest";
import { projectExpected, type AutoExpected, type ManualExpected } from "./expectedMoney";

const today = "2026-11-07";
const auto: AutoExpected[] = [
  { invoiceId: "d1", part: "deposit", amount: 8000, date: "2026-11-12", label: "DEMO-D1 · A", href: "/admin/invoices/d1" },
  { invoiceId: "d2", part: "deposit", amount: 4500, date: "2026-11-19", label: "DEMO-D2 · B", href: "/admin/invoices/d2" },
  { invoiceId: "f", part: "final", amount: 22000, date: "2026-11-28", label: "DEMO-F · C", href: "/admin/invoices/f" },
  { invoiceId: "late", part: "final", amount: 1000, date: "2026-11-01", label: "LATE", href: "/admin/invoices/late" },
  { invoiceId: "far", part: "final", amount: 999, date: "2027-02-01", label: "FAR", href: "/admin/invoices/far" },
];

describe("expected money on home", () => {
  it("puts invoice balances into 7 and 30 days and projects them on top of cash", () => {
    const picture = projectExpected({ today, cash: 12500, auto });
    expect(picture.next7).toBe(9000);
    expect(picture.next30).toBe(35500);
    expect(picture.projected).toBe(48000);
    expect(picture.rows.some((row) => row.id === "inv:far:final" && !row.in30)).toBe(true);
    expect(picture.rows.find((row) => row.id === "inv:late:final")?.overdue).toBe(true);
    expect(picture.rows.find((row) => row.id === "inv:late:final")?.dateLabel).toMatch(/^Late · /);
  });

  it("waits out the grace before it reads Late", () => {
    const picture = projectExpected({
      today,
      cash: 0,
      lateGraceDays: 3,
      auto: [{ invoiceId: "soon", part: "deposit", amount: 100, date: "2026-11-05", label: "Soon", href: "/admin/invoices/soon" }],
    });
    const row = picture.rows[0];
    expect(row.overdue).toBe(true);
    expect(row.late).toBe(false);
    expect(row.dateLabel.startsWith("Late")).toBe(false);
  });

  it("lets a hand entry linked to an invoice replace that invoice figure", () => {
    const manual: ManualExpected[] = [
      { id: "m1", source: "manual", part: "deposit", invoiceId: "d1", amount: 5000, date: "2026-11-12", label: "Harbour", note: null },
    ];
    const picture = projectExpected({ today, cash: 100, auto, manual });
    expect(picture.rows.some((row) => row.id === "inv:d1:deposit")).toBe(false);
    expect(picture.rows.some((row) => row.id === "m1" && row.tap)).toBe(true);
    expect(picture.next7).toBe(6000);
  });

  it("ignores invoice-synced rows and cancelled rows, and leaves projected blank without cash", () => {
    const manual: ManualExpected[] = [
      { id: "w", source: "walda", part: "other", invoiceId: null, amount: 200, date: "2026-11-08", label: "Other", note: "card" },
    ];
    const picture = projectExpected({ today, cash: null, auto: [], manual });
    expect(picture.projected).toBeNull();
    expect(picture.next7).toBe(200);
    expect(picture.rows[0].label).toMatch(/WALDA/);
  });
});
