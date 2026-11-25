import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { linesMissingUnitImages, missingUnitImageMessage } from "./quoteUnitImages";

const unit = {
  id: "line-1",
  item_name: "Midea 48K INV Under Ceiling",
  item_type: "product",
  product_id: "p1",
  product_code: "R32-MICAS-48 (1PH) + CST-R32-MICOND-48-Q",
  metadata: {},
};
const product = { id: "p1", image_url: null as string | null, category: "Air Conditioners", btu_rating: 48000 };

describe("quote unit image guard", () => {
  it("blocks a unit with no photo and names it", () => {
    const missing = linesMissingUnitImages([unit], [product]);
    expect(missing).toEqual([{ id: "line-1", name: "Midea 48K INV Under Ceiling", productId: "p1" }]);
    expect(missingUnitImageMessage(missing.map((row) => row.name), { hint: false })).toContain("Midea 48K INV Under Ceiling");
    expect(missingUnitImageMessage(missing.map((row) => row.name))).toContain("Find images");
  });

  it("lets a unit through once it has a photo", () => {
    expect(linesMissingUnitImages([unit], [{ ...product, image_url: "https://cdn.example/midea.png" }])).toEqual([]);
  });

  it("does not block labour, a piping kit, or a remote", () => {
    const lines = [
      { id: "lab", item_name: "Labour: 2 hours", item_type: "labour", metadata: { labour: true }, product_id: null },
      { id: "kit", item_name: "Piping kit 1/4 + 3/8", item_type: "installation kit", is_bundle: true, metadata: { kit: { name: "Piping kit" } }, product_id: "p2" },
      { id: "remote", item_name: "Wireless remote controller BRC4C65", item_type: "product", product_id: "p3", metadata: {} },
    ];
    const products = [
      { id: "p2", image_url: null, category: "Installation materials" },
      { id: "p3", image_url: null, category: "Controls" },
    ];
    expect(linesMissingUnitImages(lines, products)).toEqual([]);
  });
});

describe("image lookup wiring", () => {
  it("the edge function searches once, stores a public product-images url, and never writes a price", () => {
    const src = readFileSync("supabase/functions/find-product-image/index.ts", "utf8");
    expect(src).toContain("outboundProductText");
    expect(src).toContain("productImagePatch");
    expect(src).toContain("lookupDecision");
    expect(src).toContain('from("product-images")');
    expect(src).toContain("XAI_API_KEY");
    expect(src).toContain("PRODUCT_IMAGE_SEARCH_KEY");
    expect(src).toContain("LOVABLE_API_KEY");
    expect(src).not.toMatch(/cost_price|selling_price|unit_price/);
    expect(readFileSync("supabase/functions/send-quote-email/index.ts", "utf8")).toContain("unitImageBlock");
    expect(readFileSync("src/lib/quoteSend.ts", "utf8")).toContain("assertQuoteUnitImages");
    expect(readFileSync("src/components/quoting/EstimateBuilder.tsx", "utf8")).toContain("requestProductImages");
  });
});
