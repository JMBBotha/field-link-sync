import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Plus, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Papa from "papaparse";

interface ProductLookup {
  id: string;
  product_code: string;
  description: string;
}

interface BulkEntry {
  product_code: string;
  quantity: number;
  reason: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  products: ProductLookup[];
  onBulkUpdate: (updates: { productId: string; quantity: number; reason?: string }[]) => Promise<void>;
}

const BulkStockUpdateModal = ({ open, onClose, products, onBulkUpdate }: Props) => {
  const [entries, setEntries] = useState<BulkEntry[]>([{ product_code: "", quantity: 0, reason: "" }]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  const productMap = new Map(products.map(p => [p.product_code.toLowerCase(), p]));

  const addRow = () => setEntries(prev => [...prev, { product_code: "", quantity: 0, reason: "" }]);
  const removeRow = (i: number) => setEntries(prev => prev.filter((_, idx) => idx !== i));
  const updateEntry = (i: number, field: keyof BulkEntry, value: string | number) => {
    setEntries(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  };

  const resolveUpdates = useCallback((items: { product_code: string; quantity: number; reason?: string }[]) => {
    const resolved: { productId: string; quantity: number; reason?: string }[] = [];
    const errors: string[] = [];

    items.forEach(item => {
      const match = productMap.get(item.product_code.toLowerCase());
      if (!match) {
        errors.push(`SKU "${item.product_code}" not found`);
      } else if (item.quantity < 0) {
        errors.push(`Negative quantity for "${item.product_code}"`);
      } else {
        resolved.push({ productId: match.id, quantity: item.quantity, reason: item.reason });
      }
    });

    return { resolved, errors };
  }, [productMap]);

  const handleQuickSubmit = async () => {
    const valid = entries.filter(e => e.product_code.trim());
    if (valid.length === 0) return;

    const { resolved, errors } = resolveUpdates(valid);
    if (errors.length > 0) {
      toast({ title: "Validation errors", description: errors.join(", "), variant: "destructive" });
      if (resolved.length === 0) return;
    }

    setIsProcessing(true);
    try {
      await onBulkUpdate(resolved);
      setEntries([{ product_code: "", quantity: 0, reason: "" }]);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCSVUpload = async () => {
    if (!csvFile) return;

    setIsProcessing(true);
    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const items = (results.data as any[]).map(row => ({
          product_code: (row.product_code || row.sku || row.SKU || "").toString().trim(),
          quantity: parseInt(row.quantity || row.qty || "0", 10) || 0,
          reason: (row.reason || "CSV import").toString(),
        })).filter(r => r.product_code);

        if (items.length === 0) {
          toast({ title: "No valid rows found in CSV", variant: "destructive" });
          setIsProcessing(false);
          return;
        }

        const { resolved, errors } = resolveUpdates(items);
        if (errors.length > 0) {
          toast({
            title: `${errors.length} SKU(s) not found`,
            description: errors.slice(0, 3).join(", ") + (errors.length > 3 ? "..." : ""),
            variant: "destructive",
          });
        }

        if (resolved.length > 0) {
          try {
            await onBulkUpdate(resolved);
            setCsvFile(null);
            onClose();
          } catch {
            // error handled in hook
          }
        }
        setIsProcessing(false);
      },
      error: () => {
        toast({ title: "Failed to parse CSV", variant: "destructive" });
        setIsProcessing(false);
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Bulk Stock Update</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="quick">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="quick" className="text-xs">Quick Entry</TabsTrigger>
            <TabsTrigger value="csv" className="text-xs">CSV Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="space-y-3 mt-3">
            {entries.map((entry, i) => (
              <div key={i} className="flex gap-1.5 items-end">
                <div className="flex-1">
                  {i === 0 && <Label className="text-[10px]">SKU</Label>}
                  <Input
                    value={entry.product_code}
                    onChange={(e) => updateEntry(i, "product_code", e.target.value)}
                    placeholder="Product code"
                    className="text-xs h-8"
                  />
                </div>
                <div className="w-16">
                  {i === 0 && <Label className="text-[10px]">Qty</Label>}
                  <Input
                    type="number"
                    min={0}
                    value={entry.quantity}
                    onChange={(e) => updateEntry(i, "quantity", parseInt(e.target.value) || 0)}
                    className="text-xs h-8"
                  />
                </div>
                <div className="flex-1">
                  {i === 0 && <Label className="text-[10px]">Reason</Label>}
                  <Input
                    value={entry.reason}
                    onChange={(e) => updateEntry(i, "reason", e.target.value)}
                    placeholder="Optional"
                    className="text-xs h-8"
                  />
                </div>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeRow(i)} disabled={entries.length === 1}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addRow} className="text-xs">
                <Plus className="h-3 w-3 mr-1" /> Add Row
              </Button>
              <Button size="sm" onClick={handleQuickSubmit} disabled={isProcessing} className="text-xs ml-auto">
                {isProcessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                Update {entries.filter(e => e.product_code.trim()).length} Items
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="csv" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              Upload a CSV with columns: <code className="bg-muted px-1 rounded">product_code</code>, <code className="bg-muted px-1 rounded">quantity</code>, <code className="bg-muted px-1 rounded">reason</code> (optional)
            </p>
            <div className="border-2 border-dashed rounded-lg p-6 text-center">
              <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <input
                type="file"
                accept=".csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                className="text-xs"
              />
              {csvFile && <p className="text-xs mt-2 text-muted-foreground">{csvFile.name}</p>}
            </div>
            <Button
              size="sm"
              className="w-full text-xs"
              disabled={!csvFile || isProcessing}
              onClick={handleCSVUpload}
            >
              {isProcessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Upload className="h-3 w-3 mr-1" />}
              Import & Update
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default BulkStockUpdateModal;
