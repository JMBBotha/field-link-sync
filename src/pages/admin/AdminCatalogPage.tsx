import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Upload, GitCompare, Package } from "lucide-react";
import SupplierManager from "@/components/catalog/SupplierManager";
import SupplierProductImporter from "@/components/catalog/SupplierProductImporter";
import ProductCatalogBrowser from "@/components/catalog/ProductCatalogBrowser";
import SupplierComparison from "@/components/catalog/SupplierComparison";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const AdminCatalogPage = () => {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [tab, setTab] = useState("browse");
  const [importKey, setImportKey] = useState(0);

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const selectedSupplierName = suppliers.find((s) => s.id === selectedSupplierId)?.name || "";

  return (
    <div className="p-4 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold">Product Catalog</h2>
      </div>

      <SupplierManager
        selectedSupplierId={selectedSupplierId}
        onSelectSupplier={setSelectedSupplierId}
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
        </TabsList>

        <TabsContent value="browse" className="mt-4">
          <ProductCatalogBrowser supplierId={selectedSupplierId} />
        </TabsContent>

        <TabsContent value="import" className="mt-4">
          {selectedSupplierId ? (
            <SupplierProductImporter
              key={importKey}
              supplierId={selectedSupplierId}
              supplierName={selectedSupplierName}
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
      </Tabs>
    </div>
  );
};

export default AdminCatalogPage;
