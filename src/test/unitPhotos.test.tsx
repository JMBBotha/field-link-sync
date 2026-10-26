import { it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
import { QuoteUnitCardsView } from "@/components/quoting/QuoteUnitCards";
import { sampleCard } from "./unitCardsNoLinks.test";
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const URL = "https://rvzapfbifggovccebrjp.supabase.co/storage/v1/object/public/product-media/samsung/ar09bshgawk-fa.png";

it("approved ready photo shows the real image; Samsung source never on the card", () => {
  const c = { ...sampleCard, media: { ...sampleCard.media, image_status: "ready", image_url: URL, image_source_url: "https://images.samsung.com/x", image_licence_note: "Representative sibling" } };
  const h = renderToStaticMarkup(<QuoteUnitCardsView cards={[c]} companyId={CO} />);
  expect(h).toContain(URL);
  expect(h).not.toMatch(/images\.samsung|Representative sibling|Photo to follow/);
});

it("no photo: neutral 'Photo to follow' placeholder, no drawn unit mock-up", () => {
  for (const media of [null, { ...sampleCard.media, status: "draft" }, { ...sampleCard.media, image_status: "none", image_url: null }]) {
    const h = renderToStaticMarkup(<QuoteUnitCardsView cards={[{ ...sampleCard, media }]} companyId={CO} />);
    expect(h).toContain("Photo to follow");
    expect(h).toContain('data-testid="unit-card-photo-placeholder"');
    expect(h).not.toContain('viewBox="0 0 132 56"');
  }
});

it("photo migration: 12 photos, sibling flagged, files present", () => {
  const sql = readFileSync("supabase/migrations/20261026150000_unit_photos_samsung.sql", "utf8");
  const files = [...sql.matchAll(/'samsung\/([a-z0-9-]+\.png)'/g)].map((m) => m[1]);
  expect(files).toHaveLength(12);
  for (const f of files) expect(readFileSync(`scripts/product-media/samsung/${f}`).length).toBeGreaterThan(1000);
  expect(sql).toMatch(/AJ071TNLPKH\/EA[^\n]*Representative sibling/);
  expect(sql).not.toMatch(/AJ052TN1DKH|AJ140TXJ5KH|AC071RN4DKG/);
});
