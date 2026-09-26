import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement } from "react";
import { render, fireEvent, screen } from "@testing-library/react";

vi.mock("@/lib/mandy/voiceUnlock", () => ({ unlockMandyVoiceFromTap: vi.fn() }));

import { matchCatalog, normaliseSpokenProduct, parseSpokenQty } from "@/lib/mandy/catalogMatch";
import { resolvePlan, sanitizePlan, writeBreakdown } from "@/lib/mandy/quotePlan";
import { setActiveQuoteMarkupRates } from "@/lib/pricing";
import { useMandyDock } from "@/lib/mandy/registry";
import VoiceQuoteStartDialog from "@/components/quoting/VoiceQuoteStartDialog";
import { LIVE, TEMPLATES } from "./standardInstall.test";

afterEach(() => setActiveQuoteMarkupRates(null));

const sp = (q: string) => parseSpokenQty(normaliseSpokenProduct(q));

describe("shared matcher: spoken quantities", () => {
  it("'x' and 'by' between numbers", () => {
    expect(sp("2 x 3m trunking")).toMatchObject({ qty: 2, lengthM: 3, query: "trunking" });
    expect(sp("2 by 3 metres trunking")).toMatchObject({ qty: 2, lengthM: 3 });
    expect(normaliseSpokenProduct("3/8 by 1/2 kit")).toContain("3/8 x 1/2");
  });
  it("spoken numbers, a couple, half", () => {
    expect(sp("three elbows")).toMatchObject({ qty: 3, query: "elbow" });
    expect(sp("a couple of brackets")).toMatchObject({ qty: 2, query: "brackets" });
    expect(sp("two and a half metres drain pipe")).toMatchObject({ lengthM: 2.5, query: "drain pipe" });
    expect(sp("half a metre drain pipe")).toMatchObject({ lengthM: 0.5 });
    expect(sp("twenty end caps").qty).toBe(20);
    expect(normaliseSpokenProduct("twelve thousand")).toBe("12k"); // BTU is never a quantity
    expect(sp("12k samsung").qty).toBeNull();
  });
  it("'N lengths' → qty N of a length-sold item; bends → elbow", () => {
    expect(sp("2 lengths of trunking")).toMatchObject({ qty: 2, lengths: true, query: "trunking" });
    expect(sp("trunking 3 lengths")).toMatchObject({ qty: 3, lengths: true, query: "trunking" });
    expect(sp("3 bends")).toMatchObject({ qty: 3, query: "elbow" });
    const m = matchCatalog("three bends", LIVE);
    const top = m.ranked[0];
    expect(top?.kind === "product" && top.product.product_code).toBe("ELB001");
    expect(m.qty).toBe(3);
  });
});

const unit18 = {
  id: "AR40F18C0AG/FA", product_code: "AR40F18C0AG/FA", short_name: "Samsung 18K INV MW", brand: "Samsung",
  product_category: "Air Conditioning", category: "Air Conditioning", cost_price: 11129.74, cost_excl_vat: 11129.74,
  default_markup_percent: 25, supplier_name: "Samsung", btu_rating: 18000,
} as any;
const comp = (code: string, cost: number, ppm: number) => ({
  quantity: 1, length_metres: 1, is_length_item: true, is_optional: false,
  product: { id: code, product_code: code, short_name: code, product_category: "Consumables", category: "Consumables",
    cost_price: cost, cost_excl_vat: cost, price_per_metre: ppm, sold_in_length: true, unit_length: 15.24, default_markup_percent: 100, supplier_name: "One Stop" },
});
const kit18 = { id: "kit18", name: "18K PIPING KIT", min_btu: 17000, max_btu: 19000, items: [comp("COPRL001", 900, 60), comp("COPRL003", 1500, 98)] };
const kit12 = { id: "kit12", name: "12K PIPING KIT", min_btu: 11000, max_btu: 13000, items: [comp("COPRL001", 900, 60), comp("COPRL003", 1500, 98)] };

