import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor, render, fireEvent, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

const env = vi.hoisted(() => ({ user: "lisa" as string | null, insertError: null as null | { message: string }, writes: [] as unknown[], panelProps: null as any, nav: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: env.user ? { user: { id: env.user } } : null } }),
    getUser: async () => ({ data: { user: env.user ? { id: env.user } : null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
  },
  from: (table: string) => {
    env.writes.push(["from", table]);
    return {
      select: () => ({ eq: async () => ({ data: [] }), or: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) }),
      insert: async (rows: unknown) => { env.writes.push(["insert", table, rows]); return { error: env.insertError }; },
      delete: () => ({ eq: () => ({ in: async () => ({ error: env.insertError }) }) }),
    };
  },
} }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ toast, useToast: () => ({ toast }) }));
vi.mock("@/lib/liveProducts", () => ({ filterLiveIds: async (ids: string[]) => new Set(ids) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<typeof import("react-router-dom")>()), useNavigate: () => env.nav }));
vi.mock("@/components/catalog/quote-builder/VisualCatalogPanel", () => ({ default: (props: any) => { env.panelProps = props; return <div data-testid="panel" />; } }));

import { useQuoteFavourites } from "@/hooks/useQuoteFavourites";
import PdfPageOverlay from "@/components/catalog/quote-builder/PdfPageOverlay";
import AdminPriceListsPage from "@/pages/admin/AdminPriceListsPage";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
);
beforeEach(() => { cleanup(); env.user = "lisa"; env.insertError = null; env.writes = []; env.panelProps = null; env.nav.mockReset(); toast.mockReset(); localStorage.clear(); });

describe("Visual PDF for sales users", () => {
  it("favourites go to product_favorites for the signed-in user (never supplier_products)", async () => {
    const { result } = renderHook(() => useQuoteFavourites(), { wrapper });
    await waitFor(() => expect(env.writes.some((w: any) => w[1] === "product_favorites")).toBe(true));
    await act(async () => { expect(await result.current.toggle("p1")).toBe(true); });
    expect(env.writes).toContainEqual(["insert", "product_favorites", [{ user_id: "lisa", product_id: "p1" }]]);
    expect(env.writes.some((w: any) => w[1] === "supplier_products")).toBe(false);
  });

  it("shows an error toast instead of failing silently when the favourite write is rejected", async () => {
    env.insertError = { message: "new row violates row-level security policy" };
    const { result } = renderHook(() => useQuoteFavourites(), { wrapper });
    await waitFor(() => expect(env.writes.length).toBeGreaterThan(0));
    await act(async () => { expect(await result.current.toggle("p1")).toBeNull(); });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't update favourite", variant: "destructive", description: expect.stringMatching(/permission/i) }));
  });

  it("shows an error toast when there is no signed-in user", async () => {
    env.user = null;
    const { result } = renderHook(() => useQuoteFavourites(), { wrapper });
    await act(async () => { expect(await result.current.toggle("p1")).toBeNull(); });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't update favourite", variant: "destructive" }));
  });

  it("a radio tap with nowhere to put the product shows a toast instead of doing nothing", () => {
    const product = { id: "p1", product_code: "X1", cost_price: 10, default_markup_percent: 20 } as PaletteProduct;
    render(<PdfPageOverlay regions={[{ id: "r1", x_pct: 0, y_pct: 40, w_pct: 100, h_pct: 20, product, product_code: "X1", label: "X1" }]} baskets={[]} basketProductCounts={{}} />);
    const strip = screen.getByTestId("pdf-margin-hit-strip");
    const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue(rect);
    if (strip.parentElement) vi.spyOn(strip.parentElement, "getBoundingClientRect").mockReturnValue(rect);
    fireEvent(strip, new MouseEvent("pointerdown", { bubbles: true, clientX: 99, clientY: 50 }));
    fireEvent(strip, new MouseEvent("pointerup", { bubbles: true, clientX: 99, clientY: 50 }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Open a quote to add products", variant: "destructive" }));
  });

  it("the price-lists viewer lets reps select rows into the draft basket and open a quote with them", async () => {
    render(<AdminPriceListsPage />, { wrapper });
    await waitFor(() => expect(env.panelProps).toBeTruthy());
    expect(env.panelProps.readOnly).toBe(true);
    expect(env.panelProps.pdfSelection).toBeTruthy();
    act(() => { env.panelProps.pdfSelection.handleSelectProduct({ code: "r1", description: "Copper", price: "100", productId: "p1" }); });
    await waitFor(() => expect(env.panelProps.pdfSelection.selectedFromPdf).toHaveLength(1));
    expect(JSON.parse(localStorage.getItem("fls.pdfBasket.draft") || "[]")[0]).toMatchObject({ code: "r1", productId: "p1", quantity: 1 });
    act(() => { env.panelProps.pdfSelection.setSelectedFromPdf((items: any[]) => items.filter((i) => i.code !== "r1")); });
    await waitFor(() => expect(env.panelProps.pdfSelection.selectedFromPdf).toHaveLength(0));
    env.panelProps.onAddSelectedToQuote();
    expect(env.nav).toHaveBeenCalledWith("/admin/quote-builder");
  });

  it("favourites stay enabled in the read-only viewer (per-user, not a catalogue write)", () => {
    const src = readFileSync(resolve(__dirname, "../components/catalog/quote-builder/VisualCatalogPanel.tsx"), "utf8");
    expect(src).toContain("onToggleFavorite={handleToggleFavorite}");
    expect(src).not.toMatch(/onToggleFavorite=\{readOnly \? undefined/);
    expect(src).not.toMatch(/from\("supplier_products"\)[^;]*update\([^)]*is_(material_favorite|pinned)/);
  });
});
