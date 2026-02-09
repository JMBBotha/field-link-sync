import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Search,
  Package,
  TrendingUp,
  Plus,
  ArrowUpDown,
  Filter,
  Loader2,
} from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface SupplierProduct {
  id: string;
  supplier_id: string;
  supplier_name: string;
  product_code: string;
  description: string;
  category: string;
  subcategory: string | null;
  pipe_size: string | null;
  cost_price: number;
  default_markup_percent: number;
  selling_price: number;
  is_price_on_request: boolean;
  btu_rating: number | null;
  refrigerant_type: string | null;
  image_url: string | null;
  quote_usage_count: number;
  last_quoted_at: string | null;
  search_rank: number;
}

interface ProductCatalogBrowserProps {
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
  supplierId?: string | null;
}

const ProductCatalogBrowser = ({ onAddToQuote, supplierId }: ProductCatalogBrowserProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [sortBy, setSortBy] = useState<"usage" | "price_asc" | "price_desc" | "name">("usage");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["supplier-products", searchQuery, selectedCategory, supplierId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("search_supplier_products", {
        p_query: searchQuery || null,
        p_category: selectedCategory || null,
        p_supplier_id: supplierId || null,
        p_limit: 100,
      });
      if (error) throw error;
      return (data || []) as SupplierProduct[];
    },
    enabled: true,
  });

  // Get unique categories
  const { data: categories = [] } = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products" as any)
        .select("category")
        .eq("is_active", true)
        .order("category");
      if (error) throw error;
      const unique = [...new Set((data || []).map((d: any) => d.category))].filter(Boolean);
      return unique as string[];
    },
  });

  const sorted = useMemo(() => {
    const arr = [...products];
    switch (sortBy) {
      case "price_asc": return arr.sort((a, b) => a.cost_price - b.cost_price);
      case "price_desc": return arr.sort((a, b) => b.cost_price - a.cost_price);
      case "name": return arr.sort((a, b) => a.description.localeCompare(b.description));
      default: return arr; // already sorted by usage from DB
    }
  }, [products, sortBy]);

  const incrementUsageMutation = useMutation({
    mutationFn: async (productId: string) => {
      await supabase.rpc("increment_product_usage", { p_product_id: productId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["supplier-products"] });
    },
  });

  const handleAddToQuote = (product: SupplierProduct) => {
    if (onAddToQuote) {
      onAddToQuote({
        description: `${product.product_code} - ${product.description}`,
        quantity: 1,
        unit_price: product.selling_price,
      });
      incrementUsageMutation.mutate(product.id);
      toast({ title: "Added to quote", description: product.product_code });
    }
  };

  return (
    <div className="space-y-4">
      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search products, codes, descriptions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-48">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-40">
            <ArrowUpDown className="h-3 w-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="usage">Most Quoted</SelectItem>
            <SelectItem value="price_asc">Price: Low→High</SelectItem>
            <SelectItem value="price_desc">Price: High→Low</SelectItem>
            <SelectItem value="name">Name A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results count */}
      <div className="text-xs text-muted-foreground">
        {isLoading ? "Searching..." : `${sorted.length} products found`}
      </div>

      {/* Product Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No products found. Import a price list to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((product) => (
            <Card key={product.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-primary font-semibold">{product.product_code}</p>
                    <p className="text-sm font-medium mt-0.5 line-clamp-2">{product.description}</p>
                  </div>
                  {product.quote_usage_count > 0 && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      <TrendingUp className="h-3 w-3 mr-0.5" />
                      {product.quote_usage_count}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-1 mb-3">
                  <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                  {product.pipe_size && (
                    <Badge variant="outline" className="text-[10px]">⌀ {product.pipe_size}</Badge>
                  )}
                  {product.btu_rating && (
                    <Badge variant="outline" className="text-[10px]">{(product.btu_rating / 1000).toFixed(0)}K BTU</Badge>
                  )}
                  {product.refrigerant_type && (
                    <Badge variant="outline" className="text-[10px]">{product.refrigerant_type}</Badge>
                  )}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">{product.supplier_name}</Badge>
                </div>

                <Separator className="mb-3" />

                <div className="flex items-end justify-between">
                  <div>
                    {product.is_price_on_request ? (
                      <p className="text-sm font-semibold text-muted-foreground">POR</p>
                    ) : (
                      <>
                        <p className="text-[10px] text-muted-foreground">Cost: {formatZAR(product.cost_price)}</p>
                        <p className="text-sm font-bold text-primary">{formatZAR(product.selling_price)}</p>
                        <p className="text-[10px] text-muted-foreground">({product.default_markup_percent}% markup)</p>
                      </>
                    )}
                  </div>
                  {onAddToQuote && !product.is_price_on_request && (
                    <Button size="sm" onClick={() => handleAddToQuote(product)} className="h-7 text-xs">
                      <Plus className="h-3 w-3 mr-1" /> Add to Quote
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductCatalogBrowser;
