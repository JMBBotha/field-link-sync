import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { shortDueLabel, dueRowTitle } from "@/lib/invoiceDue";
import { buildActivity } from "@/components/customers/ClientV8Parts";
import { formFromHouse } from "@/components/projects/HouseDrawer";

describe("Invoices due rows (390px)", () => {
  it("shortens on-completion labels", () => {
    expect(shortDueLabel("Due on completion (installation not booked yet)")).toBe("Due on completion · not booked");
    expect(shortDueLabel("Due on completion (installation booked 3 Nov)")).toBe("Due on completion · booked 3 Nov");
    expect(shortDueLabel("3 days late")).toBe("3 days late");
  });
  it("builds line 1 with house, invoice and amount", () => {
    expect(dueRowTitle("House 7", "INV-0000001", "R 1 000.00")).toBe("House 7 · INV-0000001 · R 1 000.00");
    expect(dueRowTitle(null, null, "R 5.00")).toBe("Invoice (draft) · R 5.00");
  });
  it("row is stacked, not squeezed by the pill", () => {
    const src = readFileSync("src/pages/admin/AdminCustomerDetailPage.tsx", "utf8");
    expect(src).toContain('data-testid="invoice-due-row" className="flex flex-col');
    expect(src).toContain("<InvoiceDueChip short");
  });
});

describe("Activity job rows open the job", () => {
  it("carries jobId", () => {
    const items = buildActivity({ jobLog: [{ id: "1", job_id: "job-a", created_at: "2026-11-03T10:00:00Z", action: "assigned" }], jobTitle: new Map([["job-a", "Installation — Test Estate House 7"]]) } as any);
    expect(items[0].jobId).toBe("job-a");
    expect(readFileSync("src/components/customers/ClientV8Parts.tsx", "utf8")).toContain("jobHref(");
  });
});

describe("House tile opens drawer", () => {
  it("form comes straight from the row", () => {
    const f = formFromHouse({ house_no: "7", phase_id: null, po_number: null, make: null, unit_sizes: null, units_ordered: 0, units_received: 0, ready_for_aircon: false, ready_for_aircon_at: null, status_override: null, notes: null } as any);
    expect(f.house_no).toBe("7");
  });
  it("tile has a real button, drawer has an error boundary, site map polygons take taps", () => {
    expect(readFileSync("src/components/projects/ProjectView.tsx", "utf8")).toContain('<button type="button" data-testid="house-open"');
    expect(readFileSync("src/components/projects/HouseDrawer.tsx", "utf8")).toContain("<PanelErrorBoundary");
    expect(readFileSync("src/components/projects/SiteMap.tsx", "utf8")).toMatch(/polygon[^>]*pointerEvents="all" onClick/);
  });
});
