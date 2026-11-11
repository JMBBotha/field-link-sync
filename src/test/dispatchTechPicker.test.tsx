import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const rpc = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }),
    rpc: (...a: unknown[]) => rpc(...a),
  },
}));

import EditJobDetailsSheet from "@/components/jobs/EditJobDetailsSheet";

function renderSheet() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: ComponentProps<typeof EditJobDetailsSheet> = {
    open: true,
    onOpenChange: () => {},
    jobId: "job-1",
    companyId: "co",
    scheduledFor: "2026-11-05T07:30:00.000Z",
    techId: "tech-1",
    perms: { admin: true, rep: false },
    hasLead: true,
  };
  render(
    <QueryClientProvider client={qc}>
      <EditJobDetailsSheet {...props} />
    </QueryClientProvider>,
  );
}

describe("visit technician picker", () => {
  it("says Loading technicians while the list has not arrived", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "job_visits") return Promise.resolve({ data: [], error: null });
      if (fn === "dispatchable_technicians") return new Promise(() => {});
      return Promise.resolve({ data: null, error: null });
    });
    renderSheet();
    expect(await screen.findByTestId("tech-picker-loading")).toHaveTextContent("Loading technicians…");
    expect(screen.queryByTestId("edit-job-tech")).not.toBeInTheDocument();
    expect(screen.queryByText("No technicians in this company.")).not.toBeInTheDocument();
  });

  it("shows Retry when the technician read fails", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "job_visits") return Promise.resolve({ data: [], error: null });
      if (fn === "dispatchable_technicians") return Promise.resolve({ data: null, error: { message: "down" } });
      return Promise.resolve({ data: null, error: null });
    });
    renderSheet();
    expect((await screen.findAllByTestId("tech-picker-error"))[0]).toHaveTextContent("Retry");
    await waitFor(() => expect(screen.queryByTestId("edit-job-tech")).not.toBeInTheDocument());
  });
});
