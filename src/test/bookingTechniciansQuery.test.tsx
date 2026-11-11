import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";

const INNOCENT = "09a7f5af-2752-4835-8738-54f7b53083ea";
const calls = vi.hoisted(() => ({ n: 0, error: null as { message: string } | null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => {
      const c: Record<string, unknown> = {};
      const self = () => c;
      for (const m of ["select", "eq", "is", "order", "limit"]) c[m] = () => { if (m === "select") calls.n += 1; return c; };
      c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
        data: calls.error ? null : [{
          id: INNOCENT, full_name: "Innocent Mattienga", company_id: MASSAIR_CT_ID,
          dispatch_role: "technician", participant_type: "company_staff", dispatch_active: true,
          archived_at: null, availability_status: "offline",
        }],
        error: calls.error,
      }).then(resolve);
      return c;
    },
  },
}));

import { useBookingTechnicians } from "@/hooks/useBookingTechnicians";

function Probe({ companyId, enabled }: { companyId: string | null; enabled: boolean }) {
  const q = useBookingTechnicians(companyId, enabled);
  return (
    <div>
      <div data-testid="fetching">{String(q.isFetching)}</div>
      <div data-testid="error">{q.isError ? "yes" : "no"}</div>
      <div data-testid="names">{(q.data || []).map((t) => t.name).join(",")}</div>
      <button type="button" onClick={() => { void q.refetch(); }}>Retry</button>
    </div>
  );
}

function mount(ui: ReactElement, client?: QueryClient) {
  const qc = client || new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  const view = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
  return { ...view, qc };
}

describe("useBookingTechnicians", () => {
  it("waits until the company is known and the menu is allowed, then lists the offline tech", async () => {
    calls.n = 0;
    calls.error = null;
    const { rerender, qc } = mount(<Probe companyId={null} enabled={false} />);
    expect(calls.n).toBe(0);
    rerender(<QueryClientProvider client={qc}><Probe companyId={null} enabled /></QueryClientProvider>);
    expect(calls.n).toBe(0);
    rerender(<QueryClientProvider client={qc}><Probe companyId={MASSAIR_CT_ID} enabled={false} /></QueryClientProvider>);
    expect(calls.n).toBe(0);
    rerender(<QueryClientProvider client={qc}><Probe companyId={MASSAIR_CT_ID} enabled /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("Innocent Mattienga"));
    expect(calls.n).toBeGreaterThan(0);
  });

  it("refetches a stale empty cache instead of keeping it", async () => {
    calls.n = 0;
    calls.error = null;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    qc.setQueryData(["booking-technicians", MASSAIR_CT_ID], []);
    mount(<Probe companyId={MASSAIR_CT_ID} enabled />, qc);
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("Innocent Mattienga"));
    expect(calls.n).toBeGreaterThan(0);
  });

  it("surfaces a failed read and loads the technician after retry", async () => {
    calls.n = 0;
    calls.error = { message: "permission denied" };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mount(<Probe companyId={MASSAIR_CT_ID} enabled />, qc);
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent("yes"));
    calls.error = null;
    screen.getByRole("button", { name: "Retry" }).click();
    await waitFor(() => expect(screen.getByTestId("names")).toHaveTextContent("Innocent Mattienga"));
  });
});
