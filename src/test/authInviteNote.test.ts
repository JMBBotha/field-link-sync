import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("Sign-in page: invited-staff password note", () => {
  const src = readFileSync("src/pages/Auth.tsx", "utf8");
  it("shows the note on the login form with the approved welcome wording", () => {
    expect(src).toContain('data-testid="invite-password-note"');
    expect(src).toContain("New to the team, add email address, and click forgot password.");
    expect(src).not.toContain("Invited to the team?");
    expect(src).not.toContain("New team member, add email address and click add email, tap forgot password.");
    expect((src.match(/onClick=\{sendPasswordLink\}/g) || []).length).toBe(1);
    expect(src).toContain("resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/set-password` })");
  });
});
