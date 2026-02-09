import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Package, AlertTriangle, Download, RefreshCw, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { exportToCSV } from "@/lib/csvExport";

interface CatalogProduct {
  id: string;
  product_code: string;
  description: string;
  category: string | null;
  cost_price: number;
  selling_price: number;
  supplier_id: string;
  default_markup_percent: number;
  btu_rating: number | null;
  refrigerant_type: string | null;
  pipe_size: string | null;
  is_price_on_request: boolean;
  quote_usage_count: number;
}

interface SupplierInfo {
  id: string;
  name: string;
}

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const InventoryList = () => {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as SupplierInfo[];
    },
  });

  const { data: items = [], isLoading, refetch } = useQuery({
    queryKey: ["inventory-from-catalog"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products" as any)
        .select("id, product_code, description, category, cost_price, selling_price, supplier_id, default_markup_percent, btu_rating, refrigerant_type, pipe_size, is_price_on_request, quote_usage_count")
        .eq("is_active", true)
        .order("description");
      if (error) throw error;
      return (data || []) as unknown as CatalogProduct[];
    },
  });

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || "—";

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))] as string[];

  const filtered = items.filter((item) => {
    const matchesSearch =
      !search ||
      item.description.toLowerCase().includes(search.toLowerCase()) ||
      item.product_code?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const handleExportCSV = () => {
    const rows = filtered.map(i => ({
      SKU: i.product_code,
      Name: i.description,
      Category: i.category || "",
      "Cost Price": i.cost_price,
      "Sell Price": i.selling_price,
      Supplier: supplierName(i.supplier_id),
      BTU: i.btu_rating || "",
      Refrigerant: i.refrigerant_type || "",
      "Times Quoted": i.quote_usage_count,
    }));
    exportToCSV(rows, `inventory-export-${new Date().toISOString().split("T")[0]}`);
    toast({ title: `${rows.length} items exported` });
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {items.length} products from catalog
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={filtered.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Search and filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <Button
            variant={categoryFilter === null ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setCategoryFilter(null)}
          >
            All
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={categoryFilter === cat ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setCategoryFilter(cat)}
              className="text-xs"
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Sell</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-center">Quoted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {items.length === 0
                      ? "No products yet. Import from the Catalog page."
                      : "No matching products"}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">
                      {item.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-mono">
                      {item.product_code || "—"}
                    </TableCell>
                    <TableCell>
                      {item.category && (
                        <Badge variant="outline" className="text-xs">
                          {item.category}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground">
                      {item.is_price_on_request ? "POR" : formatZAR(item.cost_price)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold text-primary">
                      {item.is_price_on_request ? "POR" : formatZAR(item.selling_price)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {supplierName(item.supplier_id)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      {item.quote_usage_count || "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default InventoryList;
