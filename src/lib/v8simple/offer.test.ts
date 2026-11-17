import { describe, it, expect } from "vitest";
import { V8_REP_OFFERS_DEFAULT, v8LeadOffer } from "@/lib/v8simple/offer";

describe("sales lead offer", () => {
  it("stays off by default and never puts a client name in the push", () => {
    expect(V8_REP_OFFERS_DEFAULT).toBe(false);
    expect(v8LeadOffer(false, { work: "Installation", area: "Southern suburbs", clientName: "Demo client A" })).toBeNull();
    const on = v8LeadOffer(true, { work: "Installation", area: "Southern suburbs", clientName: "Demo client A" });
    expect(on).toMatchObject({ work: "Installation", area: "Southern suburbs", clock: "5:00" });
    expect(on?.push).toBe("Installation lead · Southern suburbs · tap to view");
    expect(JSON.stringify(on)).not.toMatch(/Demo client/);
  });
});
