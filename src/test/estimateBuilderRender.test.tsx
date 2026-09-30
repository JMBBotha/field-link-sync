// Regression #185: /admin/estimates/:id crashed ("Maximum update depth exceeded") — fresh {} product-info fallback looped the collapse effect.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const line = (n: number, area: string, product_id: string | null) => ({
  id: `b100000${n}-0000-4000-8000-000000000000`, area_id: area, item_name: `Item ${n}`, item_number: null, item_type: product_id ? "product" : "labour",
  source: product_id ? "catalog" : "manual", product_id, parent_item_id: null, is_bundle: false, length: null, quantity: 1, unit_price: 1000 * n,
  total_price: null, sort_order: n, metadata: { unit_cost: 800 * n, cost_excl: 800 * n, markup_percent: 25 },
});
const items = [line(1, "a1", "c1"), line(2, "a2", "c2"), line(3, "a2", null)];
const noop = async () => null as any;
const ctx: any = {
  quoteId: "q1", pendingWrites: 0, loading: false, error: null, canSave: true, items,
  meta: { id: "q1", company_id: "co1", labour_mode: "job", discount_type: "percentage", discount_value: 0, status: "draft" },
  areas: [{ id: "a1", name: "Lounge", sort_order: 0 }, { id: "a2", name: "Bedroom", sort_order: 1 }],
  updateQuote: noop, addArea: noop, updateArea: noop, deleteArea: noop, reorderAreas: noop, addItem: noop, updateItem: noop, deleteItem: noop, moveItemToArea: noop, refetch: noop,
};
vi.mock("@/integrations/supabase/client", () => {
  const q = (t: string): any => new Proxy(function () {}, { get: (_x, p) => p === "then"
    ? (res: any) => setTimeout(() => res({ data: t === "supplier_products" ? [] : null, error: null }), t === "supplier_products" ? 150 : 0)
    : () => q(t) });
  const ch: any = { on: () => ch, subscribe: () => ch, track: async () => undefined, presenceState: () => ({}) };
  return { supabase: { from: q, rpc: () => Promise.resolve({ data: null, error: null }), channel: () => ch, removeChannel: async () => undefined,
    auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } };
});
vi.mock("@/contexts/AuthContext", () => { const v = { user: { id: "u1" }, session: { user: { id: "u1" } }, loading: false }; return { useAuth: () => v, AuthProvider: ({ children }: any) => children }; });
vi.mock("@/hooks/useRole", () => { const v = { roles: ["admin"], isAdmin: true, isLoading: false, loading: false }; return { useRole: () => v }; });
vi.mock("@/contexts/QuoteContext", () => ({ useQuoteContext: () => ctx, trackQuoteWrite: (p: any) => p, usePendingQuoteWrites: () => 0, waitForQuoteWrites: async () => true, QuoteProvider: ({ children }: any) => children }));

import EstimateBuilder from "@/components/quoting/EstimateBuilder";

class Catch extends React.Component<{ children: React.ReactNode; onError: (e: Error) => void }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch(e: Error) { this.props.onError(e); }
  render() { return this.state.err ? <div data-testid="crashed" /> : this.props.children; }
}
async function openEstimate(phone: boolean) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: phone ? 390 : 1366 });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: phone ? 5 : 0 });
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  let r: ReturnType<typeof render>;
  await act(async () => {
    r = render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Catch onError={(e) => errors.push(e.message)}><EstimateBuilder quoteNumber="Q-T" issueDate="2026-09-30T08:00:00Z" validUntil={null} customerName="T" vatRate={0.15} notes={null} termsText={null} /></Catch>
    </QueryClientProvider>);
  });
  await act(async () => { await new Promise((res) => setTimeout(res, 400)); });
  spy.mockRestore();
  return { errors, crashed: !!r!.queryByTestId("crashed"), text: r!.container.textContent || "" };
}

describe("EstimateBuilder opens without an update loop (#185)", () => {
  beforeEach(() => { cleanup(); ctx.items = items; });
  it("first open on a phone while product info loads", async () => {
    const r = await openEstimate(true);
    expect(r.errors).toEqual([]);
    expect(r.crashed).toBe(false);
    expect(r.text).toMatch(/Lounge/);
  });
  it("first open on desktop", async () => {
    const r = await openEstimate(false);
    expect(r.errors).toEqual([]);
  });
  it("quote with no catalogue products on a phone", async () => {
    ctx.items = items.map((i) => ({ ...i, product_id: null }));
    const r = await openEstimate(true);
    expect(r.errors).toEqual([]);
    expect(r.crashed).toBe(false);
  });
  it("opens room sections expanded by default", async () => {
    await openEstimate(false);
    expect(document.querySelectorAll('[data-area-collapsed="true"]')).toHaveLength(0);
    expect(document.querySelectorAll('button[aria-expanded="false"][aria-label^="Show"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-area-id] [data-line-id]').length).toBeGreaterThan(0);
  });
});
