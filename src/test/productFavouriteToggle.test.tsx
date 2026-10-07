import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor, render, fireEvent, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useQuoteFavourites } from "@/hooks/useQuoteFavourites";
import PdfPageOverlay from "@/components/catalog/quote-builder/PdfPageOverlay";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

const db = vi.hoisted(() => ({ rows: ["samsung"], fail: false, writes: [] as unknown[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: (table: string) => {
    expect(table).toBe("product_favorites");
    return {
      select: () => ({ eq: async () => ({ data: db.rows.map(product_id => ({ product_id })) }) }),
      insert: async (rows: { user_id: string; product_id: string }[]) => {
        db.writes.push(rows);
        if (db.fail) return { error: new Error("denied") };
        db.rows.push(...rows.map(r => r.product_id)); return { error: null };
      },
      delete: () => ({ eq: (column: string, user: string) => ({ in: async (_column: string, ids: string[]) => {
        db.writes.push({ column, user, ids });
        if (db.fail) return { error: new Error("denied") };
        db.rows = db.rows.filter(id => !ids.includes(id)); return { error: null };
      } }) }),
    };
  },
} }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

beforeEach(() => { cleanup(); db.rows = ["samsung"]; db.fail = false; db.writes = []; });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

describe("personal favourite toggle", () => {
  it("deletes only this user's row, clears immediately, remains empty on reload and can add again", async () => {
    const { result } = renderHook(() => useQuoteFavourites(), { wrapper });
    await waitFor(() => expect(result.current.ids.has("samsung")).toBe(true));
    await act(async () => { expect(await result.current.toggle("samsung")).toBe(false); });
    await waitFor(() => expect(result.current.ids.size).toBe(0));
    expect(db.writes[0]).toEqual({ column: "user_id", user: "owner", ids: ["samsung"] });
    await act(async () => { expect(await result.current.toggle("samsung")).toBe(true); });
    await waitFor(() => expect(result.current.ids.has("samsung")).toBe(true));
  });
  it("restores the yellow favourite state when deletion fails", async () => {
    const { result } = renderHook(() => useQuoteFavourites(), { wrapper });
    await waitFor(() => expect(result.current.ids.has("samsung")).toBe(true));
    db.fail = true;
    await act(async () => { expect(await result.current.toggle("samsung")).toBeNull(); });
    expect(result.current.ids.has("samsung")).toBe(true);
    expect(db.rows).toEqual(["samsung"]);
  });
  it.each([false, true])("single tap selects and double tap toggles regardless of starred state (%s)", (starred) => {
    const toggle = vi.fn();
    const select = vi.fn();
    const product = { id: "samsung", product_code: "AR24BSAAAWK/FA", cost_price: 100, default_markup_percent: 25 } as PaletteProduct;
    render(<PdfPageOverlay regions={[{ id: "region", x_pct: 0, y_pct: 40, w_pct: 100, h_pct: 20, product, product_code: product.product_code, label: "Samsung" }]} baskets={[]} basketProductCounts={{}} favoriteIds={new Set(starred ? [product.id] : [])} onToggleFavorite={toggle} pdfSelection={{ selectedFromPdf: [], setSelectedFromPdf: vi.fn(), updateSelectedItem: vi.fn(), handleSelectProduct: select }} />);
    const strip = screen.getByTestId("pdf-margin-hit-strip");
    const rect = { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(strip, "getBoundingClientRect").mockReturnValue(rect);
    if (strip.parentElement) vi.spyOn(strip.parentElement, "getBoundingClientRect").mockReturnValue(rect);
    // jsdom does not provide PointerEvent; mouse-event coordinates exercise the same handler.
    fireEvent(strip, new MouseEvent("pointerdown", { bubbles: true, clientX: 99, clientY: 50 }));
    fireEvent(strip, new MouseEvent("pointerup", { bubbles: true, clientX: 99, clientY: 50 }));
    expect(select).toHaveBeenCalledWith(expect.objectContaining({ productId: "samsung" }));
    expect(toggle).not.toHaveBeenCalled();
    fireEvent(strip, new MouseEvent("pointerdown", { bubbles: true, clientX: 99, clientY: 50 }));
    fireEvent(strip, new MouseEvent("pointerup", { bubbles: true, clientX: 99, clientY: 50 }));
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ id: "samsung" }));
    expect(select).toHaveBeenCalledTimes(1);
  });
});