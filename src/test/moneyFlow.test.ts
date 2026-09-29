import { describe, expect, it } from "vitest";
import { groupTotals, monthlyGroups, viewTotals, waterfall, type MoneyFlow } from "@/lib/moneyFlow";

const flow: MoneyFlow = {
  api_version: 1, company_id: "c",
  segments: [
    { key: "items_cost", group: "cost", label: "Physical item cost", order: 1 },
    { key: "sales_commission", group: "sales", label: "Sales commission", order: 2 },
    { key: "tech_paid", group: "tech", label: "Tech labour share · paid", order: 11 },
    { key: "company_items", group: "company", label: "Company keeps · items", order: 20 },
    { key: "company_labour", group: "company", label: "Company keeps · labour", order: 21 },
  ],
  totals: {
    earned: { quotes: 1, revenue_ex_vat: 6000, segments: { items_cost: 3000, sales_commission: 1000, tech_paid: 600, company_items: 1000, company_labour: 400 } },
    pending: { quotes: 1, revenue_ex_vat: 100, segments: { items_cost: 50, sales_commission: 25, tech_paid: 0, company_items: 25, company_labour: 0 } },
  },
  months: [
    { month: "2026-09", bucket: "earned", revenue_ex_vat: 6000, segments: { items_cost: 3000, sales_commission: 1000, tech_paid: 600, company_items: 1000, company_labour: 400 } },
    { month: "2026-09", bucket: "pending", revenue_ex_vat: 100, segments: { items_cost: 50, sales_commission: 25, company_items: 25 } },
  ],
  people: [],
};

describe("moneyFlow", () => {
  it("totals per view and groups", () => {
    expect(viewTotals(flow, "earned").revenue).toBe(6000);
    expect(viewTotals(flow, "all").segments.items_cost).toBe(3050);
    expect(groupTotals(flow.segments, viewTotals(flow, "earned").segments)).toEqual({ cost: 3000, sales: 1000, tech: 600, company: 1400 });
  });
  it("waterfall walks revenue down to zero, labour cost counted once (as tech share)", () => {
    const t = viewTotals(flow, "earned");
    const bars = waterfall(flow.segments, t.revenue, t.segments);
    expect(bars[0]).toMatchObject({ name: "Revenue ex VAT", value: 6000 });
    expect(bars).toHaveLength(6);
    expect(bars[bars.length - 1].base).toBe(0);
    expect(bars.map((b) => b.name)).not.toContain("Labour cost");
  });
  it("accepts extra Job 6 segments without code changes", () => {
    const f2: MoneyFlow = { ...flow, segments: [...flow.segments, { key: "tech_held", group: "tech", label: "Tech · held", order: 12 }, { key: "company_tools", group: "company", label: "Tools", order: 23 }],
      totals: { ...flow.totals, earned: { ...flow.totals.earned, segments: { ...flow.totals.earned.segments, tech_held: 100, company_tools: 100, tech_paid: 400, company_labour: 400 } } } };
    const t = viewTotals(f2, "earned");
    expect(groupTotals(f2.segments, t.segments)).toEqual({ cost: 3000, sales: 1000, tech: 500, company: 1500 });
    expect(waterfall(f2.segments, t.revenue, t.segments).at(-1)!.base).toBe(0);
  });
  it("monthly stacks", () => {
    expect(monthlyGroups(flow, "all")).toEqual([{ month: "2026-09", cost: 3050, sales: 1025, tech: 600, company: 1425 }]);
  });
});
