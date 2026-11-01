import { describe, it, expect } from "vitest";
import { bookingPatch, bookingStatus, editableBookingFields } from "@/lib/bookingEdit";

const before = { date: "2030-01-01", time: "08:00:00", notes: "old", service: "Service", address: "9 Demo Rd" };
describe("booking edit rules", () => {
  it("admin/linked admin get everything; rep gets date, time, notes; others nothing", () => {
    expect(editableBookingFields({ admin: true, rep: false })).toMatchObject({ any: true, service: true, address: true, notes: true });
    expect(editableBookingFields({ admin: false, rep: true })).toMatchObject({ any: true, date: true, time: true, notes: true, service: false, address: false });
    expect(editableBookingFields({ admin: false, rep: false }).any).toBe(false);
    expect(editableBookingFields(null).any).toBe(false);
  });
  it("sends only changed fields and never admin fields for a rep", () => {
    const after = { date: "2030-02-02", time: "08:00", notes: "new", service: "Install", address: "1 Demo St" };
    expect(bookingPatch({ admin: false, rep: true }, before, after)).toEqual({ p_date: "2030-02-02", p_notes: "new" });
    expect(bookingPatch({ admin: true, rep: false }, before, after)).toEqual({ p_date: "2030-02-02", p_notes: "new", p_service_type: "Install", p_address: "1 Demo St" });
    expect(bookingPatch({ admin: true, rep: false }, before, { date: "2030-01-01", time: "08:00", notes: "old ", service: "Service", address: "9 Demo Rd" })).toEqual({});
  });
  it("clearing notes is a change", () => {
    expect(bookingPatch({ admin: false, rep: true }, before, { ...before, time: "08:00", notes: "" })).toEqual({ p_notes: "" });
  });
  it("shows a real status", () => {
    expect(bookingStatus("pending", "classified", false).label).toMatch(/Pending/);
    expect(bookingStatus("pending", "classified", true).label).toBe("Booked");
    expect(bookingStatus("cancelled").tone).toBe("red");
  });
});
