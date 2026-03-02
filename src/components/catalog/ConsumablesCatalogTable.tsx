import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import BulkActionBar from "@/components/bulk/BulkActionBar";
import { useToast } from "@/hooks/use-toast";
import { Package, Ruler, Calculator, ArrowUpDown, Search, Loader2, Trash2 } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface ConsumableProduct {
  id: string;
  product_code: string;
  description: string;
  category: string;
  cost_price: number;
  selling_price: number;
  default_markup_percent: number;
  sold_in_length: boolean;
  unit_length: number | null;
  unit_length_unit: string;
  price_per_metre: number | null;
  min_cut_length: number;
  is_price_on_request: boolean;
  pipe_size: string | null;
  pack_qty: number | null;
}

interface ConsumablesCatalogTableProps {
  supplierId: string;
}

type SortKey = "product_code" | "description" | "category" | "cost_price" | "unit_length" | "price_per_metre" | "default_markup_percent" | "selling_price";

const ConsumablesCatalogTable = ({ supplierId }: ConsumablesCatalogTableProps) => {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("description");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [categoryFilter, setCategoryFilter] = useState<string>("__all__");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["consumable-products", supplierId],
    queryFn: async () => {
      const { data, error } = await (supabase
        .from("supplier_products") as any)
        .select("id, product_code, description, category, cost_price, selling_price, default_markup_percent, sold_in_length, unit_length, unit_length_unit, price_per_metre, min_cut_length, is_price_on_request, pipe_size, archived, pack_qty")
        .eq("supplier_id", supplierId)
        .or("archived.is.null,archived.eq.false")
        .eq("product_type", "consumable")
        .order("description");
      if (error) throw error;
      return (data || []) as unknown as ConsumableProduct[];
    },
  });

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    return [...cats].sort();
  }, [products]);

  const filtered = useMemo(() => {
    let items = products;
    if (categoryFilter !== "__all__") {
      items = items.filter(p => p.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(p =>
        p.product_code.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    return items;
  }, [products, search, categoryFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let aVal: any = (a as any)[sortKey] ?? "";
      let bVal: any = (b as any)[sortKey] ?? "";
      if (typeof aVal === "string") aVal = aVal.toLowerCase();
      if (typeof bVal === "string") bVal = bVal.toLowerCase();
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await (supabase.from("supplier_products") as any)
        .delete()
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumable-products"] });
      queryClient.invalidateQueries({ queryKey: ["supplier-product-counts"] });
      toast({ title: `${selectedIds.size} products deleted` });
      setSelectedIds(new Set());
      setConfirmBulkDelete(false);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === sorted.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sorted.map(p => p.id)));
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const SortHeader = ({ label, colKey, className = "" }: { label: string; colKey: SortKey; className?: string }) => (
    <th
      className={`p-2 font-medium text-left cursor-pointer hover:text-foreground transition-colors select-none ${className}`}
      onClick={() => toggleSort(colKey)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === colKey && (
          <ArrowUpDown className="h-3 w-3 text-primary" />
        )}
      </span>
    </th>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        actions={[
          {
            label: "Delete",
            icon: <Trash2 className="h-3.5 w-3.5" />,
            onClick: () => setConfirmBulkDelete(true),
            variant: "destructive",
          },
        ]}
      />

      {/* Search + Category filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search consumables..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge
            variant={categoryFilter === "__all__" ? "default" : "outline"}
            className="cursor-pointer text-[10px]"
            onClick={() => setCategoryFilter("__all__")}
          >
            All ({products.length})
          </Badge>
          {categories.map(cat => {
            const count = products.filter(p => p.category === cat).length;
            return (
              <Badge
                key={cat}
                variant={categoryFilter === cat ? "default" : "outline"}
                className="cursor-pointer text-[10px]"
                onClick={() => setCategoryFilter(cat)}
              >
                {cat} ({count})
              </Badge>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-muted-foreground">
        {sorted.length} of {products.length} items
      </div>

      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {search.trim() ? "No consumables match your search." : "No consumables found. Import a price list to get started."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-auto max-h-[600px]">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-muted-foreground">
                <th className="p-2 w-8">
                  <Checkbox
                    checked={selectedIds.size === sorted.length && sorted.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <SortHeader label="SKU" colKey="product_code" />
                <SortHeader label="Description" colKey="description" />
                <SortHeader label="Category" colKey="category" />
                <SortHeader label="Cost Price" colKey="cost_price" className="text-right" />
                <SortHeader label="Length" colKey="unit_length" className="text-right" />
                <SortHeader label="Price/m" colKey="price_per_metre" className="text-right" />
                <SortHeader label="Markup %" colKey="default_markup_percent" className="text-right" />
                <SortHeader label="Sell Price" colKey="selling_price" className="text-right" />
                <th className="p-2 font-medium text-right text-muted-foreground">Pack Qty</th>
                <th className="p-2 font-medium text-right text-muted-foreground">Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(product => (
                <tr key={product.id} className={`border-t border-border hover:bg-accent/20 transition-colors ${selectedIds.has(product.id) ? "bg-accent/30" : ""}`}>
                  <td className="p-2">
                    <Checkbox
                      checked={selectedIds.has(product.id)}
                      onCheckedChange={() => toggleSelect(product.id)}
                    />
                  </td>
                  <td className="p-2 font-mono whitespace-nowrap">{product.product_code}</td>
                  <td className="p-2 max-w-[300px]">
                    <span className="line-clamp-2">{product.description}</span>
                  </td>
                  <td className="p-2">
                    <Badge variant="outline" className="text-[10px]">{product.category}</Badge>
                  </td>
                  <td className="p-2 text-right whitespace-nowrap font-medium">
                    {product.is_price_on_request
                      ? <Badge variant="outline" className="text-[9px] border-amber-500/50 text-amber-600 bg-amber-500/10">POR</Badge>
                      : formatZAR(product.cost_price)}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {product.sold_in_length && product.unit_length ? (
                      <span className="flex items-center justify-end gap-1">
                        <Ruler className="h-3 w-3 text-primary/60" />
                        {product.unit_length}{product.unit_length_unit || "m"}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {product.sold_in_length && product.price_per_metre ? (
                      <span className="text-primary font-semibold">{formatZAR(product.price_per_metre)}/m</span>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap text-muted-foreground">
                    {product.default_markup_percent}%
                  </td>
                  <td className="p-2 text-right whitespace-nowrap font-bold text-primary">
                    {product.is_price_on_request
                      ? "—"
                      : formatZAR(product.selling_price || product.cost_price * (1 + (product.default_markup_percent || 0) / 100))}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {product.pack_qty && product.pack_qty > 1 ? (
                      <Badge variant="outline" className="text-[9px]">pk/{product.pack_qty}</Badge>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-right whitespace-nowrap">
                    {product.pack_qty && product.pack_qty > 1 ? (
                      <span className="text-primary font-semibold text-[10px]">
                        {formatZAR(product.selling_price / product.pack_qty)}/ea
                      </span>
                    ) : "—"}
                  </td>
                  <td className="p-2">
                    {product.sold_in_length && product.price_per_metre ? (
                      <LengthCalculator product={product} />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} products?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the selected products. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate([...selectedIds])}
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/** Length calculator popover for per-metre pricing */
const LengthCalculator = ({ product }: { product: ConsumableProduct }) => {
  const [metres, setMetres] = useState<number>(1);
  const pricePerMetre = product.price_per_metre || 0;
  const markup = product.default_markup_percent || 0;
  const cost = metres * pricePerMetre;
  const sell = cost * (1 + markup / 100);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Length Calculator</span>
          </div>
          <div>
            <Label className="text-xs">How many metres?</Label>
            <Input
              type="number"
              value={metres}
              onChange={e => setMetres(Math.max(product.min_cut_length || 0.5, Number(e.target.value) || 0))}
              step={0.5}
              min={product.min_cut_length || 0.5}
              className="h-8 text-sm mt-1"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Min cut: {product.min_cut_length || 0.5}m
            </p>
          </div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Price/m:</span>
              <span>{formatZAR(pricePerMetre)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{metres}m × {formatZAR(pricePerMetre)}:</span>
              <span className="font-medium">{formatZAR(cost)}</span>
            </div>
            <div className="flex justify-between border-t pt-1">
              <span className="text-muted-foreground">+ {markup}% markup:</span>
              <span className="font-bold text-primary">{formatZAR(sell)}</span>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ConsumablesCatalogTable;
