import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID, countAdminHome } from "./adminHomeCount";
import {
  buildMaterialCheck, checkKindOf, checkSummary, isFirstQuoteVisit, stockNeedsForWeek,
  type SourceLine, type StockHand,
} from "./materialCheck";
import { cashProjectionSlices } from "./roleHome";

const CT = MASSAIR_CT_ID;

const stock = (over: Partial<StockHand> & { id: string; label: string; qty: number }): StockHand => over;

function line(over: Partial<SourceLine> & { id: string }): SourceLine {
  return { source: "quote", name: over.id, quantity: 1, ...over };
}

describe("material check by job type", () => {
  it("treats a first quote visit as no material check, and a booked install as an install", () => {
    expect(isFirstQuoteVisit({ serviceType: "Sales/Consultation", title: "Quote visit" })).toBe(true);
    expect(isFirstQuoteVisit({ serviceType: "Installation", title: "Installation" })).toBe(false);
    expect(checkKindOf({ quoteVisit: true, jobType: "installation" })).toBe("quote_visit");
    expect(checkKindOf({ jobType: "installation" })).toBe("installation");
    expect(checkKindOf({ jobType: "service" })).toBe("service");
    expect(checkKindOf({ jobType: "repair" })).toBe("service");
    const visit = buildMaterialCheck({ kind: "quote_visit", stockKnown: true, lines: [line({ id: "u", name: "Indoor cassette" })] });
    expect(visit.show).toBe(false);
    expect(visit.lines).toEqual([]);
  });

  it("shows the quoted unit and materials on an install, and does not invent a missing model or run", () => {
    const check = buildMaterialCheck({
      kind: "installation",
      stockKnown: true,
      lines: [
        line({ id: "in", name: "Indoor cassette", code: "FTXM35", productType: "ac_unit", quantity: 1, productId: "p-in" }),
        line({ id: "br", name: "Wall brackets", quantity: 1, productId: "p-br" }),
        line({ id: "cu", name: "Copper pipe", lengthM: 6, productId: "p-cu" }),
        line({ id: "out", name: "Outdoor unit", productType: "ac_unit", quantity: null, code: null }),
        line({ id: "ghost", name: "Copper pipe", lengthM: null, quantity: null }),
      ],
      stock: [
        stock({ id: "s-in", label: "Indoor cassette", productId: "p-in", qty: 0 }),
        stock({ id: "s-br", label: "Wall brackets", productId: "p-br", qty: 4 }),
        stock({ id: "s-cu", label: "Copper pipe", productId: "p-cu", qty: 12 }),
      ],
    });
    expect(check.show).toBe(true);
    const byId = Object.fromEntries(check.lines.map((l) => [l.id, l]));
    expect(byId.in.status).toBe("to_pick");
    expect(byId.in.label).toContain("FTXM35");
    expect(byId.br.status).toBe("ready");
    expect(byId.cu.label).toContain("6 m");
    expect(byId.cu.status).toBe("ready");
    expect(byId.out.status).toBe("unspecified");
    expect(byId.out.label).toMatch(/not specified/i);
    expect(byId.ghost.status).toBe("unspecified");
    expect(byId.ghost.label).toMatch(/length not on the quote/i);
    expect(byId.ghost.label).not.toMatch(/\d+ m/);
    expect(checkSummary(check)?.label).toBe("1 part to pick");
  });

  it("does not mark a service job with an install pack as parts-ready, and does not invent the gas", () => {
    const check = buildMaterialCheck({
      kind: "service",
      stockKnown: true,
      lines: [
        line({ id: "in", name: "Indoor cassette", code: "FTXM35", productType: "ac_unit", quantity: 1 }),
        line({ id: "cu", name: "Copper pipe", lengthM: 18 }),
        line({ id: "br", name: "Wall brackets", quantity: 1 }),
      ],
      stock: [stock({ id: "s", label: "Indoor cassette", qty: 5, productId: "nope" })],
    });
    expect(check.lines.map((l) => l.id)).toEqual(["repair-consumables"]);
    expect(check.lines[0].status).toBe("note");
    expect(check.lines[0].label).toMatch(/R410 or R32/);
    expect(check.lines[0].label).not.toMatch(/ready|to pick/i);
    expect(check.toPickCount).toBe(0);
    expect(checkSummary(check)).toEqual({ label: "Consumables", tone: "neutral" });
  });

  it("uses a named refrigerant and shows a repair part that is on the quote", () => {
    const check = buildMaterialCheck({
      kind: "service",
      stockKnown: true,
      lines: [
        line({
          id: "gas",
          name: "R410A",
          quantity: 1,
          productId: "p-gas",
          product: { name: "R410A", short_name: "R410A 2 kg", price_per_unit_label: "kg" },
        }),
        line({ id: "comp", name: "Compressor", quantity: 1, productId: "p-comp" }),
        line({ id: "unit", name: "Outdoor unit", productType: "ac_unit", quantity: 1 }),
      ],
      recorded: [line({ id: "board", name: "PCB board", quantity: 1, source: "recorded" })],
      stock: [
        stock({ id: "s-gas", label: "R410A", productId: "p-gas", qty: 0.2 }),
        stock({ id: "s-comp", label: "Compressor", productId: "p-comp", qty: 0 }),
        stock({ id: "s-board", label: "PCB board", qty: 2 }),
      ],
    });
    const ids = check.lines.map((l) => l.id);
    expect(ids).not.toContain("repair-consumables");
    expect(ids).not.toContain("unit");
    expect(ids).toContain("gas");
    expect(ids).toContain("comp");
    expect(ids).toContain("board");
    expect(check.lines.find((l) => l.id === "gas")?.status).toBe("to_pick");
    expect(check.lines.find((l) => l.id === "comp")?.status).toBe("to_pick");
    expect(check.lines.find((l) => l.id === "board")?.status).toBe("ready");
  });

  it("does not call a line ready or short when stock was not loaded", () => {
    const check = buildMaterialCheck({
      kind: "installation",
      stockKnown: false,
      lines: [line({ id: "in", name: "Daikin FTXM35 indoor", productType: "ac_unit", quantity: 1 })],
    });
    expect(check.lines[0].status).toBe("stock_unknown");
    expect(check.toPickCount).toBe(0);
  });
});

