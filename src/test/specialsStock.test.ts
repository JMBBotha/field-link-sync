import { describe, it, expect, vi } from "vitest";
vi.mock("@/components/calls/CallRecordingPlayer", () => ({ default: () => null }));
import { isSpecialRunning, stockLabel, type SupplierSpecial } from "@/lib/specials";
import { notificationHref } from "@/components/notifications/NotificationsList";
const s: SupplierSpecial = { id: "a", supplier_id: null, model_number: "FCMI-09", supplier_product_id: null, special_cost: 3999, start_date: "2026-10-21", end_date: "2026-10-31", specials_pdf_path: null, notes: null, is_active: true, while_stocks_last: true, units_left: null };
describe("specials stock + reminder", () => {
  it("labels", () => {
    expect(stockLabel(s)).toBe("Limited stock");
    expect(stockLabel({ ...s, units_left: 3 })).toBe("Limited stock · 3 left");
    expect(stockLabel({ ...s, while_stocks_last: false })).toBeNull();
  });
  it("sold out stops the special", () => {
    expect(isSpecialRunning(s, "2026-10-25")).toBe(true);
    expect(isSpecialRunning({ ...s, units_left: 0 }, "2026-10-25")).toBe(false);
  });
  it("bell opens the special's edit", () => {
    expect(notificationHref("special_ending", "a")).toBe("/admin/specials?edit=a");
  });
});
