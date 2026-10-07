import { describe, expect, it } from "vitest";
import { resolveLane } from "@/hooks/useLaneStaff";

describe("dispatch staff lanes", () => {
  it("uses profile dispatch roles without relying on user roles", () => {
    expect(resolveLane({ dispatch_role: "sales", roles: ["field_agent"] })).toBe("sales");
    expect(resolveLane({ dispatch_role: "technician", roles: ["admin"] })).toBe("service");
    expect(resolveLane({ roles: ["field_agent"] })).toBeNull();
  });

  it("keeps independent technicians in the service lane", () => {
    expect(resolveLane({ dispatch_role: "sales", participant_type: "independent_tech" })).toBe("service");
  });
});