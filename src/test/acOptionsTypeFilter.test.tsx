import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ACOptionsModal, { acTypeFilterDefault, detectACType } from "@/components/catalog/quote-builder/ACOptionsModal";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

function product(over: Partial<PaletteProduct>): PaletteProduct {
  return {
    id: "p",
    product_code: "CODE",
    short_name: "Unit",
    brand: "Midea",
    product_category: "Air Conditioning",
    category: "Air Conditioning",
    cost_excl_vat: 1000,
    cost_incl_vat: 1150,
    cost_price: 1000,
    selling_price: 1350,
    default_markup_percent: 35,
    description: "Unit",
    is_pinned: false,
    pin_order: null,
    supplier_name: "Livance",
    supplier_type: "equipment",
    price_per_metre: null,
    sold_in_length: false,
    unit_length: null,
    pipe_size: null,
    is_material_favorite: false,
    pack_qty: null,
    supplier_discount_percent: null,
    markup_percent: 35,
    ...over,
  };
}

const wall = product({
  id: "wall",
  product_code: "MID-12",
  short_name: "Midea mid-wall 12k",
  description: "Midea mid-wall inverter",
  category: "Wall Mount",
});
const cassette = product({
  id: "cass",
  product_code: "R32-MICAS-12 + CST-R32-MICOND-12 + BZE-T-MBQ4-03",
  short_name: "Midea 12K INV Cassette",
  description: "R32 LCAC coastal cassette",
  category: "Cassette Inverter",
});

describe("AC options type filter", () => {
  it("defaults to All even when the quote already has a wall mount", () => {
    expect(acTypeFilterDefault(null)).toBe("all");
    expect(acTypeFilterDefault("Cassette")).toBe("Cassette");
    expect(acTypeFilterDefault("all")).toBe("all");

    render(
      <ACOptionsModal
        open
        onClose={() => undefined}
        products={[wall, cassette]}
        inferredBrand="Midea"
        inferredType="Wall Mount"
        onConfirm={() => undefined}
      />,
    );

    expect(screen.getByLabelText("Unit type")).toHaveTextContent("All Types");
    expect(screen.getAllByText("Midea 12K INV Cassette").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Midea mid-wall 12k").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-inferred-type]")?.getAttribute("data-inferred-type")).toBe("Wall Mount");
  });

  it("keeps an explicit type and files a coastal cassette by its category", () => {
    expect(acTypeFilterDefault("Cassette")).toBe("Cassette");
    expect(detectACType(cassette)).toBe("Cassette");
    expect(detectACType(product({
      short_name: "48K under ceiling",
      description: "Under Ceiling",
      category: "Cassette Inverter",
    }))).toBe("Cassette");
  });
});
