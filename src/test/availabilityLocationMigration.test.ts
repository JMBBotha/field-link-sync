import { describe, expect, it } from "vitest";
import migration from "../../supabase/migrations/20261105190000_availability_schedule_location.sql?raw";

describe("availability location migration", () => {
  it("scopes Live Map reads to one company and does not add a second booking check", () => {
    expect(migration).toContain("Company ops can view staff locations");
    expect(migration).toContain("NOT public.is_sales_rep(auth.uid())");
    expect(migration).toContain("location share is off");
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\._tech_offer_fit/);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\._person_bookings/);
    expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.booking_clashes/);
    expect(migration).toContain("ARRAY[1, 2, 3, 4, 5]");
    expect(migration).toContain("'07:00'");
    expect(migration).toContain("'18:00'");
    expect(migration).toContain("Africa/Johannesburg");
  });
});
