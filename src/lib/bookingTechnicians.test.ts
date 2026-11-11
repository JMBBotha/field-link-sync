import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID } from "@/lib/adminHomeCount";
import { bookingTechnicians, bookingTechListState, type BookingTechRow } from "@/lib/bookingTechnicians";

const CT = MASSAIR_CT_ID;

function row(over: Partial<BookingTechRow> & Pick<BookingTechRow, "id" | "full_name">): BookingTechRow {
  return {
    company_id: CT,
    dispatch_role: "technician",
    participant_type: "company_staff",
    dispatch_active: true,
    archived_at: null,
    availability_status: "offline",
    ...over,
  };
}

describe("booking technicians", () => {
  const rows: BookingTechRow[] = [
    row({ id: "innocent", full_name: "Innocent Mattienga ", availability_status: "offline" }),
    row({ id: "sales", full_name: "Sales Rep", dispatch_role: "sales", availability_status: "available" }),
    row({ id: "admin", full_name: "Office Admin", dispatch_role: null, availability_status: "available" }),
    row({ id: "hvac", full_name: "Company B Tester", company_id: TEST_HVAC_ID, availability_status: "available" }),
    row({ id: "ind", full_name: "Ind Tech", company_id: MASSAIR_IND_ID, availability_status: "available" }),
    row({ id: "paused", full_name: "Paused Tech", dispatch_active: false }),
    row({ id: "old", full_name: "Archived Tech", archived_at: "2026-10-08T12:44:37Z" }),
    row({ id: "free", full_name: "Freelance Tech", dispatch_role: null, participant_type: "independent_tech" }),
    row({ id: "role-only", full_name: "Role Only", dispatch_role: null }),
  ];

  it("lists the company's technicians even when they are offline", () => {
    expect(bookingTechnicians(rows, CT).map((t) => t.name)).toEqual(["Freelance Tech", "Innocent Mattienga"]);
  });

  it("drops Test HVAC and archived Massair Ind, including when that company is signed in", () => {
    expect(bookingTechnicians(rows, TEST_HVAC_ID)).toEqual([]);
    expect(bookingTechnicians(rows, MASSAIR_IND_ID)).toEqual([]);
    expect(bookingTechnicians(rows, null)).toEqual([]);
    expect(bookingTechnicians(rows, "")).toEqual([]);
  });

  it("tells a missing company and a failed read apart from a company with no technicians", () => {
    const base = {
      companyId: CT, companyLoading: false, companyError: false, accessLoading: false, canLog: true,
      queryEnabled: true, isPending: false, isFetching: false, isError: false, count: 0,
    };
    expect(bookingTechListState({ ...base, companyId: null, companyLoading: true })).toBe("loading");
    expect(bookingTechListState({ ...base, companyId: null, companyLoading: false, companyError: true })).toBe("error");
    expect(bookingTechListState({ ...base, isPending: true, count: 0 })).toBe("loading");
    expect(bookingTechListState({ ...base, isError: true })).toBe("error");
    expect(bookingTechListState(base)).toBe("empty");
    expect(bookingTechListState({ ...base, count: 1 })).toBe("ready");
    expect(bookingTechListState({ ...base, canLog: false, accessLoading: true, isPending: true })).toBe("loading");
    expect(bookingTechListState({ ...base, canLog: false, accessLoading: false })).toBe("hidden");
    expect(bookingTechListState({ ...base, companyId: TEST_HVAC_ID, count: 3 })).toBe("empty");
    expect(bookingTechListState({ ...base, queryEnabled: false, isPending: true })).toBe("empty");
  });

  it("book a job, the job page, and the project house share this list", () => {
    const read = (p: string) => readFileSync(p, "utf8");
    for (const file of ["src/components/jobs/CreateJobDialog.tsx", "src/components/jobs/LoggedWorkPanel.tsx"]) {
      const src = read(file);
      expect(src).toContain("useBookingTechnicians");
      expect(src).not.toMatch(/rpc\(\s*["']dispatchable_technicians/);
    }
    expect(read("src/components/scheduling/AppointmentPicker.tsx")).toContain("useLaneStaff");
    expect(read("src/hooks/useBookingTechnicians.ts")).toContain("bookingTechnicians");
    expect(read("src/hooks/useBookingTechnicians.ts")).not.toContain("availability_status");
    expect(read("src/hooks/useBookingTechnicians.ts")).toContain("staleTime: 0");
    expect(read("src/pages/BookJobHarness.tsx")).toContain("bookingTechnicians");
    expect(read("src/pages/BookJobHarness.tsx")).toContain("Innocent Mattienga");
    expect(read("src/components/admin/AdminLayout.tsx")).toContain("authOutletPlan");
    expect(read("src/components/admin/AdminLayout.tsx")).not.toContain("[authLoading, session, user]");
    expect(read("src/components/jobs/calm/JobsCalm.tsx")).toContain('context="jobs"');
    expect(read("src/components/jobs/calm/JobsCalm.tsx")).toContain("readBookJobDraft");
    expect(read("src/contexts/AuthContext.tsx")).toContain('if (_event === "SIGNED_OUT") clearAllBookJobDrafts()');
  });
});
