import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  for (const k of ["select", "eq", "in", "order", "limit"]) chain[k] = () => chain;
  chain.maybeSingle = async () => ({ data: null, error: null });
  chain.then = (r: any) => r({ data: [], error: null });
  return { supabase: { from: () => chain, rpc: async () => ({ data: null }), auth: { getUser: async () => ({ data: { user: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }), getSession: async () => ({ data: { session: null } }) } } };
});

import LiveClientPreview from "@/components/quoting/LiveClientPreview";

describe("live client preview", () => {
  it("renders the client Light document from in-memory lines, including uncommitted drafts", async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <LiveClientPreview quoteId="q1" quoteNumber="Q-1" issueDate="2026-10-14" customerName="Cape Estates" vatRate={0.15}
          areas={[{ id: "a1", name: "Lounge", sort_order: 0 }]}
          items={[{ id: "i1", area_id: "a1", item_name: "Service", quantity: 1, unit_price: 100, total_price: 100, item_type: "service" }]}
          drafts={{ i1: { item_name: "Deep clean", unit_price: 200 } }} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("brand-document")).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => expect(screen.getByText(/Deep clean/)).toBeTruthy(), { timeout: 2000 });
    expect(document.querySelector("[data-live-client-preview]")).toBeTruthy();
  });

  it("PDF capture skips the preview pane; the builder never writes from it", () => {
    expect(readFileSync("src/lib/documentPdf.ts", "utf8")).toContain('closest("[data-live-client-preview]")');
    const src = readFileSync("src/components/quoting/LiveClientPreview.tsx", "utf8");
    expect(src).not.toMatch(/\.(update|insert|upsert|delete)\(/);
    expect(src).not.toMatch(/ensureUnitContent|functions\.invoke/);
  });
});
