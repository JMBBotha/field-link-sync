import { describe, it, expect } from "vitest";
import { staffOf, freelancersOf, applicationsOf, mapDispatchCandidates } from "@/lib/teamGroups";

const affs = [
  { profile_id: "innocent", status: "active", listed_as_staff: true },
  { profile_id: "free", status: "active", listed_as_staff: false },
];
const people = [
  { id: "innocent", participant_type: "independent_tech", network_status: "approved", archived_at: null },
  { id: "free", participant_type: "independent_tech", network_status: "approved", archived_at: null },
  { id: "rej", participant_type: "independent_sales", network_status: "rejected", archived_at: null },
  { id: "loose", participant_type: "independent_tech", network_status: "approved", archived_at: null },
  { id: "pend", participant_type: "independent_sales", network_status: "pending", archived_at: null },
  { id: "gone", participant_type: "independent_tech", network_status: "pending", archived_at: "2026-10-01" },
];
const staff = [
  { id: "emp", participant_type: "employee", archived_at: null },
  { id: "oldemp", participant_type: "employee", archived_at: "2026-10-01" },
  people[0], people[1],
];

describe("teamGroups", () => {
  it("listed_as_staff stays in Staff; freelancers and archived leave", () => {
    expect(staffOf(staff, affs).map((p) => p.id)).toEqual(["emp", "innocent"]);
  });
  it("approved + connected -> Freelancers", () => {
    expect(freelancersOf(people, affs).map((p) => p.id)).toEqual(["free"]);
  });
  it("pending first, approved-not-connected next, rejected last; archived nowhere", () => {
    expect(applicationsOf(people, affs).map((p) => p.id)).toEqual(["pend", "loose", "rej"]);
  });
  it("dispatch mapping keeps only RPC rows", () => {
    expect(mapDispatchCandidates([{ profile_id: "t1", full_name: "T", participant_type: "employee", assignment_type: "internal" }]))
      .toEqual([{ id: "t1", full_name: "T", participant_type: "employee", assignment_type: "internal" }]);
    expect(mapDispatchCandidates(null)).toEqual([]);
  });
});
