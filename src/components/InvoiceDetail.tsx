import { useState, useEffect } from "react";
import { X, Loader2, Send, Printer, ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { invoiceBalance, recordInvoicePayment, sumSettled, type PaymentRow } from "@/lib/payments";

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
    partially_paid: { bg: "bg-amber-500", text: "text-white", label: "Partially Paid" },
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

const todayInput = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const InvoiceDetail = ({ invoiceId, open, onClose, onUpdate }: InvoiceDetailProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);
  const [payments, setPayments] = useState<PaymentRow[]>([]);

  // Record payment form
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("eft");
  const [payReference, setPayReference] = useState("");
  const [payDate, setPayDate] = useState(todayInput());
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (invoiceId && open) {
      fetchInvoice();
      setShowPayForm(false);
    }
  }, [invoiceId, open]);

  const fetchInvoice = async () => {
    setLoading(true);
    const [invRes, payRes] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", invoiceId!).single(),
      supabase
        .from("payments")
        .select("id, invoice_id, amount, method, reference, payment_date, status, gateway, created_at")
        .eq("invoice_id", invoiceId!)
        .order("payment_date", { ascending: false }),
    ]);

    if (invRes.error) {
      console.error("Error fetching invoice:", invRes.error);
      toast({
        title: "Error",
        description: "Failed to load invoice details",
        variant: "destructive",
      });
    } else {
      setInvoice(invRes.data);
    }
    setPayments(((payRes.data as unknown as PaymentRow[]) || []));
    setLoading(false);
  };

  const amountPaid = sumSettled(payments);
  const balance = invoiceBalance(invoice?.grand_total, amountPaid);

  const openPayForm = () => {
    setPayAmount(balance > 0 ? balance.toFixed(2) : "");
    setPayMethod(invoice?.payment_method && ["cash", "eft", "card", "other"].includes(invoice.payment_method) ? invoice.payment_method : "eft");
    setPayReference("");
    setPayDate(todayInput());
    setShowPayForm(true);
  };

  const updateStatus = async (newStatus: "sent") => {
    setUpdating(true);
    const { error } = await supabase
      .from("invoices")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", invoiceId!);

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

  const submitPayment = async () => {
    const amt = Number(payAmount);
    if (!(amt > 0)) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setRecording(true);
    try {
      await recordInvoicePayment({
        invoiceId: invoiceId!,
        amount: amt,
        method: payMethod,
        reference: payReference || null,
        paymentDate: payDate || null,
      });
      toast({
        title: "Payment recorded 💰",
        description: `${formatCurrency(amt)} applied to ${invoice?.invoice_number}`,
      });
      setShowPayForm(false);
      await fetchInvoice();
      onUpdate?.();
    } catch (err: any) {
      toast({
        title: "Payment failed",
        description: err?.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRecording(false);
    }
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
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
                <span>Total</span>
                <span style={{ color: '#0077B6' }}>{formatCurrency(invoice.grand_total)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Paid</span>
                <span className="text-green-600 font-medium">{formatCurrency(amountPaid)}</span>
              </div>
              <div className="flex justify-between text-base font-bold">
                <span>Balance</span>
                <span className={balance > 0 ? "text-destructive" : "text-green-600"}>
                  {formatCurrency(balance)}
                </span>
              </div>
            </div>

            {/* Payments on this invoice */}
            <div className="p-4 rounded-xl bg-background/50 border space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground font-semibold uppercase">Payments</p>
                {balance > 0 && !showPayForm && (
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={openPayForm}>
                    <Plus className="h-3 w-3 mr-1" /> Record payment
                  </Button>
                )}
              </div>
              {payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                payments.map((p) => {
                  const settled = ["completed", "succeeded", "paid"].includes(String(p.status));
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-sm py-1 border-b last:border-0">
                      <span className="min-w-0 truncate">
                        {new Date(p.payment_date).toLocaleDateString("en-ZA")} • {String(p.method).toUpperCase()}
                        {p.reference && ` • ${p.reference}`}
                        {!settled && (
                          <span className="ml-1 text-xs text-muted-foreground">({p.status})</span>
                        )}
                      </span>
                      <span className={`font-semibold shrink-0 ${settled ? "" : "text-muted-foreground line-through"}`}>
                        {formatCurrency(Number(p.amount))}
                      </span>
                    </div>
                  );
                })
              )}

              {showPayForm && (
                <div className="border-t pt-3 mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Amount (ZAR)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={payAmount}
                        onChange={(e) => setPayAmount(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={payDate}
                        onChange={(e) => setPayDate(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Method</Label>
                      <Select value={payMethod} onValueChange={setPayMethod}>
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="eft">EFT</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input
                        placeholder="Optional"
                        value={payReference}
                        onChange={(e) => setPayReference(e.target.value)}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      className="flex-1 h-9 rounded-full font-semibold bg-green-600 hover:bg-green-700"
                      onClick={submitPayment}
                      disabled={recording}
                    >
                      {recording ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                      Record {payAmount ? formatCurrency(Number(payAmount) || 0) : "payment"}
                    </Button>
                    <Button variant="outline" className="h-9 rounded-full" onClick={() => setShowPayForm(false)} disabled={recording}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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
            {invoice.status !== "draft" && balance > 0 && !showPayForm && (
              <Button
                className="w-full h-11 rounded-full font-semibold bg-green-600 hover:bg-green-700"
                onClick={openPayForm}
              >
                <Plus className="h-4 w-4 mr-2" />
                Record Payment ({formatCurrency(balance)} due)
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
