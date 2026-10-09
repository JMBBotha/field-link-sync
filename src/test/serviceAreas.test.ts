import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { describeRoute } from "@/lib/serviceAreas";

describe("P6 service areas", () => {
  it("describes routing results in plain words", () => {
    expect(describeRoute({ mode: "suggest", same_company: true, area: "North", km: 1.9 })).toBe('In your area "North" (1.9 km from centre)');
    expect(describeRoute({ mode: "suggest", same_company: false, area: "Durbanville", company: "0800-BE-COOL", km: 0.5 })).toBe('Best covered by 0800-BE-COOL – "Durbanville" (0.5 km from centre)');
    expect(describeRoute({ mode: "refused", reason: "Lead has open offers" })).toBe("Not moved: Lead has open offers");
    expect(describeRoute({ mode: "no_match", reason: null })).toBe("No service area covers this address");
  });
  it("areas page is admin-only, hidden from salespeople, and the move button is master-only", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toMatch(/path="areas" element=\{<RequireRole allowedRoles=\{\["admin"\]\} denySalesRep><AdminAreasPage \/>/);
    const page = readFileSync("src/pages/admin/AdminAreasPage.tsx", "utf8");
    expect(page).toMatch(/!r\.same_company && data\.isMaster/);
    expect(page).not.toMatch(/functions\.invoke\("(send|notify|whatsapp|email)/i);
  });
});
