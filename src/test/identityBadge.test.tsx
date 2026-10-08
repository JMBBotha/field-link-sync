import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import IdentityBadge from "@/components/IdentityBadge";
import fieldAgentSource from "@/pages/FieldAgent.tsx?raw";

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "t@x.co" } as { id: string; email: string } | null,
  profile: null as { full_name: string | null; email: string | null; dispatch_role: string | null } | null,
  roles: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const rows =
            table === "profiles" ? state.profile : state.roles.map((role) => ({ role }));
          return {
            maybeSingle: async () => ({ data: table === "profiles" ? state.profile : null }),
            then: (resolve: (r: unknown) => void) => resolve({ data: rows, error: null }),
          };
        },
      }),
    }),
  },
}));

const renderBadge = () => render(<IdentityBadge />);

describe("IdentityBadge", () => {
  it.each([
    [["admin"], false, "Admin"],
    [["field_agent"], false, "Technician"],
    [["dispatcher"], true, "Sales"],
    [["dispatcher"], false, "Office"],
  ])("roles %j (sales rep: %j) shows %s", async (roles, isSalesRep, label) => {
    state.roles = roles as string[];
    state.profile = {
      full_name: "Thabo Mokoena",
      email: null,
      dispatch_role: isSalesRep ? "sales" : "office",
    };
    renderBadge();
    expect(await screen.findByText(label as string)).toBeInTheDocument();
    expect(screen.getByTestId("identity-badge")).toHaveTextContent("Thabo Mokoena");
  });

  it("shows first name on phones with the role chip", async () => {
    state.roles = ["field_agent"];
    state.profile = { full_name: "Thabo Mokoena", email: null, dispatch_role: null };
    renderBadge();
    await screen.findByText("Technician");
    expect(document.querySelector(".sm\\:hidden")).toHaveTextContent("Thabo");
    expect(document.querySelector(".sm\\:inline")).toHaveTextContent("Thabo Mokoena");
  });

  it("falls back to the email prefix when no full name is saved", async () => {
    state.roles = ["admin"];
    state.profile = { full_name: null, email: "amy@x.co", dispatch_role: null };
    renderBadge();
    expect(await screen.findByText("Admin")).toBeInTheDocument();
    expect(screen.getByTestId("identity-badge")).toHaveTextContent("amy");
  });

  it("FieldAgent no longer renders the trial badge or upgrade gate", () => {
    expect(fieldAgentSource).not.toContain("SubscriptionBadge");
    expect(fieldAgentSource).not.toContain("UpgradeModal");
    expect(fieldAgentSource).not.toContain("useSubscription");
    expect(fieldAgentSource).not.toContain("Trial Expired");
  });
});
