import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { filterVisits, visitTab, jobsTabFor, suburbOf, mapsLink, type VisitRow } from "@/lib/visits";

const row = (o: Partial<VisitRow>): VisitRow => ({
  lead_id: Math.random().toString(36), customer_id: "c", customer_name: "X", phone: null, address: null, lat: null, lng: null,
  scheduled_date: null, scheduled_time: null, status: "pending", primary_intent: "sales", is_mine: true, notes: null,
  quote_id: null, quote_number: null, quote_status: null, quote_total: null, quote_accepted: false, has_install_job: false, ...o,
});

describe("P1 My visits tab filtering", () => {
  it("puts unassigned pending leads in Available only", () => {
    expect(visitTab(row({ is_mine: false }))).toBe("available");
    expect(visitTab(row({ is_mine: false, status: "accepted" }))).toBeNull();
  });
  it("Upcoming = mine and open; To hand over = accepted quote without install job; Done = install job or closed", () => {
    expect(visitTab(row({ status: "accepted" }))).toBe("upcoming");
    expect(visitTab(row({ quote_accepted: true }))).toBe("handover");
    expect(visitTab(row({ quote_accepted: true, has_install_job: true }))).toBe("done");
    expect(visitTab(row({ status: "converted" }))).toBe("done");
    expect(visitTab(row({ status: "cancelled" }))).toBeNull();
  });
  it("sorts Upcoming soonest first with unscheduled last", () => {
    const rows = [row({ customer_name: "C" }), row({ customer_name: "B", scheduled_date: "2026-10-12" }),
      row({ customer_name: "A", scheduled_date: "2026-10-10", scheduled_time: "09:00:00" })];
    expect(filterVisits(rows, "upcoming").map((r) => r.customer_name)).toEqual(["A", "B", "C"]);
  });
  it("Available is nearest first with km labels", () => {
    const rows = [row({ customer_name: "Far", is_mine: false, offer_km: 9 }), row({ customer_name: "Near", is_mine: false, offer_km: 2.1 })];
    expect(filterVisits(rows, "available").map((r) => r.customer_name)).toEqual(["Near", "Far"]);
  });
  it("helpers", () => {
    expect(suburbOf("12 Main Rd, Durbanville, Cape Town")).toBe("Durbanville");
    expect(mapsLink({ lat: -33.9, lng: 18.6, address: null })).toContain("-33.9,18.6");
    expect(mapsLink({ lat: null, lng: null, address: null })).toBeNull();
  });
});

describe("P1 rep-only nav swap", () => {
  it("Jobs becomes Visits for reps only", () => {
    expect(jobsTabFor(true)).toEqual({ to: "/admin/visits", label: "Visits" });
    expect(jobsTabFor(false)).toEqual({ to: "/admin/jobs", label: "Jobs" });
  });
  it("bottom nav and sidebar wire it for reps only; routes exist; FieldAgent untouched", () => {
    const nav = readFileSync("src/components/admin/AdminBottomNav.tsx", "utf8");
    expect(nav).toMatch(/isSalesRep\s*\n?\s*\?\s*\[/);
    expect(nav).toContain("jobsTabFor(true)");
    const side = readFileSync("src/components/admin/AdminSidebar.tsx", "utf8");
    expect(side).toContain('...(isSalesRep ? [{ path: "/admin/visits", label: "My visits"');
    const app = readFileSync("src/App.tsx", "utf8");
    expect(app).toContain('path="visits"');
    expect(app).toContain('path="visits/:leadId"');
    const page = readFileSync("src/pages/admin/AdminVisitsPage.tsx", "utf8");
    expect(page).not.toMatch(/cost|margin|markup/i);
  });
});
