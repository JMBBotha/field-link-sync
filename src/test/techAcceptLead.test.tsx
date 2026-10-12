import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toast = vi.fn();
const rpc = vi.fn();
let updateRows: any[] = [];
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "tech1" } }) }));
vi.mock("@/hooks/useUserCompanyId", () => ({ useUserCompanyId: () => ({ companyId: "co1" }) }));
vi.mock("@/components/scheduling/ClashGuard", () => ({ useClashGuard: () => ({ confirmBooking: async () => true, dialog: null }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (t: string): any => {
    const c: any = {
      update: () => c, eq: () => c, insert: () => c, maybeSingle: () => Promise.resolve({ data: null }),
      single: () => Promise.resolve({ data: { id: "jobX" }, error: null }),
      select: () => (t === "leads" ? Promise.resolve({ data: updateRows, error: null }) : c),
    };
    return c;
  };
  return { supabase: { from: chain, rpc: (...a: any[]) => rpc(...a) } };
});
import { useAcceptLead } from "@/hooks/useAcceptLead";

const values = { appointment: { date: "2026-10-13", startTime: "12:30", durationMinutes: 60, agentId: "tech1" } as any,
  title: "Service", description: "", priority: "normal", address: "" };

describe("tech accept of an unassigned offer", () => {
  beforeEach(() => { toast.mockReset(); rpc.mockReset(); updateRows = []; });
  it("falls back to tech_accept_lead when RLS hides the row", async () => {
    rpc.mockResolvedValue({ data: { ok: true, job_id: "job9" }, error: null });
    const { result } = renderHook(() => useAcceptLead());
    let out: any;
    await act(async () => { out = await result.current.acceptAndSchedule({ id: "L1" }, values); });
    expect(rpc).toHaveBeenCalledWith("tech_accept_lead", expect.objectContaining({ p_lead: "L1", p_date: "2026-10-13", p_time: "12:30" }));
    expect(out).toEqual({ jobId: "job9" });
  });
  it("shows the server's reason when the claim is refused", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "This client already has a booking on Tue 13 Oct 10:00 with Thabo Mokoena." } });
    const { result } = renderHook(() => useAcceptLead());
    let out: any;
    await act(async () => { out = await result.current.acceptAndSchedule({ id: "L1" }, values); });
    expect(out).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive", description: expect.stringMatching(/already has a booking/) }));
  });
  it("doesn't call the server path when the direct update worked", async () => {
    updateRows = [{ id: "L1" }];
    const { result } = renderHook(() => useAcceptLead());
    await act(async () => { await result.current.acceptAndSchedule({ id: "L1" }, values); });
    expect(rpc).not.toHaveBeenCalled();
  });
});
