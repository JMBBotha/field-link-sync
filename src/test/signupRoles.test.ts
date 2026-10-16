import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { SIGNUP_ROLES, signupMetadata, isAwaitingSignupApproval } from "@/lib/signupRoles";

describe("Five-role sign-up picker", () => {
  it("offers exactly the five approved roles", () => {
    expect(SIGNUP_ROLES.map((r) => r.id)).toEqual(["company_new", "company_tech", "company_sales", "massair_dual", "independent"]);
  });
  it("independents keep the existing participant_type path", () => {
    expect(signupMetadata("independent", { fullName: "A", independentKind: "sales" })).toEqual({ full_name: "A", participant_type: "independent_sales" });
    expect(signupMetadata("independent", { fullName: "A" }).participant_type).toBe("independent_tech");
  });
  it("company roles send signup_role (+company) and never a participant_type", () => {
    const m = signupMetadata("company_tech", { fullName: "B", companyName: "X CC", phone: "082" });
    expect(m).toEqual({ full_name: "B", phone: "082", signup_role: "company_tech", company_name: "X CC" });
    expect(signupMetadata("massair_dual", { fullName: "C", companyName: "ignored" })).toEqual({ full_name: "C", signup_role: "massair_dual" });
  });
  it("pending/rejected company sign-ups are held; old users and approved ones are not", () => {
    expect(isAwaitingSignupApproval({ signup_role: "company_new", network_status: "pending" })).toBe(true);
    expect(isAwaitingSignupApproval({ signup_role: "company_new", network_status: "rejected" })).toBe(true);
    expect(isAwaitingSignupApproval({ signup_role: "company_new", network_status: "approved" })).toBe(false);
    expect(isAwaitingSignupApproval({ onboarding_completed: true })).toBe(false);
    expect(isAwaitingSignupApproval(null)).toBe(false);
  });
  it("Auth keeps sign-in, Forgot? reset and the post-login redirect", () => {
    const src = readFileSync("src/pages/Auth.tsx", "utf8");
    expect(src).toContain("signInWithPassword");
    expect(src).toContain("resolvePostLoginPath");
    expect(src).toContain("window.location.replace(nextPath)");
  });
});
