import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, waitFor, type RenderResult } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import EstimateDocument from "@/components/quoting/EstimateDocument";
import LiveClientPreview from "@/components/quoting/LiveClientPreview";
import ClientQuotePdfRoot from "@/components/quoting/ClientQuotePdfRoot";
import { fetchQuoteCompanySettings } from "@/lib/quoteCompanySettings";

/**
 * Johan (Massair CT / 0800-BE-COOL), 6 Nov 2026: a dual-company admin can read both
 * company_settings rows. The newer Massair Ind CC row must not name a Massair CT quote.
 * CT: 361bf031-9cdb-4d7f-9bde-9eb95fa4725e. Ind CC: 7b0a1ac1-de4c-57c2-9274-49afe4344719.
 */
const CT = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const IND = "7b0a1ac1-de4c-57c2-9274-49afe4344719";

vi.mock("@/integrations/supabase/client", () => {
  const CT_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
  const IND_ID = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
  // Ind CC settings were touched later (2026-11-05) than CT (2026-10-12). Unfiltered
  // updated_at desc therefore returns Ind CC — that is the bug.
  const settings = [
    {
      company_id: IND_ID,
      company_name: "Massair Ind CC",
      updated_at: "2026-11-05T08:00:00.000Z",
      is_primary: true,
      id: "ind-settings",
      physical_address: "Ind address",
      vat_number: "4000000000",
      banking_details: { bank_name: "FNB", account_name: "Massair Ind CC", account_number: "62326769075", branch_code: "250655", account_type: "Cheque" },
      default_deposit_percentage: 50,
      default_payment_terms_days: 14,
    },
    {
      company_id: CT_ID,
      company_name: "Massair CT (Pty) Ltd",
      updated_at: "2026-10-12T08:00:00.000Z",
      is_primary: true,
      id: "ct-settings",
      physical_address: "9A Cabernet Rd, Blackheath Ind",
      vat_number: "4630313080",
      banking_details: { bank_name: "FNB", account_name: "Massair CT (Pty) Ltd", account_number: "63226563591", branch_code: "250655", account_type: "Cheque" },
      default_deposit_percentage: 70,
      default_payment_terms_days: 30,
    },
  ];
  const quote = {
    id: "q-ct",
    company_id: CT_ID,
    quote_number: "Q-2026-0099",
    subtotal: 100,
    vat_rate: 0.15,
    vat_amount: 15,
    total: 115,
    notes: null,
    valid_until: null,
    created_at: "2026-11-01T00:00:00.000Z",
    customer_name: "Cape Estates",
    terms_text: null,
    discount_type: null,
    discount_value: null,
    payment_plan: null,
    remote_quote: false,
    remote_quote_source: null,
    show_unit_cards: false,
    customers: null,
    customer_locations: null,
    leads: null,
  };
  const from = (table: string) => {
    const filters: { col: string; val: unknown }[] = [];
    const api: Record<string, unknown> = {};
    const chain = () => api;
    const pickSettings = () => {
      const companyId = filters.find((f) => f.col === "company_id")?.val;
      const newestFirst = [...settings].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const eligible = companyId ? newestFirst.filter((r) => r.company_id === companyId) : newestFirst;
      return eligible[0] ?? null;
    };
    const one = () => {
      if (table === "company_settings") return pickSettings();
      if (table === "quotes") return quote;
      return null;
    };
    api.select = chain;
    api.eq = (col: string, val: unknown) => { filters.push({ col, val }); return api; };
    api.in = chain;
    api.is = chain;
    api.order = chain;
    api.limit = chain;
    api.maybeSingle = async () => ({ data: one(), error: null });
    api.single = async () => ({ data: one(), error: null });
    api.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: table === "quotes" || table === "company_settings" ? one() : [], error: null });
    return api;
  };
  return {
    supabase: {
      from,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        getUser: async () => ({ data: { user: null } }),
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
    },
  };
});

afterEach(() => cleanup());

