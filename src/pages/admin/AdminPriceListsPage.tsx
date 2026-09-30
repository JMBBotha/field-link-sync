import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import VisualCatalogPanel from "@/components/catalog/quote-builder/VisualCatalogPanel";
import { resolveProductMarkupPercent } from "@/lib/pricing";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";

/**
 * Read-only Visual PDF price lists (central catalogue) — STEP 3, 2026-09-30.
 * Reps and staff browse the books here without opening a quote. Writes stay master-admin only (server RLS);
 * readOnly hides the delete/auto-catalogue actions.
 */
const AdminPriceListsPage = () => {
  const navigate = useNavigate();
  const { data: products = [] } = useQuery({
    queryKey: ["quote-builder-products"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, product_category, category, cost_price, cost_excl_vat, selling_price, description, is_pinned, pin_order, price_per_metre, sold_in_length, unit_length, pipe_size, pipe_liquid, pipe_gas, is_material_favorite, suggested_consumables, pack_qty, default_markup_percent, is_active, pdf_upload_id, suppliers(name, supplier_type)")
        .or("archived.is.null,archived.eq.false")
        .order("is_pinned", { ascending: false })
        .order("pin_order", { ascending: true, nullsFirst: false })
        .limit(2000);
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        product_category: p.product_category || p.category || "",
        supplier_name: p.suppliers?.name || "",
        supplier_type: p.suppliers?.supplier_type || "both",
        price_per_metre: p.price_per_metre || null,
        sold_in_length: p.sold_in_length || false,
        unit_length: p.unit_length || null,
        pipe_size: p.pipe_size || null,
        is_material_favorite: p.is_material_favorite || false,
        pack_qty: p.pack_qty || null,
        cost_price: p.cost_price ?? p.cost_excl_vat ?? 0,
        cost_excl_vat: p.cost_excl_vat ?? p.cost_price ?? 0,
        cost_incl_vat: 0,
        supplier_discount_percent: null,
        markup_percent: resolveProductMarkupPercent(p as any),
        default_markup_percent: resolveProductMarkupPercent(p as any),
      })) as PaletteProduct[];
    },
    staleTime: 60000,
  });

  return (
    <div className="h-[calc(100vh-4rem)] min-h-[480px] flex flex-col">
      <VisualCatalogPanel
        readOnly
        showCost
        open={true}
        onClose={() => navigate("/admin")}
        baskets={[]}
        onAddProductToBasket={() => {}}
        products={products}
      />
    </div>
  );
};

export default AdminPriceListsPage;
