import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { pickJobCoords, isOpenJobStatus } from "@/lib/jobPins";

const src = (p: string) => readFileSync(p, "utf8");

describe("map toolbar is clickable on desktop", () => {
  it("desktop toolbar and search re-enable pointer events", () => {
    const s = src("src/pages/admin/AdminMapPage.tsx");
    expect(s).toContain('hidden lg:flex items-center gap-1 pointer-events-auto');
    expect(s).toContain('max-w-sm pointer-events-auto');
    expect(s).toContain("JobPinsLayer");
    expect(s).toContain('data-testid="map-jobs-chip"');
  });
});

describe("job pins", () => {
  it("open vs closed statuses", () => {
    expect(isOpenJobStatus("scheduled")).toBe(true);
    expect(isOpenJobStatus("in_progress")).toBe(true);
    expect(isOpenJobStatus("completed")).toBe(false);
    expect(isOpenJobStatus("cancelled")).toBe(false);
  });
  it("coords fall back job -> lead -> customer", () => {
    const leads = new Map([["l1", { lat: -34.1, lng: 18.8 }]]);
    const custs = new Map([["c1", { lat: -33.9, lng: 18.4 }]]);
    expect(pickJobCoords({ id: "a", lat: -30, lng: 20 }, leads, custs)).toEqual({ lat: -30, lng: 20 });
    expect(pickJobCoords({ id: "b", lat: null, lng: null, lead_id: "l1", customer_id: "c1" }, leads, custs)).toEqual({ lat: -34.1, lng: 18.8 });
    expect(pickJobCoords({ id: "c", lat: 0, lng: 0, customer_id: "c1" }, leads, custs)).toEqual({ lat: -33.9, lng: 18.4 });
    expect(pickJobCoords({ id: "d" }, leads, custs)).toBeNull();
  });
});

describe("dead links/buttons", () => {
  it("customer quote row opens the quote builder", () => {
    expect(src("src/pages/admin/AdminCustomerDetailPage.tsx")).not.toContain("/admin/quotes/${");
  });
  it("no dead QR button, bell navigates, edit wired", () => {
    expect(src("src/pages/FBQuoteBuilderPage.tsx")).not.toContain("<QrCode");
    expect(src("src/components/freshbooks/FBLayout.tsx")).toContain('navigate("/admin/notifications")');
    expect(src("src/components/CustomerProfile.tsx")).toContain("navigate(`/admin/customers/${customerId}`)");
  });
});
