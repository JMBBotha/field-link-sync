import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
import { QuoteUnitCardsView } from "@/components/quoting/QuoteUnitCards";
export const sampleCard: any = { modelKey: "AR09BSHGAWK/FA", modelCode: "AR09BSHGAWK/FA", quantity: 2, rooms: ["Lounge"], brand: "Samsung", btu: 9000, refrigerant: "R32", name: "Samsung AR4500 9K",
  media: { status: "approved", display_name: "Samsung AR4500 9,000 BTU", subtitle: "Inverter wall split", product_url: "https://www.samsung.com/x", support_url: "https://support.example/x", source_label: "samsung.com",
    bullets: ["Fast cooling", "Quiet operation", "Energy saving inverter"], feature_highlight: { title: "WindFree", text: "Cooling without direct draft" }, specs: {} } };
const CO = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
it("unit cards link only to OUR brochure page, with QR (Light + Bold); never outside sites", () => {
  for (const v of ["light", "bold"] as const) {
    const h = renderToStaticMarkup(<QuoteUnitCardsView cards={[sampleCard]} variant={v} companyId={CO} />);
    expect(h).toContain("AR09BSHGAWK/FA");
    const hrefs = [...h.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
    expect(new Set(hrefs)).toEqual(new Set([`https://field-link-sync.lovable.app/u/ar09bshgawk-fa?c=${CO}`]));
    expect(h).toContain("View brochure");
    expect(h).toContain('data-testid="unit-card-qr"');
    expect(h).toContain('aria-label="Brochure for AR09BSHGAWK/FA"');
    expect(h).toContain('data-pdf-keep');
    expect(h).not.toContain('data:image/svg+xml');
    expect(h).not.toMatch(/samsung\.com|support\.example|aermart|fourways/i);
  }
});

it("models without approved content: no QR, no button, no link", () => {
  const draft = { ...sampleCard, media: { ...sampleCard.media, status: "draft" } };
  const h = renderToStaticMarkup(<QuoteUnitCardsView cards={[draft]} companyId={CO} />);
  expect(h).not.toMatch(/href=|View brochure|unit-card-qr/);
});
