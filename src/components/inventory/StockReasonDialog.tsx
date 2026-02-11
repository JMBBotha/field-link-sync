import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  productName: string;
  oldQty: number;
  newQty: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

const StockReasonDialog = ({ open, productName, oldQty, newQty, onConfirm, onCancel }: Props) => {
  const [reason, setReason] = useState("");

  const handleConfirm = () => {
    onConfirm(reason.trim());
    setReason("");
  };

  const diff = newQty - oldQty;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">Update Stock: {productName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-center py-2">
            <span className="text-muted-foreground text-sm">{oldQty}</span>
            <span className="mx-2 text-sm">→</span>
            <span className={`text-lg font-bold ${diff > 0 ? "text-green-600" : diff < 0 ? "text-red-600" : ""}`}>
              {newQty}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              ({diff > 0 ? `+${diff}` : diff})
            </span>
          </div>
          <div>
            <Label className="text-xs">Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Restocked from supplier"
              rows={2}
              className="text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" className="flex-1" onClick={handleConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default StockReasonDialog;
