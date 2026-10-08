import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";

const product = { id: "p1", product_code: "AC12", short_name: "Split 12k", brand: "X", cost_price: 100, selling_price: 125, supplier_type: "ac" };
const addItem = vi.fn(async (row: any) => ({ id: "line1", ...row }));
let release: (() => void) | null = null;

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), auth: { getUser: vi.fn() } } }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [product], isLoading: false }) }));
vi.mock("@/contexts/QuoteContext", () => ({ useQuoteContext: () => ({ areas: [], items: [], addItem, addArea: vi.fn(), meta: { company_id: "c1" } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useQuoteFavourites", () => ({ useQuoteFavourites: () => ({ isFavourite: () => true, ids: ["p1"] }), groupFavourites: () => ({ units: [product], materials: [] }) }));
vi.mock("@/hooks/useActiveSpecials", () => ({ useActiveSpecials: () => ({ find: () => null }) }));
vi.mock("@/components/specials/SpecialsUi", () => ({ SpecialChip: () => null, useSpecialPrompt: () => ({ dialog: null, ask: vi.fn() }) }));
vi.mock("@/hooks/useQuoteBuilderBundles", () => ({ useQuoteBuilderBundles: () => ({ bundles: [] }) }));
vi.mock("@/hooks/useInstallTemplates", () => ({ useInstallTemplates: () => ({ templates: [] }) }));
vi.mock("@/hooks/useQuoteBuilderProducts", () => ({ useQuoteBuilderProducts: () => ({ products: [] }) }));
vi.mock("@/hooks/useCatalogServices", () => ({ useCatalogServices: () => ({ services: [], masterName: "", refetch: vi.fn() }) }));
vi.mock("@/lib/catalogSoT", () => ({ fetchVisualCatalogAllowlist: vi.fn(), filterToVisualCatalog: (x: any) => x }));
vi.mock("@/lib/liveProducts", () => ({ liveProducts: vi.fn() }));
vi.mock("@/lib/mandy/quoteOps", () => ({
  isAirConditioningProduct: () => true,
  catalogLineFields: () => ({ unit_price: 1 }),
  addCatalogProductToQuote: vi.fn(async ({ addItem: add }: any) => {
    if (release === null) { const line = await add({ product_id: "p1", item_name: "Split 12k", item_type: "product", metadata: {} }); return { line, notes: [] }; }
    await new Promise<void>((r) => { release = r; });
    const line = await add({ product_id: "p1", item_name: "Split 12k", item_type: "product", metadata: {} });
    return { line, notes: [] };
  }),
}));

import QuoteQuickEditor from "@/components/quoting/QuoteQuickEditor";

const row = () => screen.getByText("Split 12k").closest("button") as HTMLButtonElement;

describe("QuoteQuickEditor closes after a pick", () => {
  beforeEach(() => { addItem.mockClear(); release = null; });

  it("click on a favourite adds once and closes", async () => {
    const onClose = vi.fn();
    render(<QuoteQuickEditor mode="unit" targetAreaId="a1" onClose={onClose} />);
    fireEvent.click(row());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("Enter on a focused row adds once and closes", async () => {
    const onClose = vi.fn();
    render(<QuoteQuickEditor mode="unit" targetAreaId="a1" onClose={onClose} />);
    const b = row(); b.focus();
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.click(b); // native buttons fire click on Enter
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("a second fast click while adding does not add twice", async () => {
    const onClose = vi.fn();
    release = () => {};
    render(<QuoteQuickEditor mode="unit" targetAreaId="a1" onClose={onClose} />);
    const b = row();
    fireEvent.click(b);
    fireEvent.click(b);
    await waitFor(() => expect(typeof release).toBe("function"));
    await act(async () => { release!(); });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(addItem).toHaveBeenCalledTimes(1);
  });

  it("createTargetArea no longer opens a new picker", () => {
    const src = readFileSync(resolve(__dirname, "../components/quoting/EstimateBuilder.tsx"), "utf8");
    const block = src.slice(src.indexOf("createTargetArea:"), src.indexOf("onChanged,", src.indexOf("createTargetArea:")));
    expect(block).not.toMatch(/setOpenAdd/);
  });
});
