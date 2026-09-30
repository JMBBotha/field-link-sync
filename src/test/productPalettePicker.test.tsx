import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductPalette, { isPipingProduct, type PaletteBundle } from "@/components/catalog/quote-builder/ProductPalette";
import { filterPaletteCatalog } from "@/lib/catalogSoT";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const product = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  product_code: id,
  short_name: name,
  description: "",
  brand: "Brand",
  product_category: "Consumables",
  category: "Consumables",
  cost_excl_vat: 100,
  cost_incl_vat: 115,
  cost_price: 100,
  selling_price: 135,
  default_markup_percent: 35,
  supplier_discount_percent: null,
  markup_percent: 35,
  is_pinned: false,
  pin_order: null,
  supplier_name: "Supplier",
  supplier_type: "both",
  price_per_metre: null,
  sold_in_length: false,
  unit_length: null,
  pipe_size: null,
  is_material_favorite: false,
  pack_qty: null,
  ...extra,
}) as any;

const copper = product("COPPER", "Copper tube");
const starred = product("STAR", "Starred material");
const other = product("OTHER", "Other material");
const pipingKit: PaletteBundle = {
  id: "pipe-kit",
  name: "Copper piping kit",
  description: null,
  bundle_type: "piping_kit",
  is_favorite: true,
  items: [{ id: "i1", supplier_product_id: copper.id, quantity: 1, length_metres: null, is_length_item: false, is_optional: false, product: copper }],
};
const plainKit: PaletteBundle = { ...pipingKit, id: "plain-kit", name: "Drain kit", bundle_type: "installation", is_favorite: false };

function palette(props: Partial<React.ComponentProps<typeof ProductPalette>> = {}) {
  return render(
    <ProductPalette
      products={[copper, starred, other]}
      isLoading={false}
      searchQuery=""
      onSearchChange={vi.fn()}
      categoryFilter="all"
      onCategoryChange={vi.fn()}
      favorites={new Set([starred.id])}
      onToggleFavorite={vi.fn()}
      usageMap={{}}
      bundles={[pipingKit, plainKit]}
      {...props}
    />,
  );
}

describe("ProductPalette piping and kits", () => {
  it("matches the MaterialsStep piping terms", () => {
    expect(isPipingProduct(copper)).toBe(true);
    expect(isPipingProduct(product("INS", "Foam", { description: "pipe insulation" }))).toBe(true);
    expect(isPipingProduct(other)).toBe(false);
  });

  it("shows Piping kits collapsed and expands them", () => {
    palette({ categoryFilter: "piping" });
    const row = screen.getByRole("button", { name: "Piping kits · 1" });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Copper piping kit")).not.toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByText("Copper piping kit")).toBeInTheDocument();
  });

  it("shows Bundles as a closed pill at the top under All and opens on click", () => {
    palette({ categoryFilter: "all" });
    const pill = screen.getByTestId("palette-bundles-pill");
    expect(pill).toHaveTextContent("Bundles · 2");
    expect(pill).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Copper piping kit")).not.toBeInTheDocument();
    fireEvent.click(pill);
    expect(pill).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Copper piping kit")).toBeInTheDocument();
    fireEvent.click(pill);
    expect(screen.queryByText("Copper piping kit")).not.toBeInTheDocument();
  });

  it("shows only favourite kits plus starred products in Favs", () => {
    palette({ categoryFilter: "favorites" });
    expect(screen.getByText(/Starred material/)).toBeInTheDocument();
    expect(screen.getByText("Copper piping kit")).toBeInTheDocument();
    expect(screen.queryByText("Drain kit")).not.toBeInTheDocument();
    expect(screen.queryByText("Other material")).not.toBeInTheDocument();
  });

  it("shows a matching kit while searching under a non-AC chip", () => {
    palette({ categoryFilter: "Batteries", searchQuery: "drain" });
    expect(screen.getByText((_, element) => element?.textContent === "Drain kit")).toBeInTheDocument();
  });
});

describe("palette-only live catalogue filter", () => {
  it("leaves the full products array untouched", () => {
    const live = product("LIVE", "Live", { is_active: true, pdf_upload_id: "book" });
    const stale = product("STALE", "Stale", { is_active: true, pdf_upload_id: "old" });
    const all = [live, stale];
    const kits = [{ ...pipingKit, items: [{ ...pipingKit.items[0], product: live }] }, { ...plainKit, items: [{ ...plainKit.items[0], product: stale }] }];
    const filtered = filterPaletteCatalog(all, kits, { ids: new Set(), codes: new Set(), activeUploadIds: new Set(["book"]), enforced: true });
    expect(filtered.products).toEqual([live]);
    expect(filtered.bundles).toHaveLength(1);
    expect(all).toHaveLength(2);
    expect(all[1]).toBe(stale);
  });
});