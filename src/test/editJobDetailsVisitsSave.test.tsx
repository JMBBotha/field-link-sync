import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
for (const k of ["hasPointerCapture", "setPointerCapture", "releasePointerCapture"] as const) {
  if (!(Element.prototype as unknown as Record<string, unknown>)[k]) {
    (Element.prototype as unknown as Record<string, () => void>)[k] = () => {};
  }
}
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const toast = vi.fn();
const rpc = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.order = () => Promise.resolve({ data: [], error: null });
    return c;
  };
  return { supabase: { from: () => chain(), rpc: (...a: unknown[]) => rpc(...a) } };
});

import EditJobDetailsSheet from "@/components/jobs/EditJobDetailsSheet";

const JOB = "af49ca54-bab8-4a36-af74-a93c35d05c7e";
const savedVisit = {
  id: "0a73b417-b10f-41f3-b9d1-75b8e3cca668",
  date: "2026-11-05",
  start: "09:30",
  end: "17:30",
  tech: "tech-innocent",
  tech_name: "Innocent Mattienga",
  note: null,
};

function renderSheet(props: Partial<ComponentProps<typeof EditJobDetailsSheet>> = {}) {
  const onOpenChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <EditJobDetailsSheet
        open
        onOpenChange={onOpenChange}
        jobId={JOB}
        companyId="co"
        scheduledFor="2026-11-05T07:30:00.000Z"
        techId="tech-innocent"
        perms={{ admin: true, rep: true }}
        hasLead
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("Edit job details visits save", () => {
  beforeEach(() => {
    toast.mockReset();
    rpc.mockReset();
    rpc.mockImplementation(async (fn: string, args: { p_note?: string | null }) => {
      if (fn === "job_visits") return { data: [savedVisit], error: null };
      if (fn === "dispatchable_technicians") return { data: [{ id: "tech-innocent", full_name: "Innocent Mattienga" }], error: null };
      if (fn === "set_job_visits") return { error: null };
      if (fn === "update_job_details") return { data: args?.p_note ? { note: true } : {}, error: null };
      return { data: null, error: null };
    });
  });

  it("saves a dirty visit and the typed note without the leftover date check", async () => {
    const { onOpenChange } = renderSheet();
    // Loaded server visit ends 17:30. The 3h seed from scheduledFor never does.
    await waitFor(() => expect(screen.getByLabelText("End")).toHaveValue("17"));

    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-11-06" } });
    fireEvent.change(screen.getByLabelText("End"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("Add a note"), {
      target: { value: "Job needs a water pump we might need to run electrical point from DB board" },
    });
    fireEvent.click(screen.getByTestId("edit-job-save"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Job updated" })));
    expect(toast.mock.calls.map((c) => c[0]?.title)).not.toContain("Check the date and time");

    const names = rpc.mock.calls.map((c) => c[0]);
    const visitsAt = names.indexOf("set_job_visits");
    const detailsAt = names.indexOf("update_job_details");
    expect(visitsAt).toBeGreaterThanOrEqual(0);
    expect(detailsAt).toBeGreaterThan(visitsAt);

    expect(rpc).toHaveBeenCalledWith("set_job_visits", expect.objectContaining({
      p_job: JOB,
      p_note: null,
      p_visits: [expect.objectContaining({ date: "2026-11-06", start: "09:30", end: "15:30", tech: "tech-innocent" })],
    }));
    expect(rpc).toHaveBeenCalledWith("update_job_details", expect.objectContaining({
      p_job: JOB,
      p_scheduled_for: null,
      p_note: "Job needs a water pump we might need to run electrical point from DB board",
    }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still rejects a bad single date when the job is not on visits", async () => {
    const { onOpenChange } = renderSheet({ hasLead: false });
    const date = await screen.findByLabelText("Installation date");
    // jsdom drops non-ISO values on type=date before React sees them.
    date.removeAttribute("type");
    fireEvent.change(date, { target: { value: "30/10/2026" } });
    fireEvent.click(screen.getByTestId("edit-job-save"));

    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Check the date and time",
      variant: "destructive",
    })));
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("set_job_visits");
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain("update_job_details");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