describe("Mandy quote mode: plan → matched → breakdown → write", () => {
  // What Grok (mandy-quote-plan) returns for the sentence — mocked.
  const grokPlan = {
    client: null,
    items: [
      { query: "18K Samsung AR40", kind: "unit", qty: null, length_m: null, area: null },
      { query: "piping", kind: "piping", length_m: 5, area: null },
      { query: "trunking", kind: "item", qty: 2, area: null },
    ],
  };

  it("'18K Samsung AR40 with 5 m piping and 2 trunking lengths' → AR40F18 + standard install (18K kit at 5 m) + trunking qty 2", async () => {
    setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
    const products = [unit18, ...LIVE];
    const bundles = [kit12, kit18];
    const plan = sanitizePlan(grokPlan);
    const bd = resolvePlan(plan, { products, bundles, templates: TEMPLATES, fallbackArea: "Lounge" }, "18K Samsung AR40 with 5 m piping and 2 trunking lengths");

    expect(bd.areas).toHaveLength(1);
    const [unitLine, trunk] = bd.areas[0].lines;
    expect(unitLine.product?.product_code).toBe("AR40F18C0AG/FA");
    expect(unitLine.status).toBe("ok");
    expect(unitLine.meta.kit_length_m).toBe(5);
    expect(unitLine.meta.kit_name).toBe("18K PIPING KIT");
    expect(trunk.product?.product_code).toBe("TRUNK01");
    expect(trunk.quantity).toBe(2);
    expect(trunk.meta.install_of).toBe(unitLine.id);

    const rows: any[] = [];
    const addItem = async (i: any) => { const r = { ...i, id: `row${rows.length}` }; rows.push(r); return r; };
    const addArea = vi.fn(async (name: string) => ({ id: "area-lounge", name }));
    const out = await writeBreakdown(bd, { addItem, addArea, areas: [], sortStart: 0, templates: TEMPLATES, bundles, products });

    expect(addArea).toHaveBeenCalledWith("Lounge");
    expect(rows[0].item_number).toBe("AR40F18C0AG/FA");
    const kit = rows.find((r) => r.is_bundle);
    expect(kit.item_name).toBe("18K PIPING KIT");
    expect(kit.length).toBe(5);
    expect(kit.metadata.install).toMatchObject({ unit_item_id: "row0", role: "piping_kit", template_id: "t18" });
    const trunkRows = rows.filter((r) => r.item_number === "TRUNK01");
    expect(trunkRows).toHaveLength(1); // no duplicate — install line quantity set to 2
    expect(trunkRows[0].quantity).toBe(2);
    expect(trunkRows[0].metadata.install.role).toBe("trunking_main");
    expect(rows.every((r) => r.area_id === "area-lounge")).toBe(true);
    expect(out.ids).toHaveLength(rows.length);
  });

  it("nothing is written before Confirm; unknown items are flagged, never invented", () => {
    const bd = resolvePlan(sanitizePlan({ items: [{ query: "flux capacitor", kind: "item" }] }), { products: LIVE, bundles: [], templates: TEMPLATES });
    expect(bd.areas[0].lines[0].status).toBe("missing");
  });

  it("sanitizes bad model output", () => {
    expect(sanitizePlan("nope").items).toEqual([]);
    expect(sanitizePlan({ items: [{ query: "x", kind: "weird", qty: -2 }] }).items[0]).toMatchObject({ kind: "item", qty: null });
  });
});

describe("Voice quote / Build with voice opens Mandy", () => {
  it("button opens Mandy listening in quote mode", () => {
    useMandyDock.setState({ open: false, mode: "default", listenRequest: 0 });
    render(createElement(VoiceQuoteStartDialog));
    fireEvent.click(screen.getByRole("button", { name: /voice quote with mandy/i }));
    const s = useMandyDock.getState();
    expect(s.open).toBe(true);
    expect(s.mode).toBe("quote");
    expect(s.listenRequest).toBe(1);
    s.setOpen(false);
    expect(useMandyDock.getState().mode).toBe("default");
  });
});