describe("stock orders this week", () => {
  const install: Parameters<typeof stockNeedsForWeek>[1][number] = {
    id: "job-install",
    href: "/admin/jobs/job-install",
    company_id: CT,
    kind: "installation",
    stockKnown: true,
    lines: [
      line({ id: "in", name: "Indoor cassette", productType: "ac_unit", quantity: 1, productId: "p-in" }),
      line({ id: "cu", name: "Copper pipe", lengthM: 6, productId: "p-cu" }),
    ],
    stock: [
      stock({ id: "s-in", label: "Indoor cassette", productId: "p-in", qty: 0 }),
      stock({ id: "s-cu", label: "Copper pipe", productId: "p-cu", qty: 2 }),
    ],
  };
  const repair = {
    id: "job-repair",
    href: "/admin/jobs/job-repair",
    company_id: CT,
    kind: "service" as const,
    stockKnown: true,
    lines: [
      line({ id: "unit", name: "Indoor cassette", productType: "ac_unit", quantity: 1, productId: "p-in" }),
      line({ id: "gas", name: "R32", quantity: 1, productId: "p-gas", product: { name: "R32", short_name: "R32", price_per_unit_label: "kg" } }),
    ],
    stock: [stock({ id: "s-gas", label: "R32", productId: "p-gas", qty: 0 })],
  };

  it("orders install shortfalls and only the repair lines that are actually needed", () => {
    const { orders, levels } = stockNeedsForWeek(CT, [install, repair, {
      id: "visit", href: "/admin/bookings/v", company_id: CT, kind: "quote_visit", stockKnown: true,
      lines: [line({ id: "x", name: "Indoor cassette", productType: "ac_unit", quantity: 3 })],
    }]);
    const labels = orders.map((o) => o.label).join(" | ");
    expect(labels).toMatch(/Indoor cassette/);
    expect(labels).toMatch(/6 m × Copper pipe|Copper pipe/);
    expect(labels).toMatch(/R32/);
    expect(orders.find((o) => /cassette/i.test(o.label))?.href).toBe("/admin/jobs/job-install");
    expect(levels.some((l) => /cassette/i.test(l.name) && l.short === 1)).toBe(true);
    expect(orders.some((o) => o.href.includes("bookings"))).toBe(false);
  });

  it("does not take Massair Ind or Test HVAC jobs into a Massair CT order", () => {
    const { orders } = stockNeedsForWeek(CT, [
      { ...install, id: "ind", company_id: MASSAIR_IND_ID, href: "/admin/jobs/ind" },
      { ...install, id: "hvac", company_id: TEST_HVAC_ID, href: "/admin/jobs/hvac" },
    ]);
    expect(orders).toEqual([]);
  });

  it("does not turn an unstated pipe run into metres on the order", () => {
    const { orders } = stockNeedsForWeek(CT, [{
      ...install,
      lines: [line({ id: "cu", name: "Copper pipe", lengthM: null, quantity: null })],
      stock: [],
    }]);
    expect(orders).toEqual([]);
  });
});

describe("cash projection reuses the waiting, deposit and final figures", () => {
  it("uses draft-not-emailed grand totals and does not add the call-out back in", () => {
    const counts = countAdminHome({
      companyId: CT,
      now: new Date("2026-11-07T08:00:00+02:00"),
      invoices: [
        { id: "w", company_id: CT, status: "draft", grand_total: 42495.5, invoice_number: "INV-1", customer_name: "A", call_out_excl_vat: 680 },
        { id: "d", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 1000, notes: "DEPOSIT", invoice_number: "INV-D", customer_name: "B" },
        { id: "f", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 2000, notes: "Final", invoice_number: "INV-F", customer_name: "C" },
        { id: "ind", company_id: MASSAIR_IND_ID, status: "draft", grand_total: 99999, invoice_number: "IND", customer_name: "Ind" },
      ],
    });
    const slices = cashProjectionSlices(counts);
    expect(slices.map((s) => s.label)).toEqual(["Deposits due", "Finals due", "Waiting to send"]);
    expect(slices.find((s) => s.key === "waiting")?.total).toBe(42495.5);
    expect(slices.find((s) => s.key === "deposit")?.total).toBe(1000);
    expect(slices.find((s) => s.key === "final")?.total).toBe(2000);
    expect(slices.every((s) => s.figure.rule.includes("never deducted"))).toBe(true);
  });
});
