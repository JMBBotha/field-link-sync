import { describe, it, expect } from "vitest";
import fieldAgentSource from "@/pages/FieldAgent.tsx?raw";
import badgeSource from "@/components/IdentityBadge.tsx?raw";

describe("Field Agent header declutter", () => {
  it("drops the Field Agent / name text and keeps a single IdentityBadge", () => {
    expect(fieldAgentSource).toContain("<IdentityBadge />");
    expect(fieldAgentSource).toMatch(/sr-only[\s\S]{0,40}Field Agent/);
    expect(fieldAgentSource).not.toMatch(/font-semibold text-sm text-white">Field Agent</);
    expect(fieldAgentSource).not.toMatch(/text-xs text-white\/80 hidden md:block/);
  });

  it("collapses Dashboard / Quote Builder to icons at tablet and a menu on phone", () => {
    expect(fieldAgentSource).toContain("hidden xl:inline");
    expect(fieldAgentSource).toContain("md:hidden");
    expect(fieldAgentSource).toContain("<Menu");
    expect(fieldAgentSource).toContain("DropdownMenu");
  });

  it("merges Online / Available now / toggle into one control and still writes agent_locations only", () => {
    expect(fieldAgentSource).toContain('data-testid="availability-control"');
    expect(fieldAgentSource).toContain("hideLabel");
    expect(fieldAgentSource).toMatch(/from\("agent_locations"\)[\s\S]{0,200}is_available/);
    expect(fieldAgentSource).not.toMatch(/from\("agent_availability"\)/);
  });

  it("IdentityBadge uses first name below xl so the name is never awkwardly truncated", () => {
    expect(badgeSource).toContain("xl:hidden");
    expect(badgeSource).toContain("xl:inline");
    expect(badgeSource).toContain("whitespace-nowrap");
    expect(badgeSource).not.toContain("sm:hidden");
  });
});
