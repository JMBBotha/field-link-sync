import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildClientRollup, foldFlatLines, allocateCents, rollupCents, type RollupLine } from "@/lib/clientQuoteRollup";
import { r0Quote } from "@/lib/zeroPriceGuard";
import { missingLabourFor } from "@/lib/areaLabour";
import BrandDocument from "@/components/documents/BrandDocument";
import { buildPurchaseOrderPdf } from "@/lib/purchaseOrderPdf";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));

// Real rows: quote 0003373 (Cape Estates, 13 Oct 08:20) incl. Johan's R0.01 "AC INSTALLATION" heading.
const q3373: RollupLine[] = [
  { id: "h", item_name: "AC INSTALLATION", quantity: 0, unit_price: 0.01, total_price: 0, area_id: null, item_type: null, metadata: { manual_price: true } },
  { id: "u1", item_name: "SAMSUNG FJM R410 Free Joint Multi", quantity: 1, unit_price: 29216.52, total_price: 29216.52, area_id: null, item_type: null },
  { id: "u2", item_name: "SAMSUNG - INV 18K BTU -1-WAY CASSETTE", quantity: 1, unit_price: 10976.78, total_price: 10976.78, area_id: null, item_type: null },
  { id: "u3", item_name: "SAMSUNG - INV 12K BTU -1-WAY CASSETTE", quantity: 1, unit_price: 10558.53, total_price: 10558.53, area_id: null, item_type: null },
  { id: "u4", item_name: "SAMSUNG - INV 09K BTU -1-WAY CASSETTE", quantity: 2, unit_price: 10185.75, total_price: 20371.5, area_id: null, item_type: null },
  { id: "f", item_name: "0800BECOOL -INSTALLATION FEE", quantity: 1, unit_price: 14760, total_price: 14760, area_id: null, item_type: null },
];
// Q-2026-0034: services + an un-areaed 2 h labour row.
const q0034: RollupLine[] = [
  { id: "s1", item_name: "Bathroom extraction system: supply and install 1 x TD100 silent fan", quantity: 1, unit_price: 4117.5, total_price: 4117.5, item_type: "service", area_id: null },
  { id: "s2", item_name: "100mm diameter spiral ducting", quantity: 1, unit_price: 1350, total_price: 1350, item_type: "service", area_id: null },
  { id: "s3", item_name: "Disc valve for bathroom, weather louver for outside and 1.5 m flexible ducting", quantity: 1, unit_price: 1147.5, total_price: 1147.5, item_type: "service", area_id: null },
  { id: "l", item_name: "Labour: 2 hours at R680/hour", quantity: 2, unit_price: 680, total_price: 1360, item_type: "labour", area_id: null, metadata: { labour: true } },
];

describe("client documents: labour folded, totals exact (Johan 2026-10-13)", () => {
  it("0003373: no labour / install fee line, heading skipped, lines sum exactly to the stored subtotal R85 883.33", () => {
    const r = buildClientRollup(q3373, [], { targetSubtotal: 85883.33 });
    const names = r.flatMap((a) => a.items.map((i) => i.name));
    expect(names.some((n) => /install|labour/i.test(n))).toBe(false);
    expect(names).toHaveLength(4);
    expect(rollupCents(r)).toBe(8588333);
    // the fee is spread by price: the FJM (biggest) carries the biggest share
    const fjm = r[0].items.find((i) => i.id === "u1")!;
    expect(fjm.lineTotal).toBeGreaterThan(29216.52);
    expect(r[0].items.find((i) => i.id === "u4")!.quantity).toBe(2);
  });
  it("Q-2026-0034: R1 360 labour spread over the 3 services; sum = R7 975.00", () => {
    const r = buildClientRollup(q0034, [], { targetSubtotal: 7975 });
    expect(r.flatMap((a) => a.items)).toHaveLength(3);
    expect(rollupCents(r)).toBe(797500);
  });
  it("labour-only quote prints one 'Installation / service' line", () => {
    const r = buildClientRollup([q0034[3]], []);
    expect(r.flatMap((a) => a.items.map((i) => i.name))).toEqual(["Installation / service"]);
    expect(rollupCents(r)).toBe(136000);
  });
  it("leftover cents go on the last line", () => {
    expect(allocateCents(100, [1, 1, 1])).toEqual([33, 33, 34]);
    expect(allocateCents(1, [0, 0])).toEqual([0, 1]);
  });
  it("invoice flat lines: labour folded per room, sum unchanged", () => {
    const lines = [
      { name: "Unit A", quantity: 1, unit_price: 1000, amount: 1000, room: "Lounge" },
      { name: "Labour", quantity: 3.5, unit_price: 680, amount: 2380, room: "Lounge" },
      { name: "Unit B", quantity: 2, unit_price: 500, amount: 1000, room: "Bed" },
      { name: "Installation fee", quantity: 1, unit_price: 99.99, amount: 99.99, room: null },
    ];
    const f = foldFlatLines(lines);
    expect(f.map((l) => l.name)).toEqual(["Unit A", "Unit B"]);
    expect(f.reduce((s, l) => s + Math.round(l.amount * 100), 0)).toBe(447999);
  });
});

