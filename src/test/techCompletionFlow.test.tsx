import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const submitMock = vi.fn(async () => ({ queued: false }));
const rpcMock = vi.fn(async (name: string, _args?: unknown) => {
  if (name === "get_product_sell_options") return { data: [{ id: "11111111-1111-4111-8111-111111111111", product_code: "BR1", short_name: "Wall bracket", sell_excl_vat: 999 }], error: null };
  if (name === "get_job_packing_list") return { data: [], error: null };
  return { data: "req-1", error: null };
});
vi.mock("@/hooks/useJobCompletion", () => ({ useJobCompletion: () => ({ submit: submitMock }) }));
vi.mock("@/contexts/OfflineContext", () => ({ useOfflineContext: () => ({ isOnline: true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/lib/completeLeadJobs", () => ({ findOpenJobIdsForLead: async () => ["job-1"] }));
vi.mock("@/components/jobs/SignaturePad", () => ({ default: () => <div data-testid="sig" /> }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: any = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain, then: (r: any) => r({ count: 2, data: [], error: null }) };
  return { supabase: { rpc: (n: string, a: unknown) => rpcMock(n, a), from: () => chain } };
});

import JobCompletionSheet from "@/components/jobs/JobCompletionSheet";
import { prefillTimes, durationText } from "@/lib/completionTimes";
import { requestFlag } from "@/components/admin/InvoiceRequestsCard";

const src = (p: string) => readFileSync(p, "utf8");
const renderSheet = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <JobCompletionSheet open onOpenChange={() => {}} leadId="lead-1" customerName="TEST Client" startedAt="2026-10-09T07:10:00Z" />
    </QueryClientProvider>,
  );

describe("Finish-job form (Johan 23:11)", () => {
  beforeEach(() => { submitMock.mockClear(); rpcMock.mockClear(); });

  it("prefills times from the actual start / booking, finish = now", () => {
    const now = new Date("2026-10-09T12:00:00");
    expect(prefillTimes({ startedAt: "2026-10-09T09:30:00", now }).start?.getHours()).toBe(9);
    expect(prefillTimes({ scheduledDate: "2026-10-09", scheduledTime: "08:15:00", now }).start?.getMinutes()).toBe(15);
    expect(prefillTimes({ now }).start).toBeNull();
    expect(durationText(new Date("2026-10-09T09:00:00"), new Date("2026-10-09T11:30:00"))).toBe("2 h 30 min");
  });

  it("needs the as-quoted choice and a signature (or 'not available'); times are collapsed under 'Times differ?'", () => {
    renderSheet();
    expect(screen.getByTestId("times-differ")).toBeTruthy();
    expect(screen.queryByLabelText("Started")).toBeNull(); // collapsed
    expect((screen.getByTestId("finish-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("as-quoted-yes"));
    expect((screen.getByTestId("finish-submit") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Customer not available to sign"));
    expect((screen.getByTestId("finish-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/R\s?\d/)).toBeNull(); // no prices anywhere
  });

  it("as quoted: completes and sends an 'as quoted' invoice request (no extras)", async () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("as-quoted-yes"));
    fireEvent.click(screen.getByLabelText("Customer not available to sign"));
    fireEvent.click(screen.getByTestId("finish-submit"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("submit_invoice_request", expect.objectContaining({ p_lead_id: "lead-1", p_extra_items: [], p_extra_hours: null })));
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it("with extras: quantity-only items + extra hours go in the request", async () => {
    renderSheet();
    fireEvent.click(screen.getByTestId("as-quoted-no"));
    expect(screen.getByTestId("finish-hint").textContent).toMatch(/Add the extras/);
    fireEvent.change(screen.getByPlaceholderText("Not in the list? Type it"), { target: { value: "TEST extra bracket" } });
    fireEvent.click(screen.getByRole("button", { name: /Add$/ }));
    fireEvent.click(screen.getByLabelText("More TEST extra bracket"));
    fireEvent.click(screen.getByRole("button", { name: "1 h" }));
    fireEvent.click(screen.getByLabelText("Customer not available to sign"));
    fireEvent.click(screen.getByTestId("finish-submit"));
    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith("submit_invoice_request", expect.objectContaining({
      p_extra_items: [{ product_id: null, name: "TEST extra bracket", qty: 2 }], p_extra_hours: 1,
    })));
  });

  it("office flag text", () => {
    expect(requestFlag({ as_quoted: true, extra_items: [], extra_hours: null })).toBe("As quoted");
    expect(requestFlag({ as_quoted: false, extra_items: [{ product_id: null, name: "x", qty: 1 }], extra_hours: 1 })).toBe("Changes: extra materials/time");
  });
});

describe("Techs never create or see invoices", () => {
  it("FieldAgent completed cards: Create Invoice + deposit chip office-only; techs get 'Sent to office'", () => {
    const fa = src("src/pages/FieldAgent.tsx");
    expect(fa).toContain("const canInvoice = roleIsAdmin || roleIsDispatcher;");
    expect((fa.match(/\{canInvoice \? \(/g) || []).length).toBe(2);
    expect((fa.match(/<TechOfficeChip /g) || []).length).toBe(2);
    expect((fa.match(/canInvoice && installInvoicesByLead/g) || []).length).toBe(2);
  });
  it("card 'Complete' opens the Finish form (no silent completion); Release hidden once started", () => {
    const fa = src("src/pages/FieldAgent.tsx");
    expect((fa.match(/onComplete=\{handleCardComplete\}/g) || []).length).toBe(5);
    expect(fa).toMatch(/autoStartCompletion=\{autoStartCompletion\}/);
    expect(src("src/components/FieldAgentLeadCard.tsx")).toContain('onRelease && lead.status !== "in_progress"');
  });
  it("lead sheet: invoice block and invoice query are office-only", () => {
    const s = src("src/components/LeadDetailSheet.tsx");
    expect((s.match(/\{invoiceTechOnly \? \(/g) || []).length).toBe(2);
    expect(s).toContain("lead?.status === 'completed' && !invoiceTechOnly");
  });
  it("DB: tech invoice block kept; approve is office-only; extras priced server-side", () => {
    const m = src("supabase/migrations/20261009230000_tech_completion_invoice_requests.sql");
    expect(m).not.toMatch(/rh_tech_no_insert|DROP POLICY[^;]*invoices/);
    expect(m).toContain("Only the office can approve invoice requests");
    expect(m).toContain("get_product_sell_options() o WHERE o.id");
    expect(m).toMatch(/'qty', round\(LEAST/); // client prices are never read
  });
});
