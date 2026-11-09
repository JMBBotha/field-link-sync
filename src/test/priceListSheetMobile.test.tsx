import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";

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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => { throw new Error("price list demo must not read the catalogue"); },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null }) }) },
  },
}));

import PriceListSheet from "@/components/quoting/PriceListSheet";
import PriceListPane from "@/components/quoting/PriceListPane";

const demo = { label: "Demo wall-mount price list", heading: "Residential series" };

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function Host({ phone = true }: { phone?: boolean }) {
  const [open, setOpen] = useState(true);
  const [qc] = useState(client);
  return (
    <QueryClientProvider client={qc}>
      <PriceListSheet open={open} onOpenChange={setOpen} phone={phone} demo={demo} />
      <div data-testid="sheet-state">{open ? "open" : "closed"}</div>
    </QueryClientProvider>
  );
}

describe("Price list sheet on a phone (Johan, iPhone 14)", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
  });

  it("labelled Close next to Expand closes the sheet; the X and header clear the status bar", () => {
    render(<Host />);
    const sheet = screen.getByTestId("pricelist-sheet");
    expect(sheet.className).toContain("w-full");
    expect(sheet.className).toContain("max-w-none");
    expect(sheet.className).toContain("env(safe-area-inset-top");
    expect(sheet.className).toContain("env(safe-area-inset-bottom");
    const x = screen.getByRole("button", { name: /^Close$/ });
    expect(x.className).toContain("env(safe-area-inset-top");
    expect(x.className).not.toContain("top-4");
    const bar = screen.getByTestId("pricelist-toolbar");
    expect(bar.textContent).toMatch(/Expand/);
    expect(bar.textContent).toMatch(/Close/);
    const expand = screen.getByTestId("pricelist-expand");
    const close = screen.getByTestId("pricelist-sheet-close");
    expect(expand.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(close);
    expect(screen.getByTestId("sheet-state").textContent).toBe("closed");
  });

  it("expanded Close is large, keeps safe-area padding, and returns to the sheet", () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("pricelist-expand"));
    const full = screen.getByTestId("pricelist-fullpage");
    expect(full.className).toContain("env(safe-area-inset-top");
    expect(full.className).toContain("env(safe-area-inset-bottom");
    expect(full.className).toContain("pointer-events-auto");
    const close = screen.getByTestId("pricelist-close");
    expect(close.textContent).toMatch(/Close/);
    expect(close.className).toContain("h-12");
    expect(close.className).toContain("text-base");
    fireEvent.click(close);
    expect(screen.queryByTestId("pricelist-fullpage")).toBeNull();
    expect(screen.getByTestId("sheet-state").textContent).toBe("open");
    expect(screen.getByTestId("pricelist-toolbar")).toBeTruthy();
  });

  it("a wide sheet stays 60vw, and the inline pane has no sheet Close", () => {
    render(<Host phone={false} />);
    const sheet = screen.getByTestId("pricelist-sheet");
    expect(sheet.className).toContain("w-[60vw]");
    expect(sheet.className).not.toMatch(/(?:^|\s)w-full(?:\s|$)/);
    render(
      <QueryClientProvider client={client()}>
        <PriceListPane demo={demo} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByTestId("pricelist-expand").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId("pricelist-sheet-close")).toHaveLength(1);
  });

  it("EstimateBuilder uses this sheet; the shared sheet close stays top-4", () => {
    const eb = readFileSync("src/components/quoting/EstimateBuilder.tsx", "utf8");
    const sheet = readFileSync("src/components/ui/sheet.tsx", "utf8");
    const pane = readFileSync("src/components/quoting/PriceListPane.tsx", "utf8");
    expect(eb).toContain("<PriceListSheet");
    expect(eb).toContain("phone={isPhone}");
    expect(eb).not.toContain("data-testid=\"pricelist-sheet\"");
    expect(sheet).toContain("closeClassName");
    expect(sheet).toContain("absolute right-4 top-4");
    expect(pane).toContain("env(safe-area-inset-top");
    expect(pane).toContain("env(safe-area-inset-bottom");
    expect(pane).toContain('data-testid="pricelist-sheet-close"');
    expect(pane).toContain('data-testid="pricelist-close"');
  });
});
