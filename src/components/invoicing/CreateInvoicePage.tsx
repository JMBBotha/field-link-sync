import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload, FileDown, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { notifyInvoiceSent } from "@/lib/notificationService";
import { cn } from "@/lib/utils";
import { useProductOptions, type ProductOption } from "@/hooks/useProductOptions";
import ProductSearchDropdown from "@/components/shared/ProductSearchDropdown";
import { useQuoteSessionStore } from "@/stores/quoteSessionStore";
import { useExitGuard } from "@/hooks/useExitGuard";
import UnsavedQuoteDialog from "@/components/shared/UnsavedQuoteDialog";
import BeCoolLogo from "@/components/shared/BeCoolLogo";
import DocumentHeader from "@/components/shared/DocumentHeader";
import { generateDocumentPdf } from "@/lib/documentPdf";
import StickyActionBar from "@/components/shared/StickyActionBar";

/* ────────── Types ────────── */

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  markup?: number;
  amount: number;
  service_id?: string | null;
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
}

interface Lead {
  id: string;
  customer_name: string;
  service_type: string;
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
  prefillFromProposal?: {
    id: string;
    title: string;
    customer_id: string;
    items: { description: string; quantity: number; rate: number }[];
  };
  prefillFromLead?: {
    id: string;
    customer_name: string;
    customer_phone?: string;
    customer_address?: string;
    customer_id?: string | null;
  };
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

/* ────────── Ghost input ────────── */

const GhostInput = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) => (
  <input
    {...props}
    className={cn(
      "w-full bg-transparent border border-transparent rounded px-2 py-1.5 text-sm outline-none transition-colors",
      "hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/30",
      "placeholder:text-muted-foreground/50",
      className
    )}
  />
);

/* ────────── Main Component ────────── */

