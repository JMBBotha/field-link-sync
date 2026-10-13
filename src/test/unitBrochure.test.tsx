import { it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => ({}) } }));
import { UnitBrochureView } from "@/pages/public/UnitBrochurePage";
import { unitBrochureUrl, brochureSpecRows } from "@/lib/unitBrochure";

const media: any = { model_key: "AR09BSHGAWK/FA", model_code: "AR09BSHGAWK/FA", brand: "Samsung", family: "AR4500", display_name: "Samsung AR4500 Digital Inverter", subtitle: "9,000 BTU/h class wall split",
  image_url: "/product-media/seed/ar09bshgawk-fa.png", bullets: ["Cooling and heating"], feature_highlight: { title: "Digital Inverter", text: "Steady." },
  specs: { cool_kw: 2.5, refrigerant: "R410A", indoor_dim_mm: "790x275x200", indoor_net_kg: 9, product_price: 1 } };
const company: any = { company_id: "c1", name: "Acme Cooling", legal_name: "Acme Cooling (Pty) Ltd", phone: "011 000 0000", email: "a@acme.test", document_style: "bold", logo_url: null };

it("url uses our domain and a slug", () => {
  expect(unitBrochureUrl("AR09BSHGAWK/FA", "c1")).toBe("https://field-link-sync.lovable.app/u/ar09bshgawk-fa?c=c1");
});
it("approved page: company branding, net dims only when filled, no links, no prices, E&OE", () => {
  const h = renderToStaticMarkup(<UnitBrochureView data={{ state: "approved", model_code: "AR09BSHGAWK/FA", media, company }} />);
  expect(h).toContain("Supplied and installed by Acme Cooling");
  expect(h).toContain("ub bold");
  expect(h).toContain("790 × 275 × 200 mm");
  expect(h).toContain("9 kg");
  expect(h).not.toContain("Outdoor unit, net");
  expect(h).toContain("E&amp;OE");
  expect(h).not.toMatch(/<a\s|href=|R\s?[\d ,]+\.\d\d/);
});
it("not approved: neutral fallback, no specs", () => {
  const h = renderToStaticMarkup(<UnitBrochureView data={{ state: "not_approved", model_code: "AR09BSHGAWK/FA", media: null, company: null }} />);
  expect(h).toContain('data-testid="brochure-fallback"');
  expect(h).not.toContain("<table");
  expect(brochureSpecRows({}, "X")).toEqual([["Model", "X"]]);
});
