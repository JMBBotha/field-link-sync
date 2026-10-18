import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { passwordStrength } from "@/components/auth/FlAuthFrame";

describe("Sign-in restyle (19 Oct)", () => {
  const frame = readFileSync("src/components/auth/FlAuthFrame.tsx", "utf8");
  const auth = readFileSync("src/pages/Auth.tsx", "utf8");
  it("never shows the old number on logged-out pages", () => {
    for (const src of [frame, auth]) expect(src).not.toMatch(/0800[- ]?232[- ]?665/);
  });
  it("uses the Field Lynk Sync title and the 0800-BE-COOL logo only", () => {
    expect(frame).toContain('"Field Lynk Sync"');
    expect(frame).toContain("fieldlynk-logo-card.png");
    expect(auth).not.toContain("fieldlynk-logo-white.png");
  });
  it("adds no new auth providers", () => {
    expect(auth).not.toMatch(/signInWithOAuth|signInWithIdToken/);
  });
  it("password strength is display-only (0-3)", () => {
    expect(passwordStrength("")).toBe(0);
    expect(passwordStrength("abc")).toBe(1);
    expect(passwordStrength("abcdefgh")).toBe(1);
    expect(passwordStrength("Cool2026")).toBe(2);
    expect(passwordStrength("Cool2026!")).toBe(3);
    expect(auth).not.toMatch(/disabled=\{[^}]*passwordStrength/);
  });
});
