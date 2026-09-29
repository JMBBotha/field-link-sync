import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/useCompanySettings", () => ({ useCompanySettings: () => ({ settings: { company_name: "", physical_address: "", vat_number: "", banking_details: {}, default_deposit_percentage: 70, default_payment_terms_days: 30 } }) }));
vi.mock("@/components/catalog/MasterCatalogGate", () => ({
  useCanWriteMasterCatalog: vi.fn(),
}));
vi.mock("@/components/settings/ServicesCatalogCard", () => ({ default: () => <div>services-card</div> }));

import QuoteBuilderLayout, { SIDE_PANEL_KEY, LEFT_PANEL_KEY } from "@/components/quoting/QuoteBuilderLayout";
import EstimateDocument, { type EstimateEditArea } from "@/components/quoting/EstimateDocument";
import ServicesTab from "@/components/settings/ServicesTab";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";

const areas = (extra = 0): EstimateEditArea[] =>
  [0, 1, 2].map((a) => ({
    id: `a${a}`,
    name: `Area ${a + 1}`,
    lines: Array.from({ length: 12 + (a === 2 ? extra : 0) }, (_, n) => ({
      id: `a${a}-l${n}`, name: `Line ${n}`, description: null, quantity: 1, unit_price: n === 0 && a === 0 ? 0 : 100,
      isService: n === 0 && a === 0,
    })),
  }));

const doc = (list: EstimateEditArea[]) => (
  <EstimateDocument
    estimateNumber="Q1" issueDate="2026-09-28" customerName="C" items={[]} subtotal={0} taxRate={0.15} taxAmount={0} grandTotal={0}
    editing={{ areas: list, selectedLineId: null, onSelectLine: () => {}, onLineChange: () => {}, onDeleteLine: () => {}, onRenameArea: () => {}, onAddArea: () => {} }}
  />
);

const wrap = (n: ReactNode) => <QueryClientProvider client={new QueryClient()}>{n}</QueryClientProvider>;

describe("quote builder layout", () => {
  beforeEach(() => localStorage.clear());

  it("3 areas × 12 lines: middle scrolls on its own, side closed, spacer present", () => {
    render(<QuoteBuilderLayout compact={false} middle={doc(areas())} side={<div>summary</div>} stickyPad="4rem" />);
    const mid = screen.getByTestId("qb-middle");
    expect(mid.className).toMatch(/overflow-y-auto/);
    expect(mid.className).toMatch(/min-h-0/);
    expect(mid.querySelectorAll("[data-line-id]").length).toBe(36);
    // last line is followed by the sticky-bar spacer inside the same scroller
    const spacer = screen.getByTestId("qb-sticky-spacer");
    expect(mid.lastElementChild).toBe(spacer);
    expect(spacer.dataset.pad).toBe("4rem");
    expect(screen.getByTestId("qb-side").dataset.state).toBe("closed");
    expect(screen.queryByText("summary")).toBeNull();
    expect(screen.getByText("price not set")).toBeTruthy();
  });

  it("side panel reads and writes localStorage", () => {
    const { unmount } = render(<QuoteBuilderLayout compact={false} middle={<div />} side={<div>summary</div>} />);
    expect(localStorage.getItem(SIDE_PANEL_KEY)).toBe("0");
    fireEvent.click(screen.getByLabelText("Show quote summary"));
    expect(localStorage.getItem(SIDE_PANEL_KEY)).toBe("1");
    unmount();
    render(<QuoteBuilderLayout compact={false} middle={<div />} side={<div>summary</div>} />);
    expect(screen.getByTestId("qb-side").dataset.state).toBe("open");
    expect(screen.getByText("summary")).toBeTruthy();
  });

  it("adding a line scrolls it into view", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(doc(areas()));
    expect(spy).not.toHaveBeenCalled();
    rerender(doc(areas(1)));
    expect(spy).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
    expect(spy.mock.contexts[0]).toHaveProperty("dataset.lineId", "a2-l12");
  });

  it("renders add controls inside every area block, hidden from the PDF", () => {
    const list = areas();
    render(
      <EstimateDocument
        estimateNumber="Q2" issueDate="2026-09-28" customerName="C" items={[]} subtotal={0} taxRate={0.15} taxAmount={0} grandTotal={0}
        editing={{
          areas: list, selectedLineId: null, onSelectLine: () => {}, onLineChange: () => {}, onDeleteLine: () => {}, onRenameArea: () => {}, onAddArea: () => {},
          renderAreaAdd: (id) => <div data-testid={`area-add-${id}`}>add</div>,
        }}
      />,
    );
    for (const a of list) {
      const el = screen.getByTestId(`area-add-${a.id}`);
      expect(el.closest("[data-pdf-hide]")).toBeTruthy();
      expect(el.closest(`[data-area-id="${a.id}"]`)).toBeTruthy();
    }
  });
});

describe("Settings → Services tab gate", () => {
  it("renders nothing while loading or when not a master admin; card when allowed", () => {
    const m = vi.mocked(useCanWriteMasterCatalog);
    m.mockReturnValue({ canWrite: false, isLoading: true });
    const a = render(wrap(<ServicesTab />));
    expect(a.container.textContent).toBe("");
    a.unmount();
    m.mockReturnValue({ canWrite: false, isLoading: false });
    const b = render(wrap(<ServicesTab />));
    expect(b.container.textContent).toBe("");
    b.unmount();
    m.mockReturnValue({ canWrite: true, isLoading: false });
    render(wrap(<ServicesTab />));
    expect(screen.getByText("services-card")).toBeTruthy();
  });
});
