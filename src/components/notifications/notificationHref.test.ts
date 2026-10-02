import { describe, it, expect, vi } from "vitest";
vi.mock("@/components/calls/CallRecordingPlayer", () => ({ default: () => null }));
import { notificationHref } from "./NotificationsList";

const L = "2d1db6af-3642-4ede-a0da-3f5e76945079";
describe("notificationHref", () => {
  it("lead-id bells open the lead's Job Details sheet", () => {
    for (const t of ["lead_assigned", "new_lead", "job_schedule", "entity_update", "job_status_change", "lead_sla_breach"]) {
      expect(notificationHref(t, L)).toBe(`/admin/dispatch?lead=${L}`);
    }
    expect(notificationHref("lead_assigned", null)).toBe("/admin/dispatch");
  });
  it("keeps job / quote / invoice / call / ready-to-invoice targets", () => {
    expect(notificationHref("assignment_created", "j1")).toBe("/admin/jobs/j1");
    expect(notificationHref("quote_status_change", "q1")).toBe("/admin/estimates/q1");
    expect(notificationHref("invoice_paid", "i1")).toBe("/admin/invoices/i1");
    expect(notificationHref("call_logged", "c1")).toBe("/admin/calls");
    expect(notificationHref("invoice_ready", L)).toBe("/admin#ready-to-invoice");
  });
  it("techs stay in /field", () => {
    expect(notificationHref("lead_assigned", L, true)).toBe("/field");
    expect(notificationHref("assignment_created", "j1", true)).toBe("/field/jobs/j1");
  });
});
