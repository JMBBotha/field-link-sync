import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuoteTotalsBar } from "@/components/catalog/QuoteBuilderTab";
import { computeQuoteTotals, type QuoteItem, type QuoteArea } from "@/utils/quoteTransformers";
import { useQuoteLiveTotals } from "@/stores/quoteLiveTotalsStore";

const line = (total: number): QuoteItem =>
  ({
    id: "l1",
    quote_id: "q",
    area_id: "a",
    parent_item_id: null,
    product_id: "p",
    item_name: "Samsung 24K INV MW",
    item_number: null,
    description: null,
    quantity: 1,
    length: null,
    unit_price: total,
    total_price: total,
    is_bundle: false,
    item_type: "Air Conditioning",
    metadata: {},
    sort_order: 0,
    notes: null,
    created_at: "",
    updated_at: "",
  }) as unknown as QuoteItem;

const area: QuoteArea = { id: "a", quote_id: "q", name: "Lounge", sort_order: 0, created_at: "", updated_at: "" };

describe("quote builder total headline (incl. VAT)", () => {
  it("subtotal 23198.56 → VAT 3479.78 and total 26678.34", () => {
    const totals = computeQuoteTotals([line(23198.56)], [area]);
    expect(totals.subtotal).toBeCloseTo(23198.56, 2);
    expect(totals.vatAmount).toBeCloseTo(3479.78, 2);
    expect(totals.total).toBeCloseTo(26678.34, 2);
  });

  it("bar shows the total incl. VAT with the ex-VAT split below", () => {
    const totals = computeQuoteTotals([line(23198.56)], [area]);
    render(<QuoteTotalsBar totals={totals} />);
    expect(screen.getByTestId("builder-total-incl-vat").textContent).toBe("R 26 678,34");
    const heading = screen.getByText(/Total incl\. VAT/);
    expect(heading.textContent).toBe("Total incl. VAT (1 items across 1 zones)");
    const split = screen.getByText(/Subtotal excl\. VAT/);
    expect(split.textContent).toContain("R 23 198,56");
    expect(split.textContent).toContain("R 3 479,78");
    // The old mislabelled bare subtotal must not appear as the headline.
    expect(screen.queryByText(/^R 23 198,56$/)).toBeNull();
  });
});

describe("quoteLiveTotalsStore carries vat/total", () => {
  beforeEach(() => useQuoteLiveTotals.getState().reset());

  it("set passes vat/total through; reset clears them", () => {
    useQuoteLiveTotals.getState().set({ items: 3, zones: 2, subtotal: 23198.56, vat: 3479.78, total: 26678.34 });
    const s = useQuoteLiveTotals.getState();
    expect(s.hasLiveData).toBe(true);
    expect(s.vat).toBe(3479.78);
    expect(s.total).toBe(26678.34);
    useQuoteLiveTotals.getState().reset();
    expect(useQuoteLiveTotals.getState().total).toBe(0);
  });

  it("callers that omit vat/total still work (default 0)", () => {
    useQuoteLiveTotals.getState().set({ items: 1, zones: 1, subtotal: 100 });
    expect(useQuoteLiveTotals.getState().total).toBe(0);
  });
});
