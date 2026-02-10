import { useState, useEffect } from "react";
import { ArrowLeft, Plus, Trash2, Loader2, Search, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { notifyInvoiceSent } from "@/lib/notificationService";
import GuidedProductSelector from "@/components/invoicing/GuidedProductSelector";
import CatalogPickerDrawer from "@/components/catalog/CatalogPickerDrawer";

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  service_id?: string | null;
}

interface ServiceTemplate {
  id: string;
  name: string;
  description: string | null;
  default_rate: number;
  category: string;
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
}

interface CreateInvoicePageProps {
  agentId: string;
  onBack: () => void;
  onSuccess: () => void;
  prefillLead?: {
    id: string;
    customer_name: string;
    customer_phone: string;
    customer_address: string;
    customer_id?: string | null;
    service_type?: string;
  } | null;
}

const paymentMethods = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "eft", label: "EFT / Bank Transfer" },
  { value: "other", label: "Other" },
];

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

const CreateInvoicePage = ({ agentId, onBack, onSuccess, prefillLead }: CreateInvoicePageProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showCustomerSearch, setShowCustomerSearch] = useState(!prefillLead);

  // Form state
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(prefillLead?.customer_id || null);
  const [customerName, setCustomerName] = useState(prefillLead?.customer_name || "");
  const [customerPhone, setCustomerPhone] = useState(prefillLead?.customer_phone || "");
  const [customerAddress, setCustomerAddress] = useState(prefillLead?.customer_address || "");
  const [customerEmail, setCustomerEmail] = useState("");
  const [leadId, setLeadId] = useState(prefillLead?.id || "");
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: prefillLead?.service_type || "", quantity: 1, rate: 0, amount: 0 }
  ]);
  const [taxRate] = useState(15);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [showGuidedSelector, setShowGuidedSelector] = useState(false);
  const [showCatalogDrawer, setShowCatalogDrawer] = useState(false);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });

  useEffect(() => {
    fetchTemplates();
    fetchCustomers();
    if (prefillLead?.id) {
      fetchUsedParts(prefillLead.id);
    }
  }, []);

  useEffect(() => {
    if (prefillLead?.customer_id) {
      fetchCustomerEmail(prefillLead.customer_id);
    }
  }, [prefillLead?.customer_id]);

  const fetchTemplates = async () => {
    const { data } = await supabase
      .from("service_templates")
      .select("*")
      .eq("is_active", true)
      .order("category", { ascending: true });
    if (data) setTemplates(data as unknown as ServiceTemplate[]);
  };

  const fetchCustomers = async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, email, phone, address")
      .order("name", { ascending: true });
    if (data) setCustomers(data);
  };

  const fetchCustomerEmail = async (customerId: string) => {
    const { data } = await supabase
      .from("customers")
      .select("email")
      .eq("id", customerId)
      .single();
    if (data?.email) setCustomerEmail(data.email);
  };

  const fetchUsedParts = async (leadId: string) => {
    try {
      const { data, error } = await supabase
        .from("job_used_parts" as any)
        .select("product_name, product_code, unit_cost, quantity")
        .eq("lead_id", leadId);
      if (error) {
        console.warn("[Invoice] Failed to fetch used parts:", error.message);
        return;
      }
      if (data && data.length > 0) {
        const partsItems: LineItem[] = (data as any[]).map(p => ({
          description: `${p.product_name} (${p.product_code})`,
          quantity: p.quantity,
          rate: p.unit_cost,
          amount: p.quantity * p.unit_cost,
        }));
        // Prepend used parts to existing line items, removing empty default
        setLineItems(prev => {
          const existing = prev.filter(i => i.description && i.amount > 0);
          return [...partsItems, ...existing].length > 0
            ? [...partsItems, ...existing]
            : [{ description: "", quantity: 1, rate: 0, amount: 0 }];
        });
        console.log("[Invoice] Auto-added", data.length, "used parts as line items");
      }
    } catch (err) {
      console.error("[Invoice] Error loading used parts:", err);
    }
  };

  const selectCustomer = (customer: Customer) => {
    setSelectedCustomerId(customer.id);
    setCustomerName(customer.name);
    setCustomerPhone(customer.phone);
    setCustomerAddress(customer.address || "");
    setCustomerEmail(customer.email || "");
    setShowCustomerSearch(false);
    setCustomerSearch("");
  };

  const addTemplateItem = (template: ServiceTemplate) => {
    const newItem: LineItem = {
      description: template.name + (template.description ? ` - ${template.description}` : ""),
      quantity: 1,
      rate: template.default_rate,
      amount: template.default_rate,
      service_id: template.id,
    };
    setLineItems([...lineItems.filter(i => i.description || i.amount > 0), newItem]);
  };

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

  const saveInvoice = async (status: "draft" | "sent" | "paid") => {
    if (!customerName.trim()) {
      toast({ title: "Error", description: "Please select or enter a client", variant: "destructive" });
      return;
    }
    if (lineItems.every(item => !item.description || item.amount === 0)) {
      toast({ title: "Error", description: "Add at least one line item", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: invoiceNumber, error: numError } = await supabase.rpc("generate_invoice_number");
      if (numError) throw numError;

      // Need a lead_id - if not from a lead, we need to handle this
      // For standalone invoices, we'll create a minimal lead or use a dummy
      let finalLeadId = leadId;
      if (!finalLeadId) {
        // Create a completed lead for standalone invoice
        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert({
            customer_name: customerName,
            customer_phone: customerPhone,
            customer_address: customerAddress || "N/A",
            service_type: lineItems[0]?.description || "Invoice",
            status: "completed",
            assigned_agent_id: agentId,
            latitude: 0,
            longitude: 0,
            completed_at: new Date().toISOString(),
            customer_id: selectedCustomerId,
          })
          .select("id")
          .single();
        if (leadError) throw leadError;
        finalLeadId = newLead.id;
      }

      const { data: insertedInvoice, error } = await supabase
        .from("invoices")
        .insert({
          invoice_number: invoiceNumber,
          lead_id: finalLeadId,
          agent_id: agentId,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          customer_email: customerEmail || null,
          customer_id: selectedCustomerId || null,
          line_items: lineItems.filter(item => item.description && item.amount > 0),
          subtotal,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          grand_total: grandTotal,
          payment_method: paymentMethod || null,
          notes: notes || null,
          status,
          due_date: dueDate || null,
          issue_date: new Date().toISOString().split("T")[0],
          paid_date: status === "paid" ? new Date().toISOString().split("T")[0] : null,
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      // Insert normalized invoice_items
      const validItems = lineItems.filter(item => item.description && item.amount > 0);
      if (insertedInvoice && validItems.length > 0) {
        const itemsToInsert = validItems.map(item => ({
          invoice_id: insertedInvoice.id,
          service_id: item.service_id || null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.rate,
          amount: item.amount,
        }));
        const { error: itemsError } = await supabase
          .from("invoice_items")
          .insert(itemsToInsert as any);
        if (itemsError) console.error("Error inserting invoice items:", itemsError);
      }

      // Send notification if not draft
      if (selectedCustomerId && status !== "draft" && insertedInvoice) {
        try {
          await notifyInvoiceSent(selectedCustomerId, insertedInvoice.id, invoiceNumber, formatCurrency(grandTotal));
        } catch (e) {
          console.error("[Notification] Error:", e);
        }
      }

      toast({
        title: "Invoice Created! 💰",
        description: `${invoiceNumber} - ${status === "paid" ? "Paid" : status === "sent" ? "Sent" : "Draft"}`,
      });
      onSuccess();
    } catch (error: any) {
      console.error("Invoice creation error:", error);
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(c =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    c.phone.includes(customerSearch)
  );

  return (
    <div className="max-w-lg mx-auto p-4 space-y-4 pb-32">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">New Invoice</h1>
      </div>

      {/* Client Selection */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client</Label>

          {showCustomerSearch ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="pl-9 h-10 rounded-xl"
                />
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {filteredCustomers.slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    onClick={() => selectCustomer(c)}
                    className="w-full text-left p-2.5 rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-[11px] text-muted-foreground">{c.phone}</p>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-accent/30">
                <p className="font-semibold text-sm">{customerName}</p>
                <p className="text-xs text-muted-foreground">{customerPhone}</p>
                {customerAddress && <p className="text-xs text-muted-foreground">{customerAddress}</p>}
              </div>
              {!prefillLead && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowCustomerSearch(true)}
                >
                  Change client
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Add Service Templates */}
      {templates.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-4 space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quick Add Service</Label>
            <div className="flex flex-wrap gap-1.5">
              {templates.map(t => (
                <button
                  key={t.id}
                  onClick={() => addTemplateItem(t)}
                  className="px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  {t.name} {t.default_rate > 0 && `R${t.default_rate}`}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Smart Product Selector */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Item / Product</Label>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-xl text-xs gap-2"
              onClick={() => setShowGuidedSelector(true)}
            >
              <Package className="h-4 w-4" />
              Guided Selector
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl text-xs gap-2"
              onClick={() => setShowCatalogDrawer(true)}
            >
              <Search className="h-4 w-4" />
              Browse Catalog
            </Button>
          </div>
        </CardContent>
      </Card>

      <GuidedProductSelector
        open={showGuidedSelector}
        onOpenChange={setShowGuidedSelector}
        onAddItem={(item) => {
          setLineItems(prev => [...prev.filter(i => i.description || i.amount > 0), item]);
        }}
      />
      <CatalogPickerDrawer
        open={showCatalogDrawer}
        onOpenChange={setShowCatalogDrawer}
        onAddToQuote={(item) => {
          const newItem: LineItem = {
            description: item.description,
            quantity: item.quantity,
            rate: item.unit_price,
            amount: item.quantity * item.unit_price,
          };
          setLineItems(prev => [...prev.filter(i => i.description || i.amount > 0), newItem]);
        }}
      />

      {/* Line Items */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line Items</Label>
            <Button variant="outline" size="sm" className="h-7 px-2 text-xs rounded-lg" onClick={addLineItem}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>

          {lineItems.map((item, index) => (
            <div key={index} className="p-3 rounded-xl bg-accent/20 space-y-2">
              <div className="flex items-start gap-2">
                <Input
                  placeholder="Service description"
                  value={item.description}
                  onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  className="h-9 text-sm flex-1 rounded-lg"
                />
                {lineItems.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => removeLineItem(index)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Qty</Label>
                  <Input type="number" min="0" step="1" value={item.quantity} onChange={(e) => updateLineItem(index, "quantity", e.target.value)} className="h-9 text-sm rounded-lg" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Rate (R)</Label>
                  <Input type="number" min="0" step="0.01" value={item.rate} onChange={(e) => updateLineItem(index, "rate", e.target.value)} className="h-9 text-sm rounded-lg" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Amount</Label>
                  <div className="h-9 px-3 flex items-center bg-muted rounded-lg text-sm font-medium">
                    {formatCurrency(item.amount)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Due Date & Payment */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] text-muted-foreground">Due Date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9 text-sm rounded-lg" />
            </div>
            <div>
              <Label className="text-[10px] text-muted-foreground">Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="h-9 text-sm rounded-lg">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map(m => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Totals */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">VAT ({taxRate}%)</span>
            <span>{formatCurrency(taxAmount)}</span>
          </div>
          <div className="h-px bg-border my-1" />
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">{formatCurrency(grandTotal)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Notes */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <Label className="text-[10px] text-muted-foreground">Notes</Label>
          <Textarea placeholder="Additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-sm resize-none rounded-lg mt-1" />
        </CardContent>
      </Card>

      {/* Fixed Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-md border-t z-50 max-w-lg mx-auto space-y-2">
        <Button
          className="w-full h-12 rounded-xl font-semibold text-base"
          style={{ backgroundColor: '#0077B6' }}
          onClick={() => saveInvoice("sent")}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Send Invoice
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-10 rounded-xl" onClick={() => saveInvoice("draft")} disabled={loading}>
            Save Draft
          </Button>
          <Button className="h-10 rounded-xl bg-green-600 hover:bg-green-700" onClick={() => saveInvoice("paid")} disabled={loading}>
            Mark Paid
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CreateInvoicePage;
