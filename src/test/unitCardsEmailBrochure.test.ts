import { it, expect } from "vitest";
import { loadUnitCardsStripHtml, brochureUrl } from "../../supabase/functions/_shared/unitCardsEmail";
const chain = (data: any) => { const c: any = { select: () => c, eq: () => c, in: () => c, is: () => c, maybeSingle: async () => ({ data }), then: (r: any) => r({ data }) }; return c; };
it("email strip: 'View brochure' button to our own page only", async () => {
  const sb = { from: (t: string) => t === "quotes" ? chain({ show_unit_cards: true, company_id: "c1" })
    : t === "quote_items" ? chain([{ item_type: "unit", item_number: "AR09BSHGAWK/FA" }])
    : chain([{ model_key: "AR09BSHGAWK/FA", model_code: "AR09BSHGAWK/FA", display_name: "AR4500", image_url: "https://x/img.png", image_status: "ready" }]) };
  const h = await loadUnitCardsStripHtml(sb, "q1");
  expect(h).toContain("View brochure");
  expect(h).toContain(`href="${brochureUrl("AR09BSHGAWK/FA", "c1")}"`);
  expect(brochureUrl("AR09BSHGAWK/FA", "c1")).toBe("https://field-link-sync.lovable.app/u/ar09bshgawk-fa?c=c1");
});