function renderDoc(ui: ReactElement): RenderResult {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const docProps = {
  estimateNumber: "Q-2026-0099",
  issueDate: "2026-11-01",
  customerName: "Cape Estates",
  items: [] as [],
  subtotal: 100,
  taxRate: 0.15,
  taxAmount: 15,
  grandTotal: 115,
};

const clause = (name: string) => `1.1 Thank you for considering ${name}.`;

describe("quote terms company name", () => {
  it("uses the quote company profile legal name, not another company's settings name", () => {
    const { container } = renderDoc(
      <EstimateDocument
        {...docProps}
        companyId={CT}
        companyProfile={{ company_id: CT, legal_name: "Massair CT (Pty) Ltd" }}
        companyOverride={{
          company_name: "Massair Ind CC",
          banking_details: { bank_name: "FNB", account_number: "62326769075", account_name: "Massair Ind CC" },
          default_deposit_percentage: 50,
        }}
      />,
    );
    const text = container.textContent || "";
    expect(text).toContain("1.1 Should you, the client");
    expect(text).toContain("Massair CT (Pty) Ltd");
    expect(text).not.toContain("Massair Ind CC");
  });

  it("uses the same legal name on the staff editor terms page", () => {
    const { container } = renderDoc(
      <EstimateDocument
        {...docProps}
        companyId={CT}
        companyProfile={{ company_id: CT, legal_name: "Massair CT (Pty) Ltd" }}
        companyOverride={{ company_name: "Massair Ind CC" }}
        editing={{
          areas: [],
          selectedLineId: null,
          onSelectLine: vi.fn(),
          onLineChange: vi.fn(),
          onDeleteLine: vi.fn(),
          onRenameArea: vi.fn(),
          onAddArea: vi.fn(),
          onNotesChange: vi.fn(),
        }}
      />,
    );
    const text = container.textContent || "";
    expect(text).toContain("1.1 Should you, the client");
    expect(text).toContain("Massair CT (Pty) Ltd");
    expect(text).not.toContain("Massair Ind CC");
  });

  it("keeps an Ind CC quote on that company's own legal name", () => {
    const { container } = renderDoc(
      <EstimateDocument
        {...docProps}
        companyId={IND}
        companyProfile={{ company_id: IND, legal_name: "MASSAIR IND CC" }}
        companyOverride={{ company_name: "Massair CT (Pty) Ltd" }}
      />,
    );
    const text = container.textContent || "";
    expect(text).toContain(clause("MASSAIR IND CC"));
    expect(text).not.toContain(clause("Massair CT (Pty) Ltd"));
  });

  it("does not read company settings at all when the quote company is unknown", async () => {
    await expect(fetchQuoteCompanySettings(null)).resolves.toBeNull();
    await expect(fetchQuoteCompanySettings(undefined)).resolves.toBeNull();
  });

  it("live client preview ignores a newer other-company settings row", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <LiveClientPreview
          quoteId="q-ct"
          companyId={CT}
          quoteNumber="Q-2026-0099"
          issueDate="2026-11-01"
          customerName="Cape Estates"
          vatRate={0.15}
          items={[]}
          areas={[]}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(container.textContent || "").toMatch(/63226563591|62326769075/);
    });
    const text = container.textContent || "";
    expect(text).toContain("1.1 Should you, the client");
    expect(text).toContain("Massair CT (Pty) Ltd");
    expect(text).toContain("63226563591");
    expect(text).not.toContain("Massair Ind CC");
    expect(text).not.toContain("62326769075");
  });

  it("staff quote PDF root ignores a newer other-company settings row", async () => {
    const { container } = renderDoc(<ClientQuotePdfRoot quoteId="q-ct" />);
    await waitFor(() => {
      const err = container.querySelector("[data-client-pdf-root]")?.getAttribute("data-error");
      expect(err || container.textContent || "").toMatch(/63226563591|62326769075/);
    });
    const err = container.querySelector("[data-client-pdf-root]")?.getAttribute("data-error");
    expect(err).toBeFalsy();
    const text = container.textContent || "";
    expect(text).toContain("1.1 Should you, the client");
    expect(text).toContain("Massair CT (Pty) Ltd");
    expect(text).toContain("63226563591");
    expect(text).not.toContain("Massair Ind CC");
    expect(text).not.toContain("62326769075");
  });
});
