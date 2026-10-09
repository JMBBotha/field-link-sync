import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("Sign-in page: invited-staff password note", () => {
  const src = readFileSync("src/pages/Auth.tsx", "utf8");
  it("shows the note on the login form and links it to the forgot-password flow", () => {
    expect(src).toContain('data-testid="invite-password-note"');
    expect(src).toContain("Invited to the team?");
    expect(src).toContain("You don't have a password yet.");
    expect((src.match(/onClick=\{sendPasswordLink\}/g) || []).length).toBe(2);
    expect(src).toContain("resetPasswordForEmail(em, { redirectTo: `${window.location.origin}/set-password` })");
  });
});
