import { useState } from "react";
import { X, Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { notifyJobCompleted, notifyInvoiceSent } from "@/lib/notificationService";

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
}

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  customer_id?: string | null;
  service_type?: string;
}

interface InvoiceFormProps {
  lead: Lead;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  agentId: string;
}

const paymentMethods = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "other", label: "Other" },
];

const InvoiceForm = ({ lead, open, onClose, onSuccess, agentId }: InvoiceFormProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, rate: 0, amount: 0 }
  ]);
  const [taxRate, setTaxRate] = useState<number>(15);
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const newItems = [...lineItems];
    const item = { ...newItems[index] };
    
    if (field === "description") {
      item.description = value as string;
    } else if (field === "quantity") {
      item.quantity = Math.max(0, Number(value) || 0);
      item.amount = item.quantity * item.rate;
    } else if (field === "rate") {
      item.rate = Math.max(0, Number(value) || 0);
      item.amount = item.quantity * item.rate;
    }
    
    newItems[index] = item;
    setLineItems(newItems);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: "", quantity: 1, rate: 0, amount: 0 }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      setLineItems(lineItems.filter((_, i) => i !== index));
    }
  };

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const grandTotal = subtotal + taxAmount;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency: "ZAR",
    }).format(amount);
  };

  const saveInvoice = async (status: "draft" | "sent" | "paid") => {
    if (lineItems.every(item => !item.description || item.amount === 0)) {
      toast({
        title: "Error",
        description: "Please add at least one line item with a description and amount",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      // Generate invoice number
      const { data: invoiceNumber, error: numError } = await supabase
        .rpc("generate_invoice_number");

      if (numError) throw numError;

      // Insert invoice and get the created ID
      const { data: insertedInvoice, error } = await supabase
        .from("invoices" as "leads")
        .insert([{
          invoice_number: invoiceNumber,
          lead_id: lead.id,
          agent_id: agentId,
          customer_name: lead.customer_name,
          customer_phone: lead.customer_phone,
          customer_address: lead.customer_address,
          line_items: lineItems.filter(item => item.description && item.amount > 0),
          subtotal,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          grand_total: grandTotal,
          payment_method: paymentMethod || null,
          notes: notes || null,
          status,
        }] as any)
        .select('id')
        .single();

      if (error) throw error;

      // Send WhatsApp notifications if customer is linked and not a draft
      if (lead.customer_id && status !== "draft" && insertedInvoice) {
        try {
          // Send job completed notification
          await notifyJobCompleted(
            lead.customer_id,
            lead.id,
            insertedInvoice.id
          );
          
          // Send invoice notification with portal link
          await notifyInvoiceSent(
            lead.customer_id,
            insertedInvoice.id,
            invoiceNumber,
            formatCurrency(grandTotal)
          );
        } catch (notifError) {
          console.error('[Notification] Error sending invoice notifications:', notifError);
          // Don't fail invoice creation if notification fails
        }
      }

      toast({
        title: `Invoice Created! 💰`,
        description: `${invoiceNumber} - ${status === "paid" ? "Marked as paid" : status === "sent" ? "Marked as sent" : "Saved as draft"}`,
      });

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error("Invoice creation error:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to create invoice",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent 
        side="bottom" 
        className="h-[90vh] rounded-t-2xl border-t bg-card/95 backdrop-blur-md overflow-hidden flex flex-col"
      >
        {/* Swipe Handle */}
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
        </div>

        <SheetHeader className="px-1 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">Create Invoice</SheetTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground text-left">
            {lead.customer_name} • {lead.customer_phone}
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Line Items</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={addLineItem}
              >
                <Plus className="h-3 w-3 mr-1" />
                Add Item
              </Button>
            </div>

            {lineItems.map((item, index) => (
              <div key={index} className="p-3 rounded-lg bg-background/50 border space-y-2">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Description"
                      value={item.description}
                      onChange={(e) => updateLineItem(index, "description", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  {lineItems.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive hover:text-destructive"
                      onClick={() => removeLineItem(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Qty</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Rate (R)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.rate}
                      onChange={(e) => updateLineItem(index, "rate", e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Amount</Label>
                    <div className="h-9 px-3 flex items-center bg-muted rounded-md text-sm font-medium">
                      {formatCurrency(item.amount)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Tax */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Tax Rate (%)</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={taxRate}
                onChange={(e) => setTaxRate(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((method) => (
                    <SelectItem key={method.value} value={method.value}>
                      {method.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Totals */}
          <div className="p-3 rounded-lg bg-background/50 border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax ({taxRate}%)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="h-px bg-border my-1" />
            <div className="flex justify-between text-base font-bold">
              <span>Grand Total</span>
              <span style={{ color: '#0077B6' }}>{formatCurrency(grandTotal)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea
              placeholder="Additional notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex-shrink-0 border-t pt-3 pb-2 px-1 space-y-2">
          <Button
            className="w-full h-11 rounded-full font-semibold"
            style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
            onClick={() => saveInvoice("paid")}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              "Mark as Paid"
            )}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-full"
              onClick={() => saveInvoice("sent")}
              disabled={loading}
            >
              Mark as Sent
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-full"
              onClick={() => saveInvoice("draft")}
              disabled={loading}
            >
              Save as Draft
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default InvoiceForm;