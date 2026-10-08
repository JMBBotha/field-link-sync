import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import IdentityBadge from "@/components/IdentityBadge";
import fieldAgentSource from "@/pages/FieldAgent.tsx?raw";
import adminLayoutSource from "@/components/admin/AdminLayout.tsx?raw";
import fieldShellSource from "@/components/field/FieldShell.tsx?raw";

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "t@x.co" } as { id: string; email: string } | null,
  profile: null as { full_name: string | null; dispatch_role: string | null } | null,
  roles: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: state.user ? { user: state.user } : null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const rows = table === "profiles" ? state.profile : state.roles.map((role) => ({ role }));
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
  beforeEach(() => {
    cleanup();
    state.user = { id: "user-1", email: "t@x.co" };
    state.profile = null;
    state.roles = [];
  });

  it.each([
    [["admin"], false, "Admin"],
    [["field_agent"], false, "Technician"],
    [["dispatcher"], true, "Sales"],
    [["dispatcher"], false, "Office"],
  ])("roles %j (sales rep: %j) shows %s", async (roles, isSalesRep, label) => {
    state.roles = roles as string[];
    state.profile = {
      full_name: "Thabo Mokoena",
      dispatch_role: isSalesRep ? "sales" : "office",
    };
    renderBadge();
    expect(await screen.findByText(label as string)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("identity-badge")).toHaveTextContent("Thabo Mokoena"));
  });

  it("shows first name on phones with the role chip", async () => {
    state.roles = ["field_agent"];
    state.profile = { full_name: "Thabo Mokoena", dispatch_role: null };
    renderBadge();
    await screen.findByText("Technician");
    await waitFor(() => expect(document.querySelector(".xl\\:hidden")).toHaveTextContent("Thabo"));
    expect(document.querySelector(".xl\\:inline")).toHaveTextContent("Thabo Mokoena");
  });

  it("falls back to the email prefix when no full name is saved", async () => {
    state.roles = ["admin"];
    state.user = { id: "user-1", email: "amy@x.co" };
    state.profile = { full_name: null, dispatch_role: null };
    renderBadge();
    expect(await screen.findByText("Admin")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("identity-badge")).toHaveTextContent("amy"));
  });

  it("FieldAgent no longer renders the trial badge or upgrade gate", () => {
    expect(fieldAgentSource).not.toContain("SubscriptionBadge");
    expect(fieldAgentSource).not.toContain("UpgradeModal");
    expect(fieldAgentSource).not.toContain("useSubscription");
    expect(fieldAgentSource).not.toContain("Trial Expired");
  });

  it("is mounted in AdminLayout, FieldAgent and FieldShell headers", () => {
    expect(adminLayoutSource).toContain("<IdentityBadge />");
    expect(fieldAgentSource).toContain("<IdentityBadge />");
    expect(fieldShellSource).toContain("<IdentityBadge />");
  });
});
