import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, Upload, GitCompare, Package, Snowflake, Wrench, Layers, Zap, BatteryCharging, Droplets, PenTool, Ruler, Loader2 } from "lucide-react";
import SupplierManager from "@/components/catalog/SupplierManager";
import BrandDiscountsSection from "@/components/catalog/BrandDiscountsSection";
import SupplierProductImporter from "@/components/catalog/SupplierProductImporter";
import ProductCatalogBrowser from "@/components/catalog/ProductCatalogBrowser";
import SupplierComparison from "@/components/catalog/SupplierComparison";
import ConsumablesCatalogTable from "@/components/catalog/ConsumablesCatalogTable";
import BundlesList from "@/components/catalog/BundlesList";
import QuoteBuilderTab from "@/components/catalog/QuoteBuilderTab";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const PRODUCT_CATEGORIES = [
  { value: "all", label: "All", icon: Package },
  { value: "Air Conditioning", label: "Air Conditioning", icon: Snowflake },
  { value: "Water Heaters", label: "Water Heaters", icon: Droplets },
  { value: "Inverters", label: "Inverters", icon: Zap },
  { value: "Batteries", label: "Batteries", icon: BatteryCharging },
  { value: "Consumables", label: "Consumables", icon: Wrench },
] as const;

type ProductCategoryFilter = typeof PRODUCT_CATEGORIES[number]["value"];

