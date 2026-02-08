import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

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

interface InventoryItemFormProps {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
}

const InventoryItemForm = ({ item, open, onClose }: InventoryItemFormProps) => {
  const [name, setName] = useState(item?.name || "");
  const [sku, setSku] = useState(item?.sku || "");
  const [category, setCategory] = useState(item?.category || "");
  const [quantity, setQuantity] = useState(item?.quantity_in_stock ?? 0);
  const [minStock, setMinStock] = useState(item?.min_stock_level ?? 5);
  const [unitCost, setUnitCost] = useState(item?.unit_cost ?? 0);
  const [supplier, setSupplier] = useState(item?.supplier || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        sku: sku || null,
        category: category || null,
        quantity_in_stock: quantity,
        min_stock_level: minStock,
        unit_cost: unitCost,
        supplier: supplier || null,
        updated_at: new Date().toISOString(),
      };

      if (item) {
        const { error } = await supabase.from("inventory_items").update(payload).eq("id", item.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      toast({ title: item ? "Item updated" : "Item added" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{item ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. 22mm Copper Pipe" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>SKU</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="COP-22" />
            </div>
            <div>
              <Label>Category</Label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Piping" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Min Stock</Label>
              <Input type="number" value={minStock} onChange={(e) => setMinStock(parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Unit Cost (R)</Label>
              <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(parseFloat(e.target.value) || 0)} />
            </div>
          </div>
          <div>
            <Label>Supplier</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Reece Plumbing" />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>Cancel</Button>
            <Button className="flex-1" onClick={() => mutation.mutate()} disabled={!name || mutation.isPending}>
              {mutation.isPending ? "Saving..." : item ? "Update" : "Add Item"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InventoryItemForm;
