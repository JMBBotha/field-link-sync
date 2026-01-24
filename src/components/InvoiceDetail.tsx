import { useState, useEffect } from "react";
import { X, Loader2, Send, CheckCircle, Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface InvoiceDetailProps {
  invoiceId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-gray-500", text: "text-white", label: "Draft" },
    sent: { bg: "bg-blue-500", text: "text-white", label: "Sent" },
    paid: { bg: "bg-green-500", text: "text-white", label: "Paid" },
    overdue: { bg: "bg-red-500", text: "text-white", label: "Overdue" },
  };
  const c = config[status] || { bg: "bg-gray-500", text: "text-white", label: status };
  return <Badge className={`${c.bg} ${c.text}`}>{c.label}</Badge>;
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-ZA", {
    style: "currency",
    currency: "ZAR",
  }).format(amount);
};

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const InvoiceDetail = ({ invoiceId, open, onClose, onUpdate }: InvoiceDetailProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);

  useEffect(() => {
    if (invoiceId && open) {
      fetchInvoice();
    }
  }, [invoiceId, open]);

  const fetchInvoice = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices" as "leads")
      .select("*")
      .eq("id", invoiceId)
      .single();

    if (error) {
      console.error("Error fetching invoice:", error);
      toast({
        title: "Error",
        description: "Failed to load invoice details",
        variant: "destructive",
      });
    } else {
      setInvoice(data);
    }
    setLoading(false);
  };

  const updateStatus = async (newStatus: string) => {
    setUpdating(true);
    const { error } = await supabase
      .from("invoices" as "leads")
      .update({ status: newStatus, updated_at: new Date().toISOString() } as any)
      .eq("id", invoiceId);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update invoice",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Invoice Updated! ✅",
        description: `Status changed to ${newStatus}`,
      });
      setInvoice({ ...invoice, status: newStatus });
      onUpdate?.();
    }
    setUpdating(false);
  };

  if (!open) return null;

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent 
        side="bottom" 
        className="h-[90vh] rounded-t-2xl border-t bg-card/95 backdrop-blur-md overflow-hidden flex flex-col"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
        </div>

        <SheetHeader className="px-1 pb-4 flex-shrink-0">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <SheetTitle className="text-lg font-bold">Invoice Details</SheetTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </SheetHeader>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#0077B6]" />
          </div>
        ) : invoice ? (
          <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between p-4 rounded-xl bg-background/50 border">
              <div>
                <h2 className="text-xl font-bold" style={{ color: '#0077B6' }}>
                  {invoice.invoice_number}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {formatDate(invoice.created_at)}
                </p>
              </div>
              {getStatusBadge(invoice.status)}
            </div>

            {/* Customer Info */}
            <div className="p-4 rounded-xl bg-background/50 border">
              <p className="text-xs text-muted-foreground mb-1">Customer</p>
              <p className="font-semibold">{invoice.customer_name}</p>
              {invoice.customer_phone && (
                <p className="text-sm text-muted-foreground">{invoice.customer_phone}</p>
              )}
              {invoice.customer_address && (
                <p className="text-sm text-muted-foreground mt-1">{invoice.customer_address}</p>
              )}
            </div>

            {/* Line Items */}
            <div className="p-4 rounded-xl bg-background/50 border space-y-3">
              <p className="text-xs text-muted-foreground font-semibold uppercase">Line Items</p>
              {(invoice.line_items as LineItem[])?.map((item, idx) => (
                <div key={idx} className="flex justify-between items-start py-2 border-b last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatCurrency(item.rate)}
                    </p>
                  </div>
                  <span className="font-semibold">{formatCurrency(item.amount)}</span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="p-4 rounded-xl bg-background/50 border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(invoice.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax ({invoice.tax_rate}%)</span>
                <span>{formatCurrency(invoice.tax_amount)}</span>
              </div>
              <div className="h-px bg-border my-2" />
              <div className="flex justify-between text-lg font-bold">
                <span>Grand Total</span>
                <span style={{ color: '#0077B6' }}>{formatCurrency(invoice.grand_total)}</span>
              </div>
            </div>

            {/* Payment Method */}
            {invoice.payment_method && (
              <div className="p-4 rounded-xl bg-background/50 border">
                <p className="text-xs text-muted-foreground mb-1">Payment Method</p>
                <p className="font-medium capitalize">{invoice.payment_method}</p>
              </div>
            )}

            {/* Notes */}
            {invoice.notes && (
              <div className="p-4 rounded-xl bg-background/50 border">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{invoice.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Invoice not found
          </div>
        )}

        {/* Action Buttons */}
        {invoice && (
          <div className="flex-shrink-0 border-t pt-3 pb-2 px-1 space-y-2">
            {invoice.status === "draft" && (
              <Button
                className="w-full h-11 rounded-full font-semibold"
                style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                onClick={() => updateStatus("sent")}
                disabled={updating}
              >
                {updating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                Mark as Sent
              </Button>
            )}
            {invoice.status === "sent" && (
              <Button
                className="w-full h-11 rounded-full font-semibold bg-green-600 hover:bg-green-700"
                onClick={() => updateStatus("paid")}
                disabled={updating}
              >
                {updating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle className="h-4 w-4 mr-2" />
                )}
                Mark as Paid
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full h-10 rounded-full"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4 mr-2" />
              Print Invoice
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};

export default InvoiceDetail;