import { describe, it, expect } from "vitest";
import { isRootPath, parentPath } from "@/lib/backNav";
describe("back arrow rules", () => {
  it("hidden on root tabs", () => {
    for (const p of ["/admin", "/admin/", "/admin/jobs", "/admin/visits", "/admin/customers", "/field", "/field/schedule", "/client/abc/dashboard", "/customer/tok"])
      expect(isRootPath(p)).toBe(true);
  });
  it("shown elsewhere", () => {
    for (const p of ["/admin/quotes", "/admin/invoices/1", "/admin/customers/1", "/field/jobs/9", "/admin/settings"]) expect(isRootPath(p)).toBe(false);
  });
  it("fallback parent routes", () => {
    expect(parentPath("/admin/invoices/1")).toBe("/admin/invoices");
    expect(parentPath("/admin/customers/1")).toBe("/admin/customers");
    expect(parentPath("/admin/estimates/1")).toBe("/admin/quotes");
    expect(parentPath("/admin/jobs/5")).toBe("/admin/jobs?tab=pipeline");
    expect(parentPath("/field/jobs/9")).toBe("/field");
    expect(parentPath("/admin/settings")).toBe("/admin");
    expect(parentPath("/admin/reports/vat")).toBe("/admin/reports");
    expect(parentPath("/client/c1/invoices")).toBe("/client/c1");
  });
});
