import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, cleanup, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn(async (..._a: any[]) => ({ data: null, error: null }));
const quoteRow: any = { quote_number: "Q-2026-0026", customer_name: null, created_at: "2026-10-01T08:00:00Z", customers: { name: "Linked Client" } };
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string): any => new Proxy(function () {}, { get: (_x, p) => p === "then"
    ? (res: any) => res({ data: t === "supplier_products" ? [] : t === "quotes" ? quoteRow : null, error: null })
    : () => q(t) });
  const ch: any = { on: () => ch, subscribe: () => ch, track: async () => undefined, presenceState: () => ({}) };
  return { supabase: { from: q, rpc: (...a: any[]) => rpc(...a), channel: () => ch, removeChannel: async () => undefined,
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
});
vi.mock("@/contexts/AuthContext", () => { const v = { user: { id: "u1" }, session: { user: { id: "u1" } }, loading: false }; return { useAuth: () => v, AuthProvider: ({ children }: any) => children }; });
vi.mock("@/hooks/useRole", () => { const v = { roles: ["admin"], isAdmin: true, isLoading: false, loading: false }; return { useRole: () => v }; });

const unit = (id: string, area: string) => ({ id, area_id: area, item_name: "Samsung 12000 BTU inverter", item_type: "product", product_id: null, parent_item_id: null, quantity: 1, unit_price: 10000, total_price: 10000, sort_order: 1, metadata: {} });
const lab = (id: string, area: string | null, hours: number, job = false) => ({ id, area_id: area, item_name: job ? "Job labour" : "Labour", item_type: "labour", product_id: null, parent_item_id: null, quantity: hours, unit_price: 680, total_price: hours * 680, sort_order: 9, metadata: { labour: true, hours, rate: 680, ...(job ? { labour_scope: "job" } : {}) } });
const noop = async () => null as any;
const ctx: any = {
  quoteId: "q1", loading: false, items: [], meta: { id: "q1", company_id: "co1", labour_mode: "per_area", status: "draft", customer_id: "c1", customer_name: null, quote_number: null },
  areas: [{ id: "a1", name: "Lounge", sort_order: 0 }, { id: "a2", name: "Bedroom", sort_order: 1 }],
  updateQuote: noop, addArea: noop, updateArea: noop, deleteArea: noop, addItem: noop, updateItem: noop, deleteItem: noop, refetch: noop,
};
vi.mock("@/contexts/QuoteContext", () => ({ useQuoteContext: () => ctx, trackQuoteWrite: (p: any) => p, usePendingQuoteWrites: () => 0, waitForQuoteWrites: async () => true, QuoteProvider: ({ children }: any) => children }));

import EstimateBuilder from "@/components/quoting/EstimateBuilder";
import AreaLabourRow from "@/components/quoting/AreaLabourRow";
import QuoteActionBar from "@/components/quoting/QuoteActionBar";
import AreaFirstBuilder from "@/components/quoting/AreaFirstBuilder";
import { LABOUR_SWITCH_LABEL } from "@/components/quoting/LabourModeSwitch";

const wrap = (ui: React.ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>;
async function open() {
  await act(async () => { render(wrap(<EstimateBuilder quoteNumber="Q-T" issueDate="2026-10-01T08:00:00Z" customerName="T" vatRate={0.15} />)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}
const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("labour tick box", () => {
  beforeEach(() => { cleanup(); rpc.mockClear(); });

  it("per area: one switch under the last labour row, above Create area, never printed; no Labour mode select", async () => {
    ctx.meta.labour_mode = "per_area";
    ctx.items = [unit("u1", "a1"), lab("l1", "a1", 3.5), unit("u2", "a2"), lab("l2", "a2", 3.5)];
    await open();
    expect(screen.queryByLabelText("Labour mode")).toBeNull();
    const sw = screen.getByTestId("labour-mode-switch");
    expect(sw.className).toContain("print:hidden");
    expect(sw.hasAttribute("data-html2canvas-ignore")).toBe(true);
    expect(screen.getAllByTestId("area-labour-hours-row")).toHaveLength(2);
    expect(after(screen.getByTestId("area-labour-a2"), sw)).toBe(true);
    const create = screen.queryByTestId("inline-estimate-area-create");
    if (create) expect(after(sw, create)).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: LABOUR_SWITCH_LABEL })); });
    expect(rpc).toHaveBeenCalledWith("set_quote_labour_mode", expect.objectContaining({ p_mode: "job", p_area_units: { a1: 1, a2: 1 } }));
  });

  it("job mode: job row after the last area, switch below it; unticking splits back per area", async () => {
    ctx.meta.labour_mode = "job";
    ctx.items = [unit("u1", "a1"), unit("u2", "a2"), lab("j", null, 7, true)];
    await open();
    const job = screen.getByTestId("job-labour");
    expect(after(document.querySelector('[data-area-id="a2"]') ?? job, job)).toBe(true);
    expect(after(job, screen.getByTestId("labour-mode-switch"))).toBe(true);
    expect(screen.getByRole("switch", { name: LABOUR_SWITCH_LABEL }).getAttribute("aria-checked")).toBe("true");
    await act(async () => { fireEvent.click(screen.getByRole("switch", { name: LABOUR_SWITCH_LABEL })); });
    expect(rpc).toHaveBeenCalledWith("set_quote_labour_mode", expect.objectContaining({ p_mode: "per_area" }));
  });

  it("typing a job total keeps the hours and sets rate = total / hours", () => {
    const onChange = vi.fn();
    render(<AreaLabourRow areaId="job" areaName="the job" title="Job labour" editTotal defaultHours={7} lines={[{ id: "j", quantity: 10, unit_price: 680 } as any]} onAdd={vi.fn()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Edit labour total for the job"));
    const input = screen.getByLabelText("Labour total for the job");
    fireEvent.change(input, { target: { value: "8000" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("j", 10, 800);
  });
});

describe("QuoteActionBar", () => {
  beforeEach(cleanup);
  it.each([390, 1366])("shows Save draft / Download PDF / Send at %ipx", (w) => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
    render(<QuoteActionBar busy={null} onSave={vi.fn()} onPdf={vi.fn()} onSend={vi.fn()} onPrint={vi.fn()} leading={<span>R 1,00</span>} />);
    const bar = screen.getByTestId("quote-action-bar");
    expect(bar.className).toContain("flex-wrap");
    expect(screen.getByRole("button", { name: /Save draft/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Download PDF/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Send$/ })).toBeTruthy();
  });
});

describe("Prepared for", () => {
  beforeEach(cleanup);
  it("falls back to the linked customer name and shows the quote number", async () => {
    ctx.meta.labour_mode = "per_area";
    ctx.items = [];
    await act(async () => { render(wrap(<AreaFirstBuilder />)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.body.textContent).toContain("Linked Client");
    expect(document.body.textContent).toContain("Q-2026-0026");
  });
});
