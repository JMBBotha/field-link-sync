import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/useRole";
import { Navigate } from "react-router-dom";
import { Search, Plus, Trash2, ChevronDown, ChevronRight, Package, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface SuggestedConsumable {
  product_id: string;
  qty: number;
  is_default: boolean;
}

interface ACProduct {
  id: string;
  product_code: string;
  short_name: string;
  brand: string;
  selling_price: number;
  suggested_consumables: SuggestedConsumable[];
}

interface ConsumableProduct {
  id: string;
  product_code: string;
  short_name: string;
  brand: string;
  selling_price: number;
  product_category: string;
}

function formatZAR(v: number) {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(v);
}

/* ── Consumable search picker ── */
function ConsumablePicker({
  consumableProducts,
  onAdd,
  existingIds,
}: {
  consumableProducts: ConsumableProduct[];
  onAdd: (productId: string, qty: number, isDefault: boolean) => void;
  existingIds: Set<string>;
}) {
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState(1);
  const [isDefault, setIsDefault] = useState(true);

  const filtered = useMemo(() => {
    if (!search.trim()) return [];
    const terms = search.toLowerCase().split(/\s+/);
    return consumableProducts
      .filter((p) => !existingIds.has(p.id))
      .filter((p) => {
        const blob = [p.product_code, p.short_name, p.brand].filter(Boolean).join(" ").toLowerCase();
        return terms.every((t) => blob.includes(t));
      })
      .slice(0, 15);
  }, [consumableProducts, search, existingIds]);

  return (
    <div className="space-y-2 rounded border bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search consumable products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-1">
          <Label className="text-[10px] text-muted-foreground">Qty:</Label>
          <Input
            type="number"
            value={qty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-8 w-14 text-xs"
            min={1}
          />
        </div>
        <div className="flex items-center gap-1">
          <Switch checked={isDefault} onCheckedChange={setIsDefault} className="scale-75" />
          <Label className="text-[10px] text-muted-foreground">Default</Label>
        </div>
      </div>
      {filtered.length > 0 && (
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {filtered.map((p) => (
            <button
              key={p.id}
              className="w-full flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-accent transition-colors text-left"
              onClick={() => {
                onAdd(p.id, qty, isDefault);
                setSearch("");
              }}
            >
              <Plus className="h-3 w-3 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate block">{p.short_name || p.product_code}</span>
                <span className="text-muted-foreground truncate block">{p.product_code} · {p.brand} · {formatZAR(p.selling_price || 0)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {search.trim() && filtered.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-2">No matching products found</p>
      )}
    </div>
  );
}

/* ── Expandable AC product row ── */
function ACProductRow({
  product,
  consumableProducts,
  onUpdate,
  saving,
}: {
  product: ACProduct;
  consumableProducts: ConsumableProduct[];
  onUpdate: (productId: string, consumables: SuggestedConsumable[]) => void;
  saving: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const consumables = product.suggested_consumables || [];
  const existingIds = new Set(consumables.map((c) => c.product_id));

  const consumableMap = useMemo(() => {
    const map: Record<string, ConsumableProduct> = {};
    for (const p of consumableProducts) map[p.id] = p;
    return map;
  }, [consumableProducts]);

  const handleAdd = useCallback(
    (productId: string, qty: number, isDefault: boolean) => {
      onUpdate(product.id, [...consumables, { product_id: productId, qty, is_default: isDefault }]);
    },
    [product.id, consumables, onUpdate]
  );

  const handleRemove = useCallback(
    (productId: string) => {
      onUpdate(product.id, consumables.filter((c) => c.product_id !== productId));
    },
    [product.id, consumables, onUpdate]
  );

  const handleToggleDefault = useCallback(
    (productId: string) => {
      onUpdate(
        product.id,
        consumables.map((c) =>
          c.product_id === productId ? { ...c, is_default: !c.is_default } : c
        )
      );
    },
    [product.id, consumables, onUpdate]
  );

  const handleQtyChange = useCallback(
    (productId: string, qty: number) => {
      onUpdate(
        product.id,
        consumables.map((c) =>
          c.product_id === productId ? { ...c, qty: Math.max(1, qty) } : c
        )
      );
    },
    [product.id, consumables, onUpdate]
  );

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => setExpanded(!expanded)}
      >
        <TableCell className="w-8">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </TableCell>
        <TableCell className="font-medium text-sm">{product.product_code}</TableCell>
        <TableCell className="text-sm">{product.short_name}</TableCell>
        <TableCell className="text-sm">{product.brand}</TableCell>
        <TableCell className="text-sm">{formatZAR(product.selling_price || 0)}</TableCell>
        <TableCell>
          <Badge variant={consumables.length > 0 ? "default" : "outline"} className="text-[10px]">
            {consumables.length} consumable{consumables.length !== 1 ? "s" : ""}
          </Badge>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={6} className="bg-muted/10 px-6 py-4">
            <div className="space-y-3">
              <Label className="text-xs font-medium">Suggested Consumables</Label>

              {consumables.length > 0 ? (
                <div className="space-y-1.5">
                  {consumables.map((c) => {
                    const cp = consumableMap[c.product_id];
                    return (
                      <div
                        key={c.product_id}
                        className="flex items-center gap-2 rounded border bg-card px-3 py-2 text-xs"
                      >
                        <Package className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium truncate block">
                            {cp?.short_name || cp?.product_code || c.product_id}
                          </span>
                          {cp && (
                            <span className="text-muted-foreground text-[10px]">
                              {cp.product_code} · {formatZAR(cp.selling_price || 0)}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Label className="text-[10px] text-muted-foreground">Qty:</Label>
                          <Input
                            type="number"
                            value={c.qty}
                            onChange={(e) => handleQtyChange(c.product_id, parseInt(e.target.value) || 1)}
                            className="h-6 w-12 text-[10px]"
                            min={1}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={c.is_default}
                            onCheckedChange={() => handleToggleDefault(c.product_id)}
                            className="scale-75"
                          />
                          <Label className="text-[10px] text-muted-foreground">
                            {c.is_default ? "Auto-add" : "Optional"}
                          </Label>
                        </div>
                        {c.is_default && (
                          <Badge className="text-[9px] bg-green-100 text-green-700 border-green-300">
                            Suggested
                          </Badge>
                        )}
                        <button
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/20 shrink-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(c.product_id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No suggested consumables configured. Add below.
                </p>
              )}

              <ConsumablePicker
                consumableProducts={consumableProducts}
                onAdd={handleAdd}
                existingIds={existingIds}
              />

              {saving && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Saving...
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ── Main Page ── */
export default function AdminConsumablesPage() {
  const { isAdmin, loading: roleLoading } = useRole();
  const [search, setSearch] = useState("");
  const queryClient = useQueryClient();

  // Fetch AC products with suggested_consumables
  const { data: acProducts = [], isLoading: loadingAC } = useQuery({
    queryKey: ["admin-ac-products-consumables"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, selling_price, suggested_consumables")
        .or("product_category.eq.Air Conditioning,category.ilike.%air conditioning%")
        .or("archived.is.null,archived.eq.false")
        .order("brand")
        .order("product_code")
        .limit(500);
      if (error) throw error;
      return (data || []).map((p: any) => ({
        ...p,
        suggested_consumables: Array.isArray(p.suggested_consumables) ? p.suggested_consumables : [],
      })) as ACProduct[];
    },
  });

  // Fetch all non-AC products as potential consumables
  const { data: consumableProducts = [] } = useQuery({
    queryKey: ["admin-consumable-products"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, brand, selling_price, product_category")
        .or("archived.is.null,archived.eq.false")
        .order("short_name")
        .limit(2000);
      if (error) throw error;
      return (data || []) as ConsumableProduct[];
    },
  });

  // Mutation to update suggested_consumables
  const updateMutation = useMutation({
    mutationFn: async ({ productId, consumables }: { productId: string; consumables: SuggestedConsumable[] }) => {
      const { error } = await (supabase.from("supplier_products") as any)
        .update({ suggested_consumables: consumables })
        .eq("id", productId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-ac-products-consumables"] });
      toast.success("Suggested consumables updated");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update consumables");
    },
  });

  const handleUpdate = useCallback(
    (productId: string, consumables: SuggestedConsumable[]) => {
      // Optimistic update
      queryClient.setQueryData<ACProduct[]>(["admin-ac-products-consumables"], (old) =>
        old?.map((p) => (p.id === productId ? { ...p, suggested_consumables: consumables } : p))
      );
      updateMutation.mutate({ productId, consumables });
    },
    [updateMutation, queryClient]
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return acProducts;
    const terms = search.toLowerCase().split(/\s+/);
    return acProducts.filter((p) => {
      const blob = [p.product_code, p.short_name, p.brand].filter(Boolean).join(" ").toLowerCase();
      return terms.every((t) => blob.includes(t));
    });
  }, [acProducts, search]);

  if (roleLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return (
    <div className="space-y-4 p-4 max-w-6xl mx-auto">
      <div>
        <h1 className="text-xl font-bold">Suggested Consumables Management</h1>
        <p className="text-sm text-muted-foreground">
          Configure which consumables are auto-suggested when an AC unit is selected in the Quote Builder.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search AC products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      {loadingAC ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Consumables</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No AC products found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((p) => (
                  <ACProductRow
                    key={p.id}
                    product={p}
                    consumableProducts={consumableProducts}
                    onUpdate={handleUpdate}
                    saving={updateMutation.isPending}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {filtered.length} AC product{filtered.length !== 1 ? "s" : ""} · Items marked "Auto-add" will be automatically added to the quote when the unit is selected.
      </p>
    </div>
  );
}
