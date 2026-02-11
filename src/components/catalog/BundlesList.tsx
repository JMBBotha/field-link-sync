import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Plus, Copy, Pencil, Trash2, Package, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import BundleBuilder from "./BundleBuilder";

type Bundle = {
  id: string;
  name: string;
  description: string | null;
  ac_type: string | null;
  btu_rating: number | null;
  pipe_size: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type BundleItemWithProduct = {
  id: string;
  bundle_id: string;
  supplier_product_id: string;
  quantity: number;
  length_metres: number | null;
  is_length_item: boolean;
  notes: string | null;
  sort_order: number;
  supplier_products: {
    description: string;
    product_code: string;
    cost_price: number;
    price_per_metre: number | null;
    sold_in_length: boolean;
  };
};

const BundlesList = () => {
  const [editingBundleId, setEditingBundleId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ["installation-bundles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installation_bundles")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Bundle[];
    },
  });

  const { data: bundleItemCounts = {} } = useQuery({
    queryKey: ["bundle-item-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bundle_items")
        .select("bundle_id, id, quantity, length_metres, is_length_item, supplier_products(cost_price, price_per_metre)")
      if (error) throw error;
      const counts: Record<string, { count: number; total: number }> = {};
      for (const item of (data || [])) {
        const bid = item.bundle_id;
        if (!counts[bid]) counts[bid] = { count: 0, total: 0 };
        counts[bid].count++;
        const prod = item.supplier_products as any;
        if (item.is_length_item && item.length_metres && prod?.price_per_metre) {
          counts[bid].total += item.length_metres * prod.price_per_metre;
        } else {
          counts[bid].total += item.quantity * (prod?.cost_price || 0);
        }
      }
      return counts;
    },
  });

  const { data: expandedItems = [] } = useQuery({
    queryKey: ["bundle-items-expanded", expandedId],
    enabled: !!expandedId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bundle_items")
        .select("*, supplier_products(description, product_code, cost_price, price_per_metre, sold_in_length)")
        .eq("bundle_id", expandedId!)
        .order("sort_order");
      if (error) throw error;
      return data as unknown as BundleItemWithProduct[];
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (bundleId: string) => {
      const bundle = bundles.find(b => b.id === bundleId);
      if (!bundle) throw new Error("Bundle not found");

      const { data: newBundle, error: bErr } = await supabase
        .from("installation_bundles")
        .insert({
          name: `${bundle.name} (Copy)`,
          description: bundle.description,
          ac_type: bundle.ac_type,
          btu_rating: bundle.btu_rating,
          pipe_size: bundle.pipe_size,
        })
        .select()
        .single();
      if (bErr) throw bErr;

      const { data: items, error: iErr } = await supabase
        .from("bundle_items")
        .select("*")
        .eq("bundle_id", bundleId);
      if (iErr) throw iErr;

      if (items && items.length > 0) {
        const newItems = items.map(item => ({
          bundle_id: newBundle.id,
          supplier_product_id: item.supplier_product_id,
          quantity: item.quantity,
          length_metres: item.length_metres,
          is_length_item: item.is_length_item,
          notes: item.notes,
          sort_order: item.sort_order,
        }));
        const { error: insErr } = await supabase.from("bundle_items").insert(newItems);
        if (insErr) throw insErr;
      }

      return newBundle;
    },
    onSuccess: (newBundle) => {
      queryClient.invalidateQueries({ queryKey: ["installation-bundles"] });
      queryClient.invalidateQueries({ queryKey: ["bundle-item-counts"] });
      toast.success("Bundle duplicated");
      setEditingBundleId(newBundle.id);
    },
    onError: () => toast.error("Failed to duplicate bundle"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("installation_bundles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["installation-bundles"] });
      queryClient.invalidateQueries({ queryKey: ["bundle-item-counts"] });
      toast.success("Bundle deleted");
    },
    onError: () => toast.error("Failed to delete bundle"),
  });

  if (creating || editingBundleId) {
    return (
      <BundleBuilder
        bundleId={editingBundleId}
        onClose={() => {
          setEditingBundleId(null);
          setCreating(false);
          queryClient.invalidateQueries({ queryKey: ["installation-bundles"] });
          queryClient.invalidateQueries({ queryKey: ["bundle-item-counts"] });
        }}
      />
    );
  }

  const formatCurrency = (v: number) => `R${v.toFixed(2)}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reusable installation kits for quoting AC installs
        </p>
        <Button onClick={() => setCreating(true)} size="sm" className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Create Bundle
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading bundles...</div>
      ) : bundles.length === 0 ? (
        <div className="text-center py-12">
          <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No bundles yet. Create your first installation bundle.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bundles.map((bundle) => {
            const stats = bundleItemCounts[bundle.id];
            const isExpanded = expandedId === bundle.id;
            return (
              <Card key={bundle.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : bundle.id)}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{bundle.name}</span>
                      {bundle.ac_type && (
                        <Badge variant="secondary" className="text-[10px]">{bundle.ac_type}</Badge>
                      )}
                      {bundle.btu_rating && (
                        <Badge variant="outline" className="text-[10px]">{(bundle.btu_rating / 1000).toFixed(0)}K BTU</Badge>
                      )}
                      {bundle.pipe_size && (
                        <Badge variant="outline" className="text-[10px]">{bundle.pipe_size}</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{stats?.count || 0} items</span>
                      <span>{stats ? formatCurrency(stats.total) : "R0.00"} cost</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setExpandedId(isExpanded ? null : bundle.id)}>
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingBundleId(bundle.id)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => duplicateMutation.mutate(bundle.id)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => {
                      if (confirm("Delete this bundle?")) deleteMutation.mutate(bundle.id);
                    }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {isExpanded && expandedItems.length > 0 && (
                  <div className="mt-3 border-t pt-2">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground">
                          <th className="text-left font-medium pb-1">Item</th>
                          <th className="text-right font-medium pb-1">Qty/Length</th>
                          <th className="text-right font-medium pb-1">Unit Cost</th>
                          <th className="text-right font-medium pb-1">Line Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {expandedItems.map(item => {
                          const prod = item.supplier_products;
                          const unitCost = item.is_length_item ? (prod.price_per_metre || 0) : prod.cost_price;
                          const qtyOrLen = item.is_length_item ? (item.length_metres || 0) : item.quantity;
                          const lineTotal = qtyOrLen * unitCost;
                          return (
                            <tr key={item.id} className="border-t border-dashed">
                              <td className="py-1">
                                {prod.description}
                                {item.notes && <span className="text-muted-foreground ml-1">({item.notes})</span>}
                              </td>
                              <td className="text-right py-1">
                                {item.is_length_item ? `${qtyOrLen}m` : `×${qtyOrLen}`}
                              </td>
                              <td className="text-right py-1">
                                {item.is_length_item ? `R${unitCost.toFixed(2)}/m` : `R${unitCost.toFixed(2)}`}
                              </td>
                              <td className="text-right py-1 font-medium">R{lineTotal.toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BundlesList;