describe("guards never block on labour", () => {
  it("R0 guard ignores qty-0 headings and R0 labour, still catches a real R0 unit", () => {
    expect(r0Quote(q3373.map((l) => ({ ...l, unit_price: l.id === "h" ? 0 : l.unit_price })) as any)).toBeNull();
    expect(r0Quote([{ item_name: "Labour", item_type: "labour", quantity: 2, unit_price: 0 }] as any)).toBeNull();
    expect(r0Quote([{ item_name: "Samsung 12K", quantity: 1, unit_price: 0 }] as any)).toBe("Samsung 12K");
  });
  it("labour included = nothing missing", () => {
    const lines = [{ id: "x", area_id: "a", item_name: "Unit", quantity: 1 }] as any;
    expect(missingLabourFor("per_area", [{ id: "a", name: "Lounge" }], lines, 3.5, true)).toEqual([]);
  });
});

describe("BrandDocument uses the document company's OWN record", () => {
  const partner = { company_id: "p1", legal_name: "Cool Partners (Pty) Ltd", phone: "011 555 0000", vat_number: "4999999999", address_lines: ["1 Partner St", "Joburg"], email: "a@partner.co.za", website: null, whatsapp: null, document_style: "bold" } as any;
  const base = { docType: "quote" as const, captureRoot: "estimate" as const, title: "QUOTATION", number: "Q-1", partyLabel: "Prepared for", partyName: "Client", partyLines: [], partyVat: "4340316696", meta: [] as [string, string][],
    sections: [{ key: "a", lines: [{ key: "1", quantity: "1", name: "Unit", rate: 10, total: 10 }] }], totals: [], grandLabel: "Total", grandTotal: 11.5, cards: [] };
  it("partner document shows the partner's details, never Massair's, and its Bold setting", () => {
    const { container } = render(<BrandDocument {...base} profile={partner} />);
    const html = container.innerHTML;
    expect(html).toContain("Cool Partners (Pty) Ltd");
    expect(html).toContain("1 Partner St");
    expect(html).not.toMatch(/Massair|Cabernet|802.2889|0800becool/i);
    expect(container.querySelector("[data-doc-style]")?.getAttribute("data-doc-style")).toBe("bold");
    expect(screen.getByTestId("customer-vat").textContent).toContain("4340316696");
  });
  it("Light is the default", () => {
    const { container } = render(<BrandDocument {...base} profile={{ ...partner, document_style: null }} />);
    expect(container.querySelector("[data-doc-style]")?.getAttribute("data-doc-style")).toBe("light");
  });
  it("PO PDF builds for a partner in both styles without Massair details", () => {
    const po = { id: "1", po_number: "PO-9", status: "draft", created_at: "2026-10-13", client_name: "C", job_reference: null, supplier_account_number: null, supplier_emails: [], deliver_to: null, subtotal: 100, vat_amount: 15, total: 115, items: [{ model_code: "X", description: "Y", qty: 1, unit_cost_excl_vat: 100, line_total_excl_vat: 100 }] };
    for (const style of ["light", "bold"] as const) {
      const out = buildPurchaseOrderPdf(po, partner, { style }).output();
      expect(out).toContain("Cool Partners");
      expect(out).not.toMatch(/Cabernet|0800becool/);
    }
  });
});

describe("rate x qty = line total to the cent", () => {
  it("0003373 qty-2 cassette prints a rate that multiplies out exactly", () => {
    const r = buildClientRollup(q3373, [], { targetSubtotal: 85883.33 });
    for (const it of r.flatMap((a) => a.items)) expect(Math.round(it.unitPrice * it.quantity * 100)).toBe(Math.round(it.lineTotal * 100));
    expect(rollupCents(r)).toBe(8588333);
  });
});
