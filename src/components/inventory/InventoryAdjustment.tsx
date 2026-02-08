import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Minus } from "lucide-react";

interface InventoryItem {
  id: string;
  name: string;
  quantity_in_stock: number;
}

interface InventoryAdjustmentProps {
  item: InventoryItem;
  open: boolean;
  onClose: () => void;
}

const InventoryAdjustment = ({ item, open, onClose }: InventoryAdjustmentProps) => {
  const [adjustment, setAdjustment] = useState(0);
  const [reason, setReason] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const newQty = item.quantity_in_stock + adjustment;
      if (newQty < 0) throw new Error("Stock cannot go below 0");

      const { error } = await supabase
        .from("inventory_items")
        .update({ quantity_in_stock: newQty, updated_at: new Date().toISOString() })
        .eq("id", item.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
      toast({ title: "Stock updated", description: `${item.name}: ${item.quantity_in_stock} → ${item.quantity_in_stock + adjustment}` });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const newQuantity = item.quantity_in_stock + adjustment;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust Stock: {item.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Current Stock</p>
            <p className="text-3xl font-bold">{item.quantity_in_stock}</p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAdjustment((a) => a - 1)}
              disabled={newQuantity <= 0}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              value={adjustment}
              onChange={(e) => setAdjustment(parseInt(e.target.value) || 0)}
              className="w-24 text-center text-lg font-bold"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={() => setAdjustment((a) => a + 1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="text-center">
            <p className="text-sm text-muted-foreground">New Stock Level</p>
            <p className={`text-2xl font-bold ${newQuantity < 0 ? "text-red-500" : "text-green-600"}`}>
              {newQuantity}
            </p>
          </div>

          <div>
            <Label>Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Restocked from supplier"
              rows={2}
            />
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={() => mutation.mutate()}
              disabled={adjustment === 0 || newQuantity < 0 || mutation.isPending}
            >
              {mutation.isPending ? "Saving..." : "Update Stock"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InventoryAdjustment;
