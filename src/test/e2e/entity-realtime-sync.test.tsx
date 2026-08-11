import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/* -------------------------------------------------------------------------- */
/* Realtime bus mock: every "tab" subscribes to the same in-memory bus, so a    */
/* change emitted once is delivered to all open clients, like Supabase does.    */
/* -------------------------------------------------------------------------- */

type Handler = (payload: any) => void;
const handlers: { table: string; event: string; filter?: string; cb: Handler }[] = [];

const emit = (table: string, event: "INSERT" | "UPDATE" | "DELETE", row: any) => {
  handlers
    .filter((h) => h.table === table && h.event === event)
    .filter((h) => !h.filter || h.filter === `id=eq.${row.id}`)
    .forEach((h) =>
      h.cb(event === "DELETE" ? { old: row, eventType: event } : { new: row, eventType: event }),
    );
};

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: any[]) => rpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
    channel: () => {
      const channel: any = {
        on: (_type: string, cfg: any, cb: Handler) => {
          handlers.push({ table: cfg.table, event: cfg.event, filter: cfg.filter, cb });
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "user-1" } }, user: { id: "user-1" }, loading: false }),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

import { useEntityEditor } from "@/hooks/useEntityEditor";
import { useEntityRealtimeSync } from "@/hooks/useEntityRealtimeSync";

/* -------------------------------------------------------------------------- */

const LEAD_ID = "lead-1";
const CLIENT_ID = "client-1";
const PROJECT_ID = "project-1";

const seedLead = () => ({
  id: LEAD_ID,
  customer_name: "Johan Botha",
  status: "pending",
  priority: "normal",
});

/** A tab = its own QueryClient with the same views open. */
function createTab() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });

  // Views that show a copy of the same records.
  qc.setQueryData(["dispatch-leads"], [seedLead()]); // dispatch board
  qc.setQueryData(["job-schedules"], [{ id: "sch-1", lead: seedLead() }]); // calendar
  qc.setQueryData(["unassigned-queue"], [seedLead()]); // unassigned jobs list
  qc.setQueryData(["unified-clients"], [{ id: CLIENT_ID, name: "Johan Botha", status: "active" }]);
  qc.setQueryData(["fb-projects"], [{ id: PROJECT_ID, name: "Roof units", status: "active" }]);

  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);

  renderHook(() => useEntityRealtimeSync(), { wrapper });

  return { qc, wrapper };
}

const board = (qc: QueryClient) => (qc.getQueryData(["dispatch-leads"]) as any[])[0];
const calendar = (qc: QueryClient) => (qc.getQueryData(["job-schedules"]) as any[])[0].lead;
const unassigned = (qc: QueryClient) => (qc.getQueryData(["unassigned-queue"]) as any[])[0];
const clients = (qc: QueryClient) => (qc.getQueryData(["unified-clients"]) as any[])[0];
const projects = (qc: QueryClient) => (qc.getQueryData(["fb-projects"]) as any[])[0];

describe("E2E: popup edits propagate across every view and tab", () => {
  beforeEach(() => {
    handlers.length = 0;
    rpc.mockReset();
    toast.mockReset();
  });

  it("optimistically updates dispatch board, calendar and unassigned list, then syncs a second tab", async () => {
    const tabA = createTab();
    const tabB = createTab();

    rpc.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ data: { ...seedLead(), status: "in_progress" }, error: null }),
            10,
          ),
        ),
    );

    const { result } = renderHook(
      () => useEntityEditor("lead", LEAD_ID, { initialData: seedLead() }),
      { wrapper: tabA.wrapper },
    );

    let pending!: Promise<any>;
    act(() => {
      pending = result.current.updateField("status", "in_progress");
    });

    // Optimistic: every view in the editing tab reflects the change immediately.
    await waitFor(() => expect(board(tabA.qc).status).toBe("in_progress"));
    expect(calendar(tabA.qc).status).toBe("in_progress");
    expect(unassigned(tabA.qc).status).toBe("in_progress");

    await act(async () => {
      await pending;
    });

    // The server change reaches the other tab over realtime.
    expect(board(tabB.qc).status).toBe("pending");
    act(() => emit("leads", "UPDATE", { ...seedLead(), status: "in_progress" }));

    expect(board(tabB.qc).status).toBe("in_progress");
    expect(calendar(tabB.qc).status).toBe("in_progress");
    expect(unassigned(tabB.qc).status).toBe("in_progress");
  });

  it("rolls every view back when the save fails", async () => {
    const tabA = createTab();
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    const { result } = renderHook(
      () => useEntityEditor("lead", LEAD_ID, { initialData: seedLead() }),
      { wrapper: tabA.wrapper },
    );

    await act(async () => {
      await result.current.updateField("priority", "urgent").catch(() => {});
    });

    expect(board(tabA.qc).priority).toBe("normal");
    expect(calendar(tabA.qc).priority).toBe("normal");
    expect(unassigned(tabA.qc).priority).toBe("normal");
    expect(result.current.data?.priority).toBe("normal");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("syncs client list and project list edits to other tabs", () => {
    const tabB = createTab();

    act(() => emit("customers", "UPDATE", { id: CLIENT_ID, name: "Johan B.", status: "inactive" }));
    act(() =>
      emit("fb_projects", "UPDATE", { id: PROJECT_ID, name: "Roof units", status: "completed" }),
    );

    expect(clients(tabB.qc).status).toBe("inactive");
    expect(clients(tabB.qc).name).toBe("Johan B.");
    expect(projects(tabB.qc).status).toBe("completed");
  });
});
