import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}) } }));
import { QuoteUnitCardsView } from "@/components/quoting/QuoteUnitCards";
export const sampleCard: any = { modelKey: "ar09", modelCode: "AR09BSHGAWK/FA", quantity: 2, rooms: ["Lounge"], brand: "Samsung", btu: 9000, refrigerant: "R32", name: "Samsung AR4500 9K",
  media: { status: "approved", display_name: "Samsung AR4500 9,000 BTU", subtitle: "Inverter wall split", product_url: "https://www.samsung.com/x", support_url: "https://support.example/x", source_label: "samsung.com",
    bullets: ["Fast cooling", "Quiet operation", "Energy saving inverter"], feature_highlight: { title: "WindFree", text: "Cooling without direct draft" }, specs: {} } };
it("unit cards never render outside links or QR (Light + Bold)", () => {
  for (const v of ["light", "bold"] as const) {
    const h = renderToStaticMarkup(<QuoteUnitCardsView cards={[sampleCard]} variant={v} />);
    expect(h).toContain("AR09BSHGAWK/FA");
    expect(h).not.toMatch(/<a\s|href=|samsung\.com|support\.example|Scan for full specs|tap a model|svg\+xml/);
    if (process.env.RENDER_NOLINKS && v === "light") require("fs").writeFileSync("/workspace/quote-unit-cards-2026-10-13/render/nolinks.html", `<html><body style="width:760px;margin:20px;font-family:Arial">${h}</body></html>`);
  }
});
