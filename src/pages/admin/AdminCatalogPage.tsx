import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Search, Upload, GitCompare, Package, Snowflake, Wrench, Layers } from "lucide-react";
import SupplierManager from "@/components/catalog/SupplierManager";
import SupplierProductImporter from "@/components/catalog/SupplierProductImporter";
import ProductCatalogBrowser from "@/components/catalog/ProductCatalogBrowser";
import SupplierComparison from "@/components/catalog/SupplierComparison";
import ConsumablesCatalogTable from "@/components/catalog/ConsumablesCatalogTable";
import BundlesList from "@/components/catalog/BundlesList";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type SupplierTypeFilter = "all" | "ac_units" | "consumables";

const AdminCatalogPage = () => {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [tab, setTab] = useState("browse");
  const [importKey, setImportKey] = useState(0);
  const [supplierTypeFilter, setSupplierTypeFilter] = useState<SupplierTypeFilter>("all");

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

  const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
  const selectedSupplierName = selectedSupplier?.name || "";
  const isConsumablesSupplier = selectedSupplier?.supplier_type === "consumables";

  const acCount = suppliers.filter(s => s.supplier_type !== "consumables").length;
  const consumableCount = suppliers.filter(s => s.supplier_type === "consumables").length;

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold">Product Catalog</h2>
      </div>

      {/* Supplier type filter pills */}
      <div className="flex flex-wrap gap-2">
        <Badge
          variant={supplierTypeFilter === "all" ? "default" : "outline"}
          className="cursor-pointer text-xs gap-1"
          onClick={() => setSupplierTypeFilter("all")}
        >
          All ({suppliers.length})
        </Badge>
        <Badge
          variant={supplierTypeFilter === "ac_units" ? "default" : "outline"}
          className="cursor-pointer text-xs gap-1"
          onClick={() => setSupplierTypeFilter("ac_units")}
        >
          <Snowflake className="h-3 w-3" /> AC Units ({acCount})
        </Badge>
        <Badge
          variant={supplierTypeFilter === "consumables" ? "default" : "outline"}
          className={`cursor-pointer text-xs gap-1 ${
            supplierTypeFilter === "consumables"
              ? "bg-orange-600 hover:bg-orange-700 border-orange-600"
              : "border-orange-500/50 text-orange-600"
          }`}
          onClick={() => setSupplierTypeFilter("consumables")}
        >
          <Wrench className="h-3 w-3" /> Consumables ({consumableCount})
        </Badge>
      </div>

      <SupplierManager
        selectedSupplierId={selectedSupplierId}
        onSelectSupplier={setSelectedSupplierId}
        supplierTypeFilter={supplierTypeFilter === "all" ? undefined : supplierTypeFilter}
      />

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
        </TabsList>

        <TabsContent value="browse" className="mt-4">
          {selectedSupplierId && isConsumablesSupplier ? (
            <ConsumablesCatalogTable supplierId={selectedSupplierId} />
          ) : (
            <ProductCatalogBrowser supplierId={selectedSupplierId} />
          )}
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          {selectedSupplierId ? (
            <SupplierProductImporter
              key={importKey}
              supplierId={selectedSupplierId}
              supplierName={selectedSupplierName}
              isConsumablesSupplier={isConsumablesSupplier}
              onComplete={() => setImportKey((k) => k + 1)}
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
      </Tabs>
    </div>
  );
};

export default AdminCatalogPage;
