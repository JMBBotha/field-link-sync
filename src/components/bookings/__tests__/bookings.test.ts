import { describe, it, expect } from "vitest";
import { bookingStage, bookingLine, bookingHref, type Booking } from "../Bookings";
const ric: Booking = { id: "L1", customer_id: "C", customer_name: "Ric", address: null, intent: "service", service_type: "Technical/Repairs", source: "manual",
  created_at: "2026-10-29T10:35:40Z", first_contact_at: null, scheduled_date: "2026-11-10", scheduled_time: "08:00:00", assigned_to: "T", assigned_name: "Innocent Mattienga", has_quote: false };
describe("bookings", () => {
  it("booked line", () => { expect(bookingStage(ric)).toBe("booked"); expect(bookingLine(ric)).toBe("Assigned to Innocent Mattienga · Tue 10 Nov, 08:00"); });
  it("stages", () => { expect(bookingStage({ ...ric, scheduled_date: null })).toBe("assigned"); expect(bookingStage({ ...ric, scheduled_date: null, assigned_to: null, source: "website_form" })).toBe("new"); });
  it("href", () => { expect(bookingHref(ric, true)).toBe("/admin/bookings/L1"); expect(bookingHref(ric, false)).toBe("/admin/bookings/L1"); });
});
