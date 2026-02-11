import { useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Loader2, Upload, FileText, Image, Check, ChevronRight, ChevronLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";

interface ProductLookup {
  id: string;
  product_code: string;
  description: string;
}

interface SupplierInfo {
  id: string;
  name: string;
}

interface ReceiveItem {
  product_code: string;
  product_id: string;
  quantity: number;
  notes: string;
}

interface UploadedFile {
  file: File;
  preview?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  products: ProductLookup[];
  suppliers: SupplierInfo[];
  stockMap: Map<string, { id: string; quantity: number; stock_mode: string }>;
}

const STEPS = ["Supplier", "Documents", "Items", "Review"];

const ReceiveStockModal = ({ open, onClose, products, suppliers, stockMap }: Props) => {
  const [step, setStep] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [items, setItems] = useState<ReceiveItem[]>([{ product_code: "", product_id: "", quantity: 1, notes: "" }]);
  const [receiptNotes, setReceiptNotes] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const productMap = new Map(products.map(p => [p.product_code.toLowerCase(), p]));

  const resetForm = () => {
    setStep(0);
    setSupplierId("");
    setFiles([]);
    setItems([{ product_code: "", product_id: "", quantity: 1, notes: "" }]);
    setReceiptNotes("");
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);
    const valid = newFiles.filter(f => f.size <= 10 * 1024 * 1024);
    if (valid.length < newFiles.length) {
      toast({ title: "Some files exceeded 10MB limit", variant: "destructive" });
    }
    setFiles(prev => [...prev, ...valid.slice(0, 10 - prev.length).map(f => ({ file: f }))]);
  };

  const removeFile = (i: number) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const addItem = () => setItems(prev => [...prev, { product_code: "", product_id: "", quantity: 1, notes: "" }]);
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const updateItem = (i: number, field: keyof ReceiveItem, value: string | number) => {
    setItems(prev => prev.map((item, idx) => {
      if (idx !== i) return item;
      const updated = { ...item, [field]: value };
      if (field === "product_code") {
        const match = productMap.get((value as string).toLowerCase());
        updated.product_id = match?.id || "";
      }
      return updated;
    }));
  };

  const handleCSVItems = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsed = (results.data as any[]).map(row => {
          const code = (row.product_code || row.sku || row.SKU || "").toString().trim();
          const match = productMap.get(code.toLowerCase());
          return {
            product_code: code,
            product_id: match?.id || "",
            quantity: parseInt(row.quantity || row.qty || "1", 10) || 1,
            notes: (row.notes || "").toString(),
          };
        }).filter(r => r.product_code);
        if (parsed.length > 0) {
          setItems(parsed);
          toast({ title: `${parsed.length} items loaded from CSV` });
        }
      },
    });
  };

  const validItems = items.filter(it => it.product_id && it.quantity > 0);
  const invalidItems = items.filter(it => it.product_code.trim() && !it.product_id);
  const supplierName = suppliers.find(s => s.id === supplierId)?.name || "";

  const canProceed = () => {
    if (step === 0) return !!supplierId;
    if (step === 1) return true; // docs optional
    if (step === 2) return validItems.length > 0;
    return true;
  };

  const handleSubmit = async () => {
    if (validItems.length === 0) return;
    setIsProcessing(true);

    try {
      // 1. Create receipt
      const { data: receipt, error: rErr } = await supabase
        .from("stock_receipts" as any)
        .insert({
          supplier_id: supplierId,
          items_received: validItems.map(it => ({ product_id: it.product_id, quantity: it.quantity, notes: it.notes })),
          notes: receiptNotes || null,
        })
        .select("id")
        .single();
      if (rErr) throw rErr;

      const receiptId = (receipt as any).id;

      // 2. Upload documents
      for (const f of files) {
        const path = `receipt_${receiptId}/${Date.now()}_${f.file.name}`;
        const { error: upErr } = await supabase.storage.from("stock-documents").upload(path, f.file);
        if (!upErr) {
          await supabase.from("stock_documents" as any).insert({
            receipt_id: receiptId,
            file_name: f.file.name,
            file_path: path,
            file_type: f.file.type.includes("pdf") ? "pdf" : f.file.type.includes("image") ? "image" : "other",
          });
        }
      }

      // 3. Update stock quantities for stock_sensitive items
      for (const item of validItems) {
        const stock = stockMap.get(item.product_id);
        if (stock && stock.stock_mode === "stock_sensitive") {
          const oldQty = stock.quantity ?? 0;
          const newQty = oldQty + item.quantity;

          await supabase
            .from("inventory_stock")
            .update({ quantity: newQty })
            .eq("id", stock.id);

          await supabase.from("inventory_adjustments").insert({
            stock_id: stock.id,
            old_quantity: oldQty,
            new_quantity: newQty,
            reason: `Stock received from ${supplierName} (Receipt)`,
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count"] });
      queryClient.invalidateQueries({ queryKey: ["low-stock-count-sidebar"] });
      queryClient.invalidateQueries({ queryKey: ["stock-receipts"] });

      toast({ title: `${validItems.length} items received successfully` });
      handleClose();
    } catch (err: any) {
      toast({ title: "Failed to receive stock", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-sm">Receive Stock</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-4">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold ${
                i < step ? "bg-primary text-primary-foreground" :
                i === step ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={`text-[10px] ${i === step ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
              {i < STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
            </div>
          ))}
        </div>

        {/* Step 0: Supplier */}
        {step === 0 && (
          <div className="space-y-3">
            <Label className="text-xs">Select Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="Choose supplier..." />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div>
              <Label className="text-xs">Receipt Notes (optional)</Label>
              <Textarea value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} rows={2} className="text-sm" placeholder="PO number, delivery ref..." />
            </div>
          </div>
        )}

        {/* Step 1: Documents */}
        {step === 1 && (
          <div className="space-y-3">
            <Label className="text-xs">Upload Documents (optional, max 10 files, 10MB each)</Label>
            <div className="border-2 border-dashed rounded-lg p-4 text-center">
              <Upload className="h-5 w-5 mx-auto text-muted-foreground mb-1" />
              <input type="file" accept=".pdf,.jpg,.jpeg,.png" multiple onChange={handleFileChange} className="text-xs" />
            </div>
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs p-1 bg-muted/50 rounded">
                    {f.file.type.includes("pdf") ? <FileText className="h-3 w-3" /> : <Image className="h-3 w-3" />}
                    <span className="truncate flex-1">{f.file.name}</span>
                    <span className="text-muted-foreground">{(f.file.size / 1024).toFixed(0)}KB</span>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => removeFile(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Items */}
        {step === 2 && (
          <div className="space-y-3">
            <Tabs defaultValue="manual">
              <TabsList className="grid w-full grid-cols-2 h-8">
                <TabsTrigger value="manual" className="text-xs">Manual</TabsTrigger>
                <TabsTrigger value="csv" className="text-xs">CSV</TabsTrigger>
              </TabsList>
              <TabsContent value="manual" className="space-y-2 mt-2">
                {items.map((item, i) => (
                  <div key={i} className="flex gap-1 items-end">
                    <div className="flex-1">
                      {i === 0 && <Label className="text-[10px]">SKU</Label>}
                      <Input value={item.product_code} onChange={e => updateItem(i, "product_code", e.target.value)} placeholder="Product code" className="text-xs h-7" />
                    </div>
                    <div className="w-14">
                      {i === 0 && <Label className="text-[10px]">Qty</Label>}
                      <Input type="number" min={1} value={item.quantity} onChange={e => updateItem(i, "quantity", parseInt(e.target.value) || 1)} className="text-xs h-7" />
                    </div>
                    <div className="flex-1">
                      {i === 0 && <Label className="text-[10px]">Notes</Label>}
                      <Input value={item.notes} onChange={e => updateItem(i, "notes", e.target.value)} placeholder="Optional" className="text-xs h-7" />
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(i)} disabled={items.length === 1}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                {invalidItems.length > 0 && (
                  <p className="text-[10px] text-destructive">{invalidItems.length} SKU(s) not found</p>
                )}
                <Button variant="outline" size="sm" onClick={addItem} className="text-xs">
                  <Plus className="h-3 w-3 mr-1" /> Add Item
                </Button>
              </TabsContent>
              <TabsContent value="csv" className="space-y-2 mt-2">
                <p className="text-[10px] text-muted-foreground">CSV: product_code, quantity, notes (optional)</p>
                <input type="file" accept=".csv" onChange={e => e.target.files?.[0] && handleCSVItems(e.target.files[0])} className="text-xs" />
                {items.length > 1 && <p className="text-xs text-muted-foreground">{validItems.length} valid items loaded</p>}
              </TabsContent>
            </Tabs>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="flex gap-4 text-xs">
              <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{supplierName}</span></div>
              <div><span className="text-muted-foreground">Items:</span> <span className="font-medium">{validItems.length}</span></div>
              <div><span className="text-muted-foreground">Docs:</span> <span className="font-medium">{files.length}</span></div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[10px]">SKU</TableHead>
                  <TableHead className="text-[10px] text-center">Qty</TableHead>
                  <TableHead className="text-[10px]">Mode</TableHead>
                  <TableHead className="text-[10px]">Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {validItems.map((item, i) => {
                  const stock = stockMap.get(item.product_id);
                  const mode = stock?.stock_mode || "order_as_needed";
                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-mono">{item.product_code}</TableCell>
                      <TableCell className="text-xs text-center font-semibold">{item.quantity}</TableCell>
                      <TableCell>
                        <Badge variant={mode === "stock_sensitive" ? "default" : "outline"} className="text-[9px]">
                          {mode === "stock_sensitive" ? "Tracked" : "Order"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[100px]">{item.notes || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {validItems.some(it => stockMap.get(it.product_id)?.stock_mode !== "stock_sensitive") && (
              <p className="text-[10px] text-amber-600">⚠ Items marked "Order" won't have their quantity updated. Switch to "Stock Sensitive" first.</p>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2 border-t">
          <Button variant="outline" size="sm" onClick={() => step > 0 ? setStep(step - 1) : handleClose()} className="text-xs">
            {step > 0 ? <><ChevronLeft className="h-3 w-3 mr-1" /> Back</> : "Cancel"}
          </Button>
          {step < 3 ? (
            <Button size="sm" onClick={() => setStep(step + 1)} disabled={!canProceed()} className="text-xs">
              Next <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          ) : (
            <Button size="sm" onClick={handleSubmit} disabled={isProcessing || validItems.length === 0} className="text-xs">
              {isProcessing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Confirm Receipt
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiveStockModal;
