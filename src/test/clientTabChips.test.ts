import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { chipMoney, clientTabChipClass, clientTabChips, sumHouseCounts } from "@/lib/clientTabChips";

const avec = {
  quoteCount: 8,
  quoteOpenValue: 1_250_000,
  invoiceCount: 13,
  invoiceOutstanding: 820_000,
  jobCount: 2,
  siteCount: 0,
  showProjects: true,
  projectCount: 1,
  houseCount: 119,
};

describe("client section chip weight", () => {
  it("formats a short money cue", () => {
    expect(chipMoney(0)).toBeNull();
    expect(chipMoney(450)).toBe("R450");
    expect(chipMoney(82_400)).toBe("R82k");
    expect(chipMoney(1_250_000)).toBe("R1.3m");
    expect(chipMoney(12_400_000)).toBe("R12m");
  });

  it("sums the project house count embed", () => {
    expect(sumHouseCounts([{ project_houses: [{ count: 119 }] }, { project_houses: [{ count: 4 }] }])).toBe(123);
    expect(sumHouseCounts([{}])).toBe(0);
  });

  it("makes money and houses louder than empty tabs, and keeps a selected tab blue", () => {
    const chips = clientTabChips(avec);
    const by = Object.fromEntries(chips.map((c) => [c.key, c]));
    expect(by.activity.weight).toBe("quiet");
    expect(by.activity.cue).toBeUndefined();
    expect(by.sites.weight).toBe("quiet");
    expect(by.sites.count).toBeUndefined();
    expect(by.jobs).toMatchObject({ weight: "mid", count: 2 });
    expect(by.quotes).toMatchObject({ weight: "heavy", count: 8, cue: "R1.3m" });
    expect(by.quotes.money).toBeUndefined();
    expect(by.invoices).toMatchObject({ weight: "heavy", count: 13, cue: "R820k", money: true });
    expect(by.projects).toMatchObject({ weight: "heavy", cue: "119 houses" });
    expect(by.projects.count).toBeUndefined();

    expect(clientTabChipClass(true, by.invoices)).toContain("bg-[#1590D6]");
    expect(clientTabChipClass(true, by.invoices)).toContain("text-white");
    expect(clientTabChipClass(true, by.invoices)).not.toContain("#F97316");
    expect(clientTabChipClass(false, by.invoices)).toContain("#F97316");
    expect(clientTabChipClass(false, by.invoices)).toContain("text-base");
    expect(clientTabChipClass(false, by.projects)).toContain("text-base");
    expect(clientTabChipClass(false, by.jobs)).toContain("font-semibold");
    expect(clientTabChipClass(false, by.jobs)).toContain("text-sm");
    expect(clientTabChipClass(false, by.activity)).toContain("text-muted-foreground");
    expect(clientTabChipClass(false, by.activity)).toContain("font-normal");
  });

  it("hides projects for sales reps and stays quiet with no money", () => {
    const chips = clientTabChips({ ...avec, showProjects: false, quoteOpenValue: 0, invoiceOutstanding: 0, houseCount: 0 });
    expect(chips.map((c) => c.key)).toEqual(["activity", "quotes", "invoices", "jobs", "sites"]);
    expect(chips.find((c) => c.key === "quotes")?.weight).toBe("mid");
    expect(chips.find((c) => c.key === "invoices")?.money).toBeFalsy();
  });

  it("pins the chip row under the client header, above the tab panel", () => {
    const src = readFileSync("src/pages/admin/AdminCustomerDetailPage.tsx", "utf8");
    const nav = src.indexOf('data-testid="client-section-tabs"');
    const header = src.indexOf('data-testid="client-money"');
    const balance = src.indexOf("<BalanceDueBlock");
    const panel = src.indexOf("<Tabs ");
    expect(header).toBeGreaterThan(0);
    expect(nav).toBeGreaterThan(header);
    expect(nav).toBeLessThan(balance);
    expect(nav).toBeLessThan(panel);
    expect(src).toContain("sticky top-0");
  });
});
