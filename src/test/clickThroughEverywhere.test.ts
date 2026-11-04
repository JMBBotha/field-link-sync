import { describe, it, expect } from "vitest";
import { invoiceHref, jobHref, quoteHref, clientHref, projectHref, houseHref, supplierDocHref, supplierHref } from "@/lib/recordLinks";
import { HOUSE_EMBED, invoiceHouseHref } from "@/lib/invoiceHouse";

describe("record links", () => {
  it("builds every record route", () => {
    expect(invoiceHref("i1")).toBe("/admin/invoices/i1");
    expect(jobHref("j1")).toBe("/admin/jobs/j1");
    expect(quoteHref("q1")).toContain("q1");
    expect(clientHref("c1")).toBe("/admin/customers/c1");
    expect(projectHref("p1")).toBe("/admin/projects/p1");
    expect(houseHref("p1", "h1")).toBe("/admin/projects/p1?house=h1");
    expect(supplierDocHref("d1")).toBe("/admin/supplier-docs?doc=d1");
    expect(supplierHref("s1")).toBe("/admin/suppliers?supplier=s1");
  });
  it("invoice house link needs house id + project id", () => {
    expect(HOUSE_EMBED).toContain("id, house_no, project_id");
    expect(invoiceHouseHref({ project_house: { id: "h1", project_id: "p1", house_no: "32" } } as any)).toBe("/admin/projects/p1?house=h1");
    expect(invoiceHouseHref({ project_house: { house_no: "32" } } as any)).toBeNull();
    expect(invoiceHouseHref(null)).toBeNull();
  });
});

import { readFileSync } from "fs";
describe("app-wide click-through", () => {
  it("pipeline menu opens the client; supplier bills link supplier + job", () => {
    expect(readFileSync("src/components/jobs/PipelineBoard.tsx", "utf8")).toContain('label: "Open client"');
    const b = readFileSync("src/pages/admin/AdminSupplierBillsPage.tsx", "utf8");
    expect(b).toContain("bill-supplier-link"); expect(b).toContain("bill-job-link");
  });
});
