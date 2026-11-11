import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MASSAIR_CT_ID, MASSAIR_IND_ID } from "@/lib/adminHomeCount";

const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const SALES = "420c7731";
const auth = vi.hoisted(() => ({ id: "1e795a9b-f8bd-4af5-8f28-5e0426101daa" as string | null, loading: false, fetches: 0, fail: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: auth.id ? { id: auth.id } : null,
    loading: auth.loading,
    session: auth.id ? { user: { id: auth.id } } : null,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            auth.fetches += 1;
            if (auth.fail) return { data: null, error: { message: "token not ready" } };
            return { data: { company_id: auth.id === JOHAN ? MASSAIR_CT_ID : MASSAIR_IND_ID }, error: null };
          },
        }),
      }),
    }),
  },
}));

import { useUserCompanyId } from "@/hooks/useUserCompanyId";

function CompanyProbe() {
  const { companyId, loading, error, reload } = useUserCompanyId();
  return (
    <div>
      <div data-testid="co">{companyId || ""}</div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="err">{error || ""}</div>
      <button type="button" onClick={reload}>Reload company</button>
    </div>
  );
}

describe("company id across a token refresh", () => {
  it("does not refetch or forget the company when the same user object is replaced", async () => {
    auth.id = JOHAN;
    auth.loading = false;
    auth.fail = false;
    auth.fetches = 0;
    const { rerender } = render(<CompanyProbe />);
    await waitFor(() => expect(screen.getByTestId("co")).toHaveTextContent(MASSAIR_CT_ID));
    const n = auth.fetches;
    rerender(<CompanyProbe />);
    expect(auth.fetches).toBe(n);
    expect(screen.getByTestId("co")).toHaveTextContent(MASSAIR_CT_ID);
  });

  it("keeps the resolved company when a later read fails, and switches company with the account", async () => {
    auth.id = JOHAN;
    auth.fail = false;
    auth.fetches = 0;
    const { rerender } = render(<CompanyProbe />);
    await waitFor(() => expect(screen.getByTestId("co")).toHaveTextContent(MASSAIR_CT_ID));
    auth.fail = true;
    screen.getByRole("button", { name: "Reload company" }).click();
    await waitFor(() => expect(screen.getByTestId("err")).toHaveTextContent("token not ready"));
    expect(screen.getByTestId("co")).toHaveTextContent(MASSAIR_CT_ID);

    auth.fail = false;
    auth.id = SALES;
    rerender(<CompanyProbe />);
    await waitFor(() => expect(screen.getByTestId("co")).toHaveTextContent(MASSAIR_IND_ID));
  });
});
