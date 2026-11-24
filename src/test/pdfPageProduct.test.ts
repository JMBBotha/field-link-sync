import { describe, expect, it, vi } from "vitest";
import { selectRegion } from "@/components/catalog/quote-builder/PdfPageOverlay";
import { productForPageRegion, type PageLiveProductRow } from "@/lib/pdfPageProduct";
import { toast } from "@/hooks/use-toast";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

// Samsung AC140RN4DKG/EU sits on the live FWGroup book but past a 2,000-row palette.
const SAMSUNG: PageLiveProductRow = {
  id: "ac140-live",
  product_code: "AC140RN4DKG/EU",
  short_name: "Samsung 14 kW 4-way WindFree cassette",
  brand: "Samsung",
  product_category: "Air Conditioning",
  category: "Air Conditioning",
  cost_excl_vat: 40086.09,
  cost_price: 40086.09,
  default_markup_percent: 20,
};

const palette = Array.from({ length: 2000 }, (_, i) => ({
  id: `other-${i}`,
  product_code: `OTHER-${i}`,
}));

describe("PDF row from the page query when it is not in the palette", () => {
  it("sets region.product from the live page row and the add is allowed", () => {
    const paletteMatch = palette.find((p) => p.id === SAMSUNG.id || p.product_code === SAMSUNG.product_code);
    expect(paletteMatch).toBeUndefined();

    const product = productForPageRegion(SAMSUNG, null);
    expect(product?.id).toBe("ac140-live");
    expect(product?.product_code).toBe("AC140RN4DKG/EU");
    expect(product?.cost_excl_vat).toBe(40086.09);

    let picked: { productId?: string; productCode?: string; costPrice?: number } | null = null;
    selectRegion(
      {
        id: "ocr-page-ac140",
        product,
        product_code: "AC140RN4DKG/EU",
        label: "Samsung 14 kW 4-way WindFree cassette",
        matched: true,
      } as any,
      { selectedFromPdf: [], handleSelectProduct: (row: any) => { picked = row; } } as any,
      [],
    );

    expect(toast).not.toHaveBeenCalled();
    expect(picked?.productId).toBe("ac140-live");
    expect(picked?.productCode).toBe("AC140RN4DKG/EU");
    expect(picked?.costPrice).toBe(40086.09);
  });

  it("keeps the palette product when the row is already loaded", () => {
    const loaded = { ...productForPageRegion(SAMSUNG, null)!, id: "from-palette" };
    expect(productForPageRegion(SAMSUNG, loaded)).toBe(loaded);
  });

  it("still blocks the add when the page query did not return the row", () => {
    expect(productForPageRegion(null, null)).toBeNull();
    selectRegion(
      { id: "ocr-missing", product: null, product_code: "AC140RN4DKG/EU", label: "Samsung" } as any,
      { selectedFromPdf: [], handleSelectProduct: () => { throw new Error("should not add"); } } as any,
      [],
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Not in the live catalogue",
    }));
  });
});
