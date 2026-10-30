import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { isContacted, SummaryText } from "../AdminRequestsPage";

describe("request card", () => {
  it("manual + assigned counts as contacted", () => {
    expect(isContacted({ contacted: undefined, first_contact_at: null, source: "manual", assigned_to: "x" } as any)).toBe(true);
    expect(isContacted({ contacted: false, first_contact_at: null, source: "vapi_call", assigned_to: null, job_id: null, scheduled_for: null } as any)).toBe(false);
  });
  it("map pin url becomes Open map", () => {
    render(<SummaryText text="Map pin: https://maps.app.goo.gl/TYtEmuAmV2TJ8G1V6 (-34.0103215, 18.4065061)." />);
    expect(screen.getByText("Open map").getAttribute("href")).toBe("https://maps.app.goo.gl/TYtEmuAmV2TJ8G1V6");
    expect(screen.queryByText(/goo\.gl/)).toBeNull();
  });
});
import { requestStatus, friendlyWhen, shortArea } from "../AdminRequestsPage";
describe("status line", () => {
  it("booked reads friendly", () => {
    expect(friendlyWhen("2026-11-10", "08:00:00")).toBe("Tue 10 Nov, 08:00");
    expect(requestStatus({ status: "open", type: "service", source: "manual", assigned_to: "x", assigned_name: "Innocent Mattienga ", scheduled_for: "2026-11-10", scheduled_time: "08:00:00" } as any).text)
      .toBe("Assigned to Innocent Mattienga · Tue 10 Nov, 08:00");
    expect(shortArea({ area: null, address: "5 Camelot, Rhodes Drive, Constantia, Cape Town, 7606, Constantia" })).toBe("Constantia");
  });
});