const AdminCatalogPage = () => {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [tab, setTab] = useState("browse");
  const [importKey, setImportKey] = useState(0);
  const [categoryFilter, setCategoryFilter] = useState<ProductCategoryFilter>("all");
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();

  const handleScanLengths = async () => {
    setScanning(true);
    try {
      // Fetch all products that don't yet have price_per_metre set
      const { data: products, error } = await (supabase.from("supplier_products") as any)
        .select("id, description, short_name, cost_excl_vat, cost_price, sold_in_length, price_per_metre, unit_length")
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;

      // Match length in meters: after 'X' separator (e.g. "12.70X0.91X15.24M"), 
      // or standalone number+M (e.g. "50M", "15M") but NOT MM (millimeters)
      const lengthRegex = /(?:^|[X×x\s])(\d+\.?\d*)M(?:\s|$|-)/i;
      let updated = 0;
      let matched = 0;
      let skipped = 0;
      let alreadySet = 0;

      console.log(`[Scan] Total products fetched: ${(products || []).length}`);
      console.log(`[Scan] Regex: ${lengthRegex}`);

      // Log first 5 products for debugging
      (products || []).slice(0, 5).forEach((p: any, i: number) => {
        console.log(`[Scan] Product ${i}: id=${p.id}, short_name="${(p.short_name || '').slice(0,30)}", desc="${(p.description || '').slice(0,80)}"`);
      });

      for (const p of (products || [])) {
        if (p.sold_in_length) alreadySet++;

        const text = p.description || p.short_name || "";
        const match = text.match(lengthRegex);
        if (match) {
          matched++;
          const rollLength = parseFloat(match[1]);
          if (rollLength > 0) {
            const cost = p.cost_excl_vat || p.cost_price || 0;
            const pricePerMetre = cost / rollLength;
            console.log(`[Scan] MATCH id=${p.id} length=${rollLength}m cost=${cost} ppm=${pricePerMetre.toFixed(2)} current_sil=${p.sold_in_length} current_ppm=${p.price_per_metre}`);
            const { error: uErr } = await (supabase.from("supplier_products") as any)
              .update({
                sold_in_length: true,
                price_per_metre: Math.round(pricePerMetre * 100) / 100,
                unit_length: rollLength,
              })
              .eq("id", p.id);
            if (uErr) {
              console.error(`[Scan] UPDATE FAILED for ${p.id}:`, uErr);
              skipped++;
            } else {
              updated++;
            }
          }
        }
      }

      console.log(`[Scan] Summary: matched=${matched}, updated=${updated}, skipped=${skipped}, alreadySet=${alreadySet}`);

      queryClient.invalidateQueries({ queryKey: ["quote-builder-products"] });
      queryClient.invalidateQueries({ queryKey: ["product-category-counts"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-products-all"] });
      toast.success(
        `Scanned ${(products || []).length} products — matched ${matched}, updated ${updated}, errors ${skipped}, already set ${alreadySet}`,
        { duration: 30000 }
      );
    } catch (e: any) {
      toast.error(e.message || "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name, is_active, supplier_type")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as unknown as { id: string; name: string; is_active: boolean; supplier_type: string }[];
    },
  });

  // Product counts per category
  const { data: categoryCounts = {} } = useQuery({
    queryKey: ["product-category-counts"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("product_category")
        .or("archived.is.null,archived.eq.false");
      if (error) throw error;
      const counts: Record<string, number> = {};
      let total = 0;
      (data || []).forEach((row: any) => {
        const cat = row.product_category || "Air Conditioning";
        counts[cat] = (counts[cat] || 0) + 1;
        total++;
      });
      counts["all"] = total;
      return counts;
    },
  });

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const selectedSupplierName = selectedSupplier?.name || "";
  const isConsumablesSupplier = selectedSupplier?.supplier_type === "consumables";

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Product Catalog</h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={handleScanLengths}
          disabled={scanning}
        >
          {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ruler className="h-3.5 w-3.5" />}
          {scanning ? "Scanning..." : "Scan & Calculate /m Pricing"}
        </Button>
      </div>

      {/* Product category filter pills */}
      <div className="flex flex-wrap gap-2">
        {PRODUCT_CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.value] || 0;
          const Icon = cat.icon;
          const isActive = categoryFilter === cat.value;
          const isConsumable = cat.value === "Consumables";
          return (
            <Badge
              key={cat.value}
              variant={isActive ? "default" : "outline"}
              className={`cursor-pointer text-xs gap-1 ${
                isConsumable && isActive
                  ? "bg-orange-600 hover:bg-orange-700 border-orange-600"
                  : isConsumable && !isActive
                  ? "border-orange-500/50 text-orange-600"
                  : ""
              }`}
              onClick={() => setCategoryFilter(cat.value)}
            >
              <Icon className="h-3 w-3" />
              {cat.label} ({count})
            </Badge>
          );
        })}
      </div>

      <SupplierManager
        selectedSupplierId={selectedSupplierId}
        onSelectSupplier={setSelectedSupplierId}
      />

      <BrandDiscountsSection />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="browse" className="gap-1.5">
            <Search className="h-3.5 w-3.5" /> Browse
          </TabsTrigger>
          <TabsTrigger value="import" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Import
          </TabsTrigger>
          <TabsTrigger value="compare" className="gap-1.5">
            <GitCompare className="h-3.5 w-3.5" /> Compare
          </TabsTrigger>
          <TabsTrigger value="bundles" className="gap-1.5">
            <Layers className="h-3.5 w-3.5" /> Bundles
          </TabsTrigger>
          <TabsTrigger value="quote-builder" className="gap-1.5">
            <PenTool className="h-3.5 w-3.5" /> Quote Builder
          </TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="mt-4">
          {selectedSupplierId && categoryFilter === "Consumables" ? (
            <ConsumablesCatalogTable supplierId={selectedSupplierId} />
          ) : (
            <ProductCatalogBrowser
              supplierId={selectedSupplierId}
              productCategoryFilter={categoryFilter === "all" ? undefined : categoryFilter}
            />
          )}
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          {selectedSupplierId ? (
            <SupplierProductImporter
              key={importKey}
              supplierId={selectedSupplierId}
              supplierName={selectedSupplierName}
              isConsumablesSupplier={isConsumablesSupplier}
              onComplete={() => {
                setImportKey((k) => k + 1);
                // Invalidate category counts
              }}
            />
          ) : (
            <div className="text-center py-12">
              <Upload className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Select a supplier above to import their price list.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <SupplierComparison />
        </TabsContent>

        <TabsContent value="bundles" className="mt-4">
          <BundlesList />
        </TabsContent>

        <TabsContent value="quote-builder" className="mt-4">
          <QuoteBuilderTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminCatalogPage;