const CreateInvoicePage = ({
  agentId,
  onBack,
  onSuccess,
  prefillLead,
  prefillFromProposal,
  prefillFromLead,
}: CreateInvoicePageProps) => {
  const { toast } = useToast();
  const { user } = useAuth();
  const { settings: companySettings } = useCompanySettings();
  const allOptions = useProductOptions();

  const [loading, setLoading] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState<string>("");

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    prefillLead?.customer_id || prefillFromProposal?.customer_id || prefillFromLead?.customer_id || null
  );
  const [customerName, setCustomerName] = useState(
    prefillLead?.customer_name || prefillFromLead?.customer_name || ""
  );
  const [customerPhone, setCustomerPhone] = useState(prefillLead?.customer_phone || prefillFromLead?.customer_phone || "");
  const [customerAddress, setCustomerAddress] = useState(prefillLead?.customer_address || prefillFromLead?.customer_address || "");
  const [customerEmail, setCustomerEmail] = useState("");
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Dates
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + (companySettings.default_payment_terms_days || 30));
    return d.toISOString().split("T")[0];
  });
  const [reference, setReference] = useState("");

  // Line items
  const initialItems: LineItem[] = prefillFromProposal?.items?.length
    ? prefillFromProposal.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        rate: i.rate,
        amount: i.quantity * i.rate,
      }))
    : [{ description: prefillLead?.service_type || "", quantity: 1, rate: 0, amount: 0 }];

  const [lineItems, setLineItems] = useState<LineItem[]>(initialItems);

  // Discount
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(0);

  // Tax
  const [taxRate] = useState(15);

  // Amounts
  const [amountPaid, setAmountPaid] = useState(0);

  // Links
  const [leadId, setLeadId] = useState(prefillLead?.id || prefillFromLead?.id || "");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showLinks, setShowLinks] = useState(false);

  // Notes / Terms
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  // Attachments
  const [attachments, setAttachments] = useState<{ name: string; url: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ─── Zustand store ─── */
  const { isDirty, setDraft, clearDraft } = useQuoteSessionStore();

  useEffect(() => {
    if (lineItems.some((i) => i.description || i.amount > 0) || customerName) {
      setDraft({ clientId: selectedCustomerId, clientName: customerName, lineItems, notes, terms });
    }
  }, [lineItems, customerName, notes, terms, reference]);

  /* ─── Exit guard ─── */
  const handleSaveForLater = useCallback(async () => {
    await saveInvoice("draft");
    clearDraft();
  }, [clearDraft]);

  const handleDiscard = useCallback(() => {
    clearDraft();
    onBack();
  }, [clearDraft, onBack]);

  const exitGuard = useExitGuard({
    isDirty,
    onSaveForLater: handleSaveForLater,
    onDiscard: handleDiscard,
  });

  /* ─── Derived ─── */
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const discountAmount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * (taxRate / 100);
  const grandTotal = taxableAmount + taxAmount;
  const amountDue = grandTotal - amountPaid;

  /* ─── Fetch data ─── */
  useEffect(() => {
    supabase.rpc("generate_invoice_number").then(({ data }) => {
      if (data) setInvoiceNumber(data as string);
    });
    supabase
      .from("customers")
      .select("id, name, email, phone, address")
      .order("name")
      .then(({ data }) => {
        if (data) setCustomers(data);
      });
    supabase
      .from("leads")
      .select("id, customer_name, service_type")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setLeads(data);
      });
  }, []);

  // Prefill customer email
  useEffect(() => {
    const cid = selectedCustomerId;
    if (!cid) return;
    supabase
      .from("customers")
      .select("email, name, phone, address")
      .eq("id", cid)
      .single()
      .then(({ data }) => {
        if (data) {
          if (data.email) setCustomerEmail(data.email);
          if (!customerName && data.name) setCustomerName(data.name);
          if (!customerPhone && data.phone) setCustomerPhone(data.phone);
          if (!customerAddress && data.address) setCustomerAddress(data.address || "");
        }
      });
  }, [selectedCustomerId]);

  // Fetch used parts for lead
  useEffect(() => {
    const lid = prefillLead?.id;
    if (!lid) return;
    supabase
      .from("job_used_parts" as any)
      .select("product_name, product_code, unit_cost, quantity")
      .eq("lead_id", lid)
      .then(({ data }) => {
        if (data && (data as any[]).length > 0) {
          const parts: LineItem[] = (data as any[]).map((p: any) => ({
            description: `${p.product_name} (${p.product_code})`,
            quantity: p.quantity,
            rate: p.unit_cost,
            amount: p.quantity * p.unit_cost,
          }));
          setLineItems((prev) => {
            const existing = prev.filter((i) => i.description && i.amount > 0);
            const merged = [...parts, ...existing];
            return merged.length ? merged : [{ description: "", quantity: 1, rate: 0, amount: 0 }];
          });
        }
      });
  }, [prefillLead?.id]);

  // Terms from company settings
  useEffect(() => {
    const parts: string[] = [];
    const b = companySettings.banking_details;
    if (b && (b.bank_name || b.account_number)) {
      parts.push("Banking Details:");
      if (b.bank_name) parts.push(`Bank: ${b.bank_name}`);
      if (b.account_number) parts.push(`Account: ${b.account_number}`);
      if (b.branch_code) parts.push(`Branch: ${b.branch_code}`);
      if (b.account_type) parts.push(`Type: ${b.account_type}`);
    }
    setTerms(parts.join("\n"));
  }, [companySettings]);

  /* ─── Logo URL ─── */
  const logoUrl = useMemo(() => {
    const path = companySettings.logo_storage_path;
    if (!path) return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("company-assets").getPublicUrl(path);
    return data?.publicUrl || null;
  }, [companySettings.logo_storage_path]);

  /* ─── Handlers ─── */
  const selectCustomer = (c: Customer) => {
    setSelectedCustomerId(c.id);
    setCustomerName(c.name);
    setCustomerPhone(c.phone);
    setCustomerAddress(c.address || "");
    setCustomerEmail(c.email || "");
    setShowCustomerPicker(false);
    setCustomerSearch("");
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const items = [...lineItems];
    const item = { ...items[index] };
    if (field === "description") {
      item.description = value as string;
    } else if (field === "quantity") {
      item.quantity = Math.max(0, Number(value) || 0);
      const clientRate = item.rate * (1 + (item.markup || 0) / 100);
      item.amount = item.quantity * clientRate;
    } else if (field === "rate") {
      item.rate = Math.max(0, Number(value) || 0);
      const clientRate = item.rate * (1 + (item.markup || 0) / 100);
      item.amount = item.quantity * clientRate;
    } else if (field === "markup") {
      item.markup = Math.max(0, Number(value) || 0);
      const clientRate = item.rate * (1 + item.markup / 100);
      item.amount = item.quantity * clientRate;
    }
    items[index] = item;
    setLineItems(items);
  };

  const pickOption = (opt: ProductOption, index: number) => {
    const items = [...lineItems];
    items[index] = {
      description: opt.name,
      quantity: 1,
      rate: opt.rate,
      markup: 0,
      amount: opt.rate,
      service_id: opt.source === "template" ? opt.id : null,
    };
    setLineItems(items);
  };

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: 1, rate: 0, markup: 0, amount: 0 }]);
  const removeLineItem = (i: number) => {
    if (lineItems.length > 1) setLineItems(lineItems.filter((_, idx) => idx !== i));
  };

  /* ─── File upload ─── */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const path = `invoices/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("invoice-attachments").upload(path, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from("invoice-attachments").getPublicUrl(path);
        setAttachments((prev) => [...prev, { name: file.name, url: urlData.publicUrl }]);
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ─── Save ─── */
  const saveInvoice = async (status: "draft" | "sent" | "paid") => {
    if (!customerName.trim()) {
      toast({ title: "Error", description: "Please select or enter a client", variant: "destructive" });
      return;
    }
    if (lineItems.every((i) => !i.description || i.amount === 0)) {
      toast({ title: "Error", description: "Add at least one line item", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      let finalNumber = invoiceNumber;
      if (!finalNumber) {
        const { data, error } = await supabase.rpc("generate_invoice_number");
        if (error) throw error;
        finalNumber = data as string;
        setInvoiceNumber(finalNumber);
      }

      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId(user?.id);

      let finalLeadId = leadId;
      if (!finalLeadId) {
        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert({
            customer_name: customerName,
            customer_phone: customerPhone || "N/A",
            customer_address: customerAddress || "N/A",
            service_type: lineItems[0]?.description || "Invoice",
            status: "completed",
            assigned_agent_id: agentId,
            latitude: 0,
            longitude: 0,
            completed_at: new Date().toISOString(),
            customer_id: selectedCustomerId,
            company_id,
          })
          .select("id")
          .single();
        if (leadError) throw leadError;
        finalLeadId = newLead.id;
      }

      const { data: insertedInvoice, error } = await supabase
        .from("invoices")
        .insert({
          invoice_number: finalNumber,
          lead_id: finalLeadId,
          agent_id: agentId,
          company_id,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          customer_email: customerEmail || null,
          customer_id: selectedCustomerId || null,
          line_items: lineItems.filter((i) => i.description && i.amount > 0),
          subtotal,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          grand_total: grandTotal,
          payment_method: null,
          notes: notes || null,
          status,
          due_date: dueDate || null,
          issue_date: issueDate,
          paid_date: status === "paid" ? new Date().toISOString().split("T")[0] : null,
        } as any)
        .select("id")
        .single();

      if (error) throw error;

      // Insert normalized invoice_items
      const validItems = lineItems.filter((i) => i.description && i.amount > 0);
      if (insertedInvoice && validItems.length > 0) {
        await supabase.from("invoice_items").insert(
          validItems.map((i) => ({
            invoice_id: insertedInvoice.id,
            service_id: i.service_id || null,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.rate,
            amount: i.amount,
          })) as any
        );
      }

      // Notification
      if (selectedCustomerId && status !== "draft" && insertedInvoice) {
        try {
          await notifyInvoiceSent(selectedCustomerId, insertedInvoice.id, finalNumber, formatCurrency(grandTotal));
        } catch (e) {
          console.error("[Notification] Error:", e);
        }
      }

      clearDraft();
      toast({
        title: "Invoice Created! 💰",
        description: `${finalNumber} – ${status === "paid" ? "Paid" : status === "sent" ? "Sent" : "Draft"}`,
      });
      onSuccess();
    } catch (error: any) {
      console.error("Invoice creation error:", error);
      toast({ title: "Error", description: error.message || "Failed to create invoice", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredCustomers = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.phone.includes(customerSearch) ||
      (c.email && c.email.toLowerCase().includes(customerSearch.toLowerCase()))
  );

  const companyInitials = companySettings.company_name
    ? companySettings.company_name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "CO";

  /* ─── Render ─── */
  return (
    <div className="min-h-screen bg-muted/40 pb-28 lg:pb-24">
      <UnsavedQuoteDialog
        open={exitGuard.showModal}
        onContinue={exitGuard.confirmContinue}
        onSaveForLater={exitGuard.confirmSaveForLater}
        onDiscard={exitGuard.confirmDiscard}
      />

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">New Invoice</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exitGuard.requestExit}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={() => saveInvoice("draft")} disabled={loading}>
            Save Draft
          </Button>
          <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveInvoice("sent")} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Send To…
          </Button>
        </div>
      </div>

      {/* ── A4 Card ── */}
      <div data-pdf-capture-root="invoice" className="max-w-3xl mx-auto my-8 bg-white shadow-lg rounded-lg border p-8 md:p-12 space-y-8 text-slate-900 [&_.text-foreground]:!text-slate-900 [&_.text-muted-foreground]:!text-slate-500 [&_input]:!text-slate-900 [&_textarea]:!text-slate-900 [&_select]:!text-slate-900 [&_input::placeholder]:!text-slate-400 [&_textarea::placeholder]:!text-slate-400">
        {/* ── HEADER ROW ── */}
        <DocumentHeader
          logoUrl={logoUrl}
          companyName={companySettings.company_name}
          physicalAddress={companySettings.physical_address}
          vatNumber={companySettings.vat_number}
        />

        {/* ── BILLED TO + DATES ROW ── */}
        <div className="space-y-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="col-span-1 space-y-1 relative">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billed To</p>
              {customerName && !showCustomerPicker ? (
                <div>
                  <p className="text-sm font-semibold text-foreground">{customerName}</p>
                  {customerAddress && <p className="text-xs text-muted-foreground">{customerAddress}</p>}
                  {customerEmail && <p className="text-xs text-muted-foreground">{customerEmail}</p>}
                  <button onClick={() => setShowCustomerPicker(true)} className="text-[11px] text-primary hover:underline mt-1">Change</button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input autoFocus placeholder="Search clients…" value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} className="w-full pl-7 pr-2 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary/30" />
                  </div>
                  <div className="max-h-40 overflow-y-auto border rounded bg-popover shadow-md">
                    {filteredCustomers.slice(0, 8).map((c) => (
                      <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-accent text-sm transition-colors">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{c.phone}</span>
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && customerSearch && (
                      <p className="text-xs text-muted-foreground p-3">No clients found</p>
                    )}
                  </div>
                  <button className="text-[11px] text-primary hover:underline flex items-center gap-1" onClick={() => { setCustomerName(customerSearch || "New Client"); setShowCustomerPicker(false); setCustomerSearch(""); }}>
                    <Plus className="h-3 w-3" /> Create a Client
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date of Issue</p>
              <GhostInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tax Invoice Number</p>
              <p className="text-sm font-medium text-foreground px-2 py-1.5">{invoiceNumber || "Generating…"}</p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Amount Due (ZAR)</p>
              <p className="text-[28px] font-bold px-2 py-0.5" style={{ color: "#0077B6" }}>{formatCurrency(amountDue)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6" style={{ marginTop: "-12px" }}>
            <div />
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Due Date</p>
              <GhostInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference / PO#</p>
              <GhostInput placeholder="e.g. PO-1234" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div />
          </div>
        </div>

        <div className="h-[2px] w-full" style={{ backgroundColor: "#2c3e6b" }} />

        {/* ── LINE ITEMS TABLE ── */}
        <div>
          <div className="grid grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2 mb-1">
            <div>Description</div>
            <div className="text-right">Cost</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Markup%</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 items-center py-1 group relative">
              <div className="relative">
                <ProductSearchDropdown
                  value={item.description}
                  allOptions={allOptions}
                  onChange={(val) => updateLineItem(idx, "description", val)}
                  onSelect={(opt) => pickOption(opt, idx)}
                />
              </div>
              <div>
                <GhostInput type="number" min="0" step="0.01" className="text-right" value={item.rate || ""} onChange={(e) => updateLineItem(idx, "rate", e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <GhostInput type="number" min="0" step="1" className="text-right" value={item.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} placeholder="1" />
              </div>
              <div>
                <GhostInput type="number" min="0" step="1" className="text-right" value={item.markup || ""} onChange={(e) => updateLineItem(idx, "markup", e.target.value)} placeholder="0" />
              </div>
              <div className="text-right text-sm font-medium py-1.5 px-2">{formatCurrency(item.amount)}</div>
              <div className="flex justify-center">
                <button onClick={() => removeLineItem(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button onClick={addLineItem} className="w-full text-left px-2 py-2.5 text-sm text-primary hover:bg-primary/5 rounded mt-1 flex items-center gap-1.5 transition-colors">
            <Plus className="h-4 w-4" /> Add a Line
          </button>
        </div>

        <div className="h-px bg-border" />

        {/* ── TOTALS ── */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {!showDiscount ? (
              <button onClick={() => setShowDiscount(true)} className="text-sm text-primary hover:underline">+ Add a Discount</button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Discount</span>
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")} className="text-xs border rounded px-1.5 py-1 bg-background">
                  <option value="percent">%</option>
                  <option value="fixed">ZAR</option>
                </select>
                <GhostInput type="number" min="0" className="w-20 text-right" value={discountValue || ""} onChange={(e) => setDiscountValue(Number(e.target.value) || 0)} />
                <span className="text-sm ml-auto">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax ({taxRate}% VAT)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between text-sm font-bold">
              <span>Total</span>
              <span>{formatCurrency(grandTotal)}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-muted-foreground">Amount Paid</span>
              <GhostInput type="number" min="0" className="w-28 text-right" value={amountPaid || ""} onChange={(e) => setAmountPaid(Number(e.target.value) || 0)} />
            </div>
            <div className="flex justify-between text-base font-bold mt-1 p-2 rounded" style={{ backgroundColor: "#0077B610", color: "#0077B6" }}>
              <span>Amount Due (ZAR)</span>
              <span>{formatCurrency(amountDue)}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── LINK TO JOB ── */}
        <div>
          <button className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowLinks(!showLinks)}>
            {showLinks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Link to Job
          </button>
          {showLinks && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead / Job</p>
                <select value={leadId} onChange={(e) => setLeadId(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
                  <option value="">— None —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.customer_name} – {l.service_type}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* ── NOTES ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</p>
          <Textarea placeholder="Notes — any relevant information not already covered" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-sm border-transparent hover:border-border focus:border-primary" />
        </div>

        {/* ── TERMS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Terms</p>
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="min-h-[80px] text-sm border-transparent hover:border-border focus:border-primary" />
        </div>

        {/* ── ATTACHMENTS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, idx) => (
              <a key={idx} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                {a.name}
              </a>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload Files"}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFileUpload} disabled={uploading} />
          </label>
        </div>
      </div>

      {/* ── Bottom action bar ── */}
      <StickyActionBar>
        <Button variant="outline" size="sm" onClick={() => generateDocumentPdf({
          docType: "Invoice", docNumber: invoiceNumber, companyName: companySettings.company_name || "Your Company",
          companyAddress: companySettings.physical_address || "", vatNumber: companySettings.vat_number || "",
          customerName, customerAddress, customerEmail, issueDate, dueDate,
          lineItems: lineItems.filter(i => i.description), subtotal, discountAmount, taxRate, taxAmount, total: grandTotal, notes, terms,
        })}>
          <FileDown className="h-4 w-4 mr-1" />PDF
        </Button>
        <Button variant="outline" size="sm" onClick={async () => {
          await saveInvoice("sent");
          toast({ title: "Email placeholder", description: "Email sending will be connected soon." });
        }} disabled={loading}>
          <Send className="h-4 w-4 mr-1" />Send
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveInvoice("paid")} disabled={loading}>
          Mark Paid
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveInvoice("draft")} disabled={loading}>
          Save Draft
        </Button>
        <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveInvoice("sent")} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Send Invoice
        </Button>
      </StickyActionBar>
    </div>
  );
};

export default CreateInvoicePage;
