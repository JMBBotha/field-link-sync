import { describe, expect, it } from "vitest";
import { dispatchTechPhase, heldCompanyId } from "@/lib/techPicker";
import { canCancelVisit, cancelVisitReasonLabel } from "@/lib/cancelVisit";
import { groupSalespersonPlan } from "@/lib/quoteStaffActions";

const pending = { companyId: "co", isPending: true, isFetching: false, isError: false, count: 0 };

describe("dispatch technician menu", () => {
  it("treats a query that has not finished as loading, not an empty company", () => {
    expect(dispatchTechPhase(pending)).toBe("loading");
    expect(dispatchTechPhase({ ...pending, isPending: false, isFetching: true })).toBe("loading");
    expect(dispatchTechPhase({ ...pending, companyId: null, companyLoading: true, isPending: false })).toBe("loading");
  });
  it("shows an error with a retry when the company or the read failed", () => {
    expect(dispatchTechPhase({ ...pending, isPending: false, companyId: null })).toBe("error");
    expect(dispatchTechPhase({ ...pending, isPending: false, isError: true })).toBe("error");
    expect(dispatchTechPhase({ ...pending, isPending: false, companyError: true })).toBe("error");
  });
  it("only says empty after a finished read", () => {
    expect(dispatchTechPhase({ ...pending, isPending: false })).toBe("empty");
    expect(dispatchTechPhase({ ...pending, isPending: false, count: 2 })).toBe("ready");
  });
  it("keeps a company id that flickered off", () => {
    expect(heldCompanyId(null, "co")).toBe("co");
    expect(heldCompanyId("next", "co")).toBe("next");
    expect(heldCompanyId(null, null)).toBeNull();
  });
});

describe("cancel visit permissions and reasons", () => {
  it("lets admin, office and the client's rep cancel", () => {
    expect(canCancelVisit({ admin: true })).toBe(true);
    expect(canCancelVisit({ office: true })).toBe(true);
    expect(canCancelVisit({ rep: true })).toBe(true);
    expect(canCancelVisit({ admin: false, office: false, rep: false })).toBe(false);
    expect(canCancelVisit(null)).toBe(false);
  });
  it("names the three reasons", () => {
    expect(cancelVisitReasonLabel("no_show")).toBe("No-show");
    expect(cancelVisitReasonLabel("cancelled_by_client")).toBe("Cancelled by client");
    expect(cancelVisitReasonLabel("no_longer_needed")).toBe("No longer needed");
  });
});

describe("option group salesperson", () => {
  it("asks before changing every option, and skips a quote that is on its own", () => {
    const group = { id: "a", option_group_id: "g", quote_number: "Q-1" };
    expect(groupSalespersonPlan(group, [{ id: "a", quote_number: "Q-1" }, { id: "b", quote_number: "Q-2" }])).toEqual({
      count: 2, numbers: ["Q-1", "Q-2"],
    });
    expect(groupSalespersonPlan({ id: "a", option_group_id: null }, [])).toBeNull();
    expect(groupSalespersonPlan(group, [{ id: "a", quote_number: "Q-1" }])).toBeNull();
  });
});
