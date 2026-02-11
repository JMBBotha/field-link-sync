import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { useStockAdjustments } from "@/hooks/useInventoryStock";
import { format } from "date-fns";

interface Props {
  stockId: string | null;
  productName: string;
  open: boolean;
  onClose: () => void;
}

const StockAdjustmentHistory = ({ stockId, productName, open, onClose }: Props) => {
  const { data: adjustments = [], isLoading } = useStockAdjustments(stockId);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Stock History: {productName}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No adjustments recorded yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs text-center">Old</TableHead>
                <TableHead className="text-xs text-center">New</TableHead>
                <TableHead className="text-xs">Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.map((adj) => {
                const diff = adj.new_quantity - adj.old_quantity;
                return (
                  <TableRow key={adj.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(adj.changed_at), "dd MMM yy HH:mm")}
                    </TableCell>
                    <TableCell className="text-xs text-center">{adj.old_quantity}</TableCell>
                    <TableCell className="text-xs text-center font-semibold">
                      <span className={diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}>
                        {adj.new_quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[150px] truncate">
                      {adj.reason || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default StockAdjustmentHistory;
