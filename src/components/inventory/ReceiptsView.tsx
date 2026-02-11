import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, FileText, Download, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

interface ReceiptRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  receipt_date: string;
  items_received: any[];
  notes: string | null;
  doc_count: number;
  created_at: string;
}

interface ReceiptDoc {
  id: string;
  file_name: string;
  file_path: string;
  file_type: string;
}

const ReceiptsView = () => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailDialog, setDetailDialog] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: receipts = [], isLoading } = useQuery({
    queryKey: ["stock-receipts"],
    queryFn: async () => {
      const { data: recs, error } = await supabase
        .from("stock_receipts" as any)
        .select("id, supplier_id, receipt_date, items_received, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      const { data: suppliers } = await supabase.from("suppliers").select("id, name");
      const supplierMap = new Map((suppliers || []).map((s: any) => [s.id, s.name]));

      const { data: docs } = await supabase
        .from("stock_documents" as any)
        .select("receipt_id");

      const docCounts = new Map<string, number>();
      (docs || []).forEach((d: any) => {
        docCounts.set(d.receipt_id, (docCounts.get(d.receipt_id) || 0) + 1);
      });

      return ((recs || []) as any[]).map(r => ({
        id: r.id,
        supplier_id: r.supplier_id,
        supplier_name: supplierMap.get(r.supplier_id) || "Unknown",
        receipt_date: r.receipt_date,
        items_received: Array.isArray(r.items_received) ? r.items_received : [],
        notes: r.notes,
        doc_count: docCounts.get(r.id) || 0,
        created_at: r.created_at,
      })) as ReceiptRow[];
    },
  });

  const { data: receiptDocs = [] } = useQuery({
    queryKey: ["receipt-docs", detailDialog],
    enabled: !!detailDialog,
    queryFn: async () => {
      if (!detailDialog) return [];
      const { data, error } = await supabase
        .from("stock_documents" as any)
        .select("id, file_name, file_path, file_type")
        .eq("receipt_id", detailDialog);
      if (error) throw error;
      return (data || []) as unknown as ReceiptDoc[];
    },
  });

  const handleDownload = async (doc: ReceiptDoc) => {
    const { data, error } = await supabase.storage.from("stock-documents").createSignedUrl(doc.file_path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: "Download failed", variant: "destructive" });
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const detailReceipt = receipts.find(r => r.id === detailDialog);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (receipts.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No stock receipts yet. Use "Receive Stock" to record deliveries.
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Supplier</TableHead>
                <TableHead className="text-xs text-center">Items</TableHead>
                <TableHead className="text-xs text-center">Docs</TableHead>
                <TableHead className="text-xs">Notes</TableHead>
                <TableHead className="text-xs w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.map(r => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setDetailDialog(r.id)}
                >
                  <TableCell className="text-xs">{format(new Date(r.receipt_date), "dd MMM yy")}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">{r.supplier_name}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-center font-medium">{r.items_received.length}</TableCell>
                  <TableCell className="text-xs text-center">
                    {r.doc_count > 0 ? (
                      <Badge variant="outline" className="text-[9px]">
                        <FileText className="h-2.5 w-2.5 mr-0.5" />{r.doc_count}
                      </Badge>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground truncate max-w-[150px]">{r.notes || "—"}</TableCell>
                  <TableCell><ChevronDown className="h-3 w-3 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <Dialog open={!!detailDialog} onOpenChange={o => !o && setDetailDialog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              Receipt – {detailReceipt ? format(new Date(detailReceipt.receipt_date), "dd MMM yyyy") : ""}
            </DialogTitle>
          </DialogHeader>

          {detailReceipt && (
            <div className="space-y-4">
              <div className="flex gap-4 text-xs">
                <div><span className="text-muted-foreground">Supplier:</span> <span className="font-medium">{detailReceipt.supplier_name}</span></div>
                {detailReceipt.notes && <div><span className="text-muted-foreground">Notes:</span> {detailReceipt.notes}</div>}
              </div>

              <div>
                <p className="text-xs font-medium mb-1">Items Received</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Product</TableHead>
                      <TableHead className="text-[10px] text-center">Qty</TableHead>
                      <TableHead className="text-[10px]">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailReceipt.items_received.map((item: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-mono">{item.product_id?.slice(0, 8)}...</TableCell>
                        <TableCell className="text-xs text-center font-semibold">{item.quantity}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{item.notes || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {receiptDocs.length > 0 && (
                <div>
                  <p className="text-xs font-medium mb-1">Documents</p>
                  <div className="space-y-1">
                    {receiptDocs.map(doc => (
                      <div key={doc.id} className="flex items-center gap-2 p-1.5 bg-muted/50 rounded text-xs">
                        <FileText className="h-3 w-3 text-muted-foreground" />
                        <span className="truncate flex-1">{doc.file_name}</span>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownload(doc)}>
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ReceiptsView;
