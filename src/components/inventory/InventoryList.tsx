import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Search, Package, AlertTriangle, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import InventoryAdjustment from "./InventoryAdjustment";
import InventoryItemForm from "./InventoryItemForm";

interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  quantity_in_stock: number;
  min_stock_level: number;
  unit_cost: number;
  supplier: string | null;
}

const InventoryList = () => {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [adjustingItem, setAdjustingItem] = useState<InventoryItem | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["inventory-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as InventoryItem[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("inventory_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      toast({ title: "Item deleted" });
    },
  });

  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];

  const filtered = items.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.sku?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = !categoryFilter || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const lowStockCount = items.filter((i) => i.quantity_in_stock < i.min_stock_level).length;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory
          </h2>
          {lowStockCount > 0 && (
            <p className="text-sm text-red-500 flex items-center gap-1 mt-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {lowStockCount} item{lowStockCount > 1 ? "s" : ""} below minimum stock
            </p>
          )}
        </div>
        <Button onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Item
        </Button>
      </div>

      {/* Search and filter */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
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
                <TableHead className="text-center">Stock</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No items found
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => {
                  const isLow = item.quantity_in_stock < item.min_stock_level;
                  return (
                    <TableRow
                      key={item.id}
                      className={isLow ? "bg-red-50 dark:bg-red-950/20" : ""}
                    >
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {item.sku || "—"}
                      </TableCell>
                      <TableCell>
                        {item.category && (
                          <Badge variant="outline" className="text-xs">
                            {item.category}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`font-bold ${
                            isLow ? "text-red-600" : "text-green-600"
                          }`}
                        >
                          {item.quantity_in_stock}
                        </span>
                        <span className="text-xs text-muted-foreground ml-1">
                          / {item.min_stock_level} min
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        R {Number(item.unit_cost).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {item.supplier || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setAdjustingItem(item)}
                            title="Adjust stock"
                          >
                            <Package className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => setEditingItem(item)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-500"
                            onClick={() => deleteMutation.mutate(item.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      {(showAddForm || editingItem) && (
        <InventoryItemForm
          item={editingItem}
          open={showAddForm || !!editingItem}
          onClose={() => {
            setShowAddForm(false);
            setEditingItem(null);
          }}
        />
      )}

      {/* Adjustment Dialog */}
      {adjustingItem && (
        <InventoryAdjustment
          item={adjustingItem}
          open={!!adjustingItem}
          onClose={() => setAdjustingItem(null)}
        />
      )}
    </div>
  );
};

export default InventoryList;
