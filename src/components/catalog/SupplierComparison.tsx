import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GitCompare, TrendingDown, TrendingUp, Minus } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface ComparisonProduct {
  id: string;
  supplier_id: string;
  product_code: string;
  description: string;
  category: string;
  btu_rating: number | null;
  pipe_size: string | null;
  cost_price: number;
  selling_price: number;
  is_price_on_request: boolean;
  default_markup_percent: number;
  discounted_cost: number | null;
}

interface SupplierComparisonProps {
  category?: string;
}

const SupplierComparison = ({ category }: SupplierComparisonProps) => {
  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers-for-compare"],
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

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["comparison-products", category],
    queryFn: async () => {
      let query = supabase
        .from("supplier_products" as any)
        .select("id, supplier_id, product_code, description, category, btu_rating, pipe_size, cost_price, selling_price, is_price_on_request, default_markup_percent, discounted_cost")
        .eq("is_active", true)
        .order("btu_rating", { ascending: true });

      if (category) query = query.eq("category", category);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ComparisonProduct[];
    },
  });

  // Group products by BTU rating for comparison
  const grouped = useMemo(() => {
    const groups = new Map<string, ComparisonProduct[]>();
    products.forEach((p) => {
      const key = `${p.btu_rating || "N/A"}-${p.category}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    });
    // Only return groups with products from multiple suppliers
    return Array.from(groups.entries())
      .map(([key, items]) => ({
        key,
        btu: items[0].btu_rating,
        category: items[0].category,
        products: items,
        supplierIds: [...new Set(items.map((i) => i.supplier_id))],
      }))
      .filter((g) => g.supplierIds.length > 1)
      .sort((a, b) => (a.btu || 0) - (b.btu || 0));
  }, [products]);

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name || "Unknown";

  if (isLoading) return <p className="text-sm text-muted-foreground p-4">Loading comparison...</p>;

  if (grouped.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <GitCompare className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No comparable products found across suppliers. Import products from 2+ suppliers with matching BTU ratings to see comparisons.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <GitCompare className="h-4 w-4" />
        Supplier Price Comparison
      </h3>

      {grouped.map((group) => {
        const lowestPrice = Math.min(...group.products.filter((p) => !p.is_price_on_request && (p.discounted_cost || p.cost_price) > 0).map((p) => p.discounted_cost || p.cost_price));

        return (
          <Card key={group.key}>
            <CardHeader className="py-2 px-4">
              <CardTitle className="text-xs flex items-center gap-2">
                {group.category}
                {group.btu && <Badge variant="secondary" className="text-[10px]">{(group.btu / 1000).toFixed(0)}K BTU</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Supplier</TableHead>
                    <TableHead className="text-xs">Product Code</TableHead>
                    <TableHead className="text-xs text-right">Cost Price</TableHead>
                    <TableHead className="text-xs text-right">Sell Price</TableHead>
                    <TableHead className="text-xs text-center">vs Best</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.products
                    .sort((a, b) => a.cost_price - b.cost_price)
                    .map((product) => {
                      const diff = product.cost_price > 0 && lowestPrice > 0
                        ? ((product.cost_price - lowestPrice) / lowestPrice * 100)
                        : 0;
                      const isBest = product.cost_price === lowestPrice && !product.is_price_on_request;

                      return (
                        <TableRow key={product.id}>
                          <TableCell className="text-xs font-medium">{supplierName(product.supplier_id)}</TableCell>
                          <TableCell className="text-xs font-mono">{product.product_code}</TableCell>
                          <TableCell className="text-xs text-right">
                            {product.is_price_on_request ? "POR" : formatZAR(product.cost_price)}
                          </TableCell>
                          <TableCell className="text-xs text-right font-semibold">
                            {product.is_price_on_request ? "POR" : formatZAR(product.selling_price)}
                          </TableCell>
                          <TableCell className="text-center">
                            {product.is_price_on_request ? (
                              <Minus className="h-3 w-3 mx-auto text-muted-foreground" />
                            ) : isBest ? (
                              <Badge className="text-[10px] bg-success/20 text-success border-success/30">Best</Badge>
                            ) : (
                              <span className="text-[10px] text-destructive">+{diff.toFixed(1)}%</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};

export default SupplierComparison;
