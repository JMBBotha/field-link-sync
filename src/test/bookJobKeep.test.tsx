import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import { bookJobDraftKey } from "@/lib/bookJobDraft";

const INNOCENT = "09a7f5af-2752-4835-8738-54f7b53083ea";
const JOHAN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";

const gate = vi.hoisted(() => ({
  companyId: null as string | null,
  companyLoading: true,
  isAdmin: false,
  roleLoading: true,
  userId: "1e795a9b-f8bd-4af5-8f28-5e0426101daa" as string | null,
  profilesError: null as { message: string } | null,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/LocationPicker", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("@/components/scheduling/AppointmentPicker", () => ({ default: () => <div data-testid="appt" /> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: gate.userId ? { id: gate.userId } : null, session: null, loading: false }),
}));
vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({ isAdmin: gate.isAdmin, loading: gate.roleLoading }),
}));
vi.mock("@/hooks/useUserCompanyId", () => ({
  useUserCompanyId: () => ({
    companyId: gate.companyId,
    loading: gate.companyLoading,
    error: null,
    reload: vi.fn(),
  }),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const c: Record<string, unknown> = {};
    const self = () => c;
    for (const m of ["select", "eq", "is", "order", "limit", "neq", "or", "gte", "lt", "in", "not"]) c[m] = self;
    const payload = () => {
      if (table === "profiles") {
        if (gate.profilesError) return { data: null, error: gate.profilesError };
        return {
          data: [{
            id: INNOCENT, full_name: "Innocent Mattienga", company_id: MASSAIR_CT_ID,
            dispatch_role: "technician", participant_type: "company_staff", dispatch_active: true, archived_at: null,
            availability_status: "offline",
          }],
          error: null,
        };
      }
      return { data: [], error: null };
    };
    c.single = async () => ({ data: null, error: null });
    c.maybeSingle = async () => ({ data: null, error: null });
    c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(payload()).then(resolve);
    return c;
  };
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      removeChannel: () => {},
    },
  };
});

import CreateJobDialog from "@/components/jobs/CreateJobDialog";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}
for (const k of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(Element.prototype as unknown as Record<string, unknown>)[k]) {
    (Element.prototype as unknown as Record<string, () => void>)[k] = () => {};
  }
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

function mount(props: { open?: boolean; defaultCustomerId?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <CreateJobDialog open={props.open ?? true} onOpenChange={() => {}} context="jobs" defaultCustomerId={props.defaultCustomerId} />
    </QueryClientProvider>,
  );
  return { ...view, qc };
}

describe("Book a job keeps the past-work technician and the draft", () => {
  beforeEach(() => {
    sessionStorage.clear();
    gate.companyId = null;
    gate.companyLoading = true;
    gate.isAdmin = false;
    gate.roleLoading = true;
    gate.userId = JOHAN;
    gate.profilesError = null;
  });

  it("shows loading, then an error when the company is unknown, then the offline technician", async () => {
    const { rerender, qc } = mount();
    fireEvent.click(screen.getByTestId("doing-past"));
    expect(screen.getByTestId("past-tech-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("past-admin-only")).toBeNull();

    gate.roleLoading = false;
    gate.isAdmin = true;
    gate.companyLoading = false;
    rerender(<QueryClientProvider client={qc}><CreateJobDialog open context="jobs" onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("doing-past"));
    expect(screen.getByTestId("past-tech-error")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Innocent Mattienga" })).toBeNull();

    gate.companyId = MASSAIR_CT_ID;
    rerender(<QueryClientProvider client={qc}><CreateJobDialog open context="jobs" onOpenChange={() => {}} /></QueryClientProvider>);
    fireEvent.click(screen.getByTestId("doing-past"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("past-tech"), { target: { value: INNOCENT } });
    expect(screen.getByTestId("past-tech")).toHaveValue(INNOCENT);
  });

  it("does not clear a chosen technician when the open defaults change, the window blurs, or the tab hides", async () => {
    gate.companyId = MASSAIR_CT_ID;
    gate.companyLoading = false;
    gate.isAdmin = true;
    gate.roleLoading = false;
    const { rerender, qc } = mount();
    fireEvent.click(screen.getByTestId("doing-past"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("past-tech"), { target: { value: INNOCENT } });
    fireEvent.change(screen.getByTestId("past-date"), { target: { value: "2026-11-11" } });

    rerender(<QueryClientProvider client={qc}><CreateJobDialog open context="jobs" onOpenChange={() => {}} defaultCustomerId="cust-new" /></QueryClientProvider>);
    expect(screen.getByTestId("past-tech")).toHaveValue(INNOCENT);
    expect(screen.getByTestId("doing-past")).toHaveAttribute("aria-checked", "true");

    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(screen.getByTestId("past-tech")).toHaveValue(INNOCENT);
    expect(screen.getByTestId("past-date")).toHaveValue("2026-11-11");
  });

  it("restores the open draft after a remount and drops it on cancel", async () => {
    gate.companyId = MASSAIR_CT_ID;
    gate.companyLoading = false;
    gate.isAdmin = true;
    gate.roleLoading = false;
    const { unmount, qc } = mount();
    fireEvent.click(screen.getByTestId("doing-past"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument());
    fireEvent.change(screen.getByTestId("past-tech"), { target: { value: INNOCENT } });
    fireEvent.change(screen.getByPlaceholderText("e.g. First fix — Avec House 12"), { target: { value: "First fix — house 12" } });
    await waitFor(() => expect(sessionStorage.getItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"))).toContain("First fix"));

    unmount();
    render(<QueryClientProvider client={qc}><CreateJobDialog open context="jobs" onOpenChange={() => {}} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId("past-tech")).toHaveValue(INNOCENT));
    expect(screen.getByPlaceholderText("e.g. First fix — Avec House 12")).toHaveValue("First fix — house 12");
    expect(screen.getByTestId("past-date")).toHaveValue("2026-11-11");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(sessionStorage.getItem(bookJobDraftKey(JOHAN, MASSAIR_CT_ID, "jobs"))).toBeNull();
  });

  it("shows a failed technician read and lists Innocent after retry", async () => {
    gate.companyId = MASSAIR_CT_ID;
    gate.companyLoading = false;
    gate.isAdmin = true;
    gate.roleLoading = false;
    gate.profilesError = { message: "network down" };
    const { rerender, qc } = mount();
    fireEvent.click(screen.getByTestId("doing-past"));
    await waitFor(() => expect(screen.getByTestId("past-tech-error")).toBeInTheDocument());
    gate.profilesError = null;
    fireEvent.click(screen.getByTestId("past-tech-retry"));
    await waitFor(() => expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument());
    rerender(<QueryClientProvider client={qc}><CreateJobDialog open context="jobs" onOpenChange={() => {}} /></QueryClientProvider>);
    expect(screen.getByRole("option", { name: "Innocent Mattienga" })).toBeInTheDocument();
  });
});
