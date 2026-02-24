import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload, FileDown, Send, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { cn } from "@/lib/utils";
import { useProductOptions, type ProductOption } from "@/hooks/useProductOptions";
import ProductSearchDropdown from "@/components/shared/ProductSearchDropdown";
import { useQuoteSessionStore } from "@/stores/quoteSessionStore";
import { useExitGuard } from "@/hooks/useExitGuard";
import UnsavedQuoteDialog from "@/components/shared/UnsavedQuoteDialog";
import BeCoolLogo from "@/components/shared/BeCoolLogo";
import { generateDocumentPdf } from "@/lib/documentPdf";

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

interface ProposalBuilderProps {
  quoteId?: string;
  proposalId?: string;
  onBack: () => void;
  onSuccess?: () => void;
  onConvertedToInvoice?: (invoiceId: string) => void;
  prefillFromQuote?: {
    id: string;
    customer_id?: string | null;
    customer_name?: string;
    items?: { description: string; quantity: number; rate: number }[];
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

const ProposalBuilder = ({
  quoteId,
  proposalId,
  onBack,
  onSuccess,
  onConvertedToInvoice,
  prefillFromQuote,
}: ProposalBuilderProps) => {
  const { toast } = useToast();
  const { settings: companySettings } = useCompanySettings();
  const allOptions = useProductOptions();

  const [loading, setLoading] = useState(false);
  const [proposalNumber, setProposalNumber] = useState<string>("");
  const [existingId, setExistingId] = useState<string | null>(proposalId || null);
  const isEditing = !!existingId;

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    prefillFromQuote?.customer_id || null
  );
  const [customerName, setCustomerName] = useState(prefillFromQuote?.customer_name || "");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
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
  const initialItems: LineItem[] = prefillFromQuote?.items?.length
    ? prefillFromQuote.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        rate: i.rate,
        amount: i.quantity * i.rate,
      }))
    : [{ description: "", quantity: 1, rate: 0, amount: 0 }];

  const [lineItems, setLineItems] = useState<LineItem[]>(initialItems);

  // Discount
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(0);

  // Tax
  const [taxRate] = useState(15);

  // Links
  const [leadId, setLeadId] = useState("");
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
  const { isDirty, setDraft, setDirty, clearDraft } = useQuoteSessionStore();

  useEffect(() => {
    if (lineItems.some((i) => i.description || i.amount > 0) || customerName) {
      setDraft({ clientId: selectedCustomerId, clientName: customerName, lineItems, notes, terms });
    }
  }, [lineItems, customerName, notes, terms, reference]);

  /* ─── Exit guard ─── */
  const handleSaveForLater = useCallback(async () => {
    await saveProposal("draft");
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

  /* ─── Fetch data ─── */
  useEffect(() => {
    if (!proposalId) {
      supabase.rpc("generate_proposal_number").then(({ data }) => {
        if (data) setProposalNumber(data as string);
      });
    }
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
  }, [proposalId]);

  // Load existing proposal
  useEffect(() => {
    if (!proposalId) return;
    (async () => {
      const { data: p } = await supabase
        .from("proposals" as any)
        .select("*")
        .eq("id", proposalId)
        .single();
      if (!p) return;
      const proposal = p as any;
      setProposalNumber(proposal.proposal_number || "");
      setSelectedCustomerId(proposal.customer_id);
      setIssueDate(proposal.issue_date || new Date().toISOString().split("T")[0]);
      setDueDate(proposal.due_date || "");
      setReference(proposal.reference || "");
      setDiscountType(proposal.discount_type || "percent");
      setDiscountValue(proposal.discount_value || 0);
      setNotes(proposal.notes || "");
      setTerms(proposal.terms || "");
      setLeadId(proposal.lead_id || "");
      if (proposal.discount_value > 0) setShowDiscount(true);

      const { data: items } = await supabase
        .from("proposal_items" as any)
        .select("*")
        .eq("proposal_id", proposalId)
        .order("sort_order");
      if (items && (items as any[]).length > 0) {
        setLineItems(
          (items as any[]).map((i: any) => ({
            description: i.description,
            quantity: i.quantity,
            rate: i.rate,
            amount: i.line_total,
            service_id: i.service_id,
          }))
        );
      }
      setDirty(false);
    })();
  }, [proposalId]);

  // Prefill customer details
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

  // Terms from company settings
  useEffect(() => {
    if (proposalId) return;
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
  }, [companySettings, proposalId]);

  /* ─── Logo URL ─── */
  const logoUrl = useMemo(() => {
    const path = companySettings.logo_storage_path;
    if (!path) return null;
    if (path.startsWith("http")) return path;
    const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
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
        const path = `proposals/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("proposal-attachments").upload(path, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from("proposal-attachments").getPublicUrl(path);
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
  const saveProposal = async (status: "draft" | "sent" | "approved") => {
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
      let finalNumber = proposalNumber;
      if (!finalNumber) {
        const { data, error } = await supabase.rpc("generate_proposal_number");
        if (error) throw error;
        finalNumber = data as string;
        setProposalNumber(finalNumber);
      }

      const payload = {
        proposal_number: finalNumber,
        customer_id: selectedCustomerId || null,
        lead_id: leadId || null,
        quote_id: quoteId || null,
        issue_date: issueDate,
        due_date: dueDate || null,
        reference: reference || null,
        subtotal,
        discount_type: discountType,
        discount_value: discountValue,
        discount_amount: discountAmount,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total: grandTotal,
        notes: notes || null,
        terms: terms || null,
        status,
      } as any;

      let savedId = existingId;

      if (existingId) {
        const { error } = await supabase
          .from("proposals" as any)
          .update(payload)
          .eq("id", existingId);
        if (error) throw error;
      } else {
        const { data: auth } = await supabase.auth.getUser();
        payload.created_by = auth.user?.id || null;
        const { data: inserted, error } = await supabase
          .from("proposals" as any)
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        savedId = (inserted as any).id;
        setExistingId(savedId);
      }

      // Save line items
      if (savedId) {
        await supabase.from("proposal_items" as any).delete().eq("proposal_id", savedId);
        const validItems = lineItems.filter((i) => i.description);
        if (validItems.length > 0) {
          await supabase.from("proposal_items" as any).insert(
            validItems.map((i, idx) => ({
              proposal_id: savedId,
              service_id: i.service_id || null,
              description: i.description,
              quantity: i.quantity,
              rate: i.rate,
              line_total: i.amount,
              sort_order: idx,
            }))
          );
        }
      }

      clearDraft();
      toast({
        title: "Proposal Saved! 📋",
        description: `${finalNumber} – ${status === "approved" ? "Approved" : status === "sent" ? "Sent" : "Draft"}`,
      });
      onSuccess?.();
    } catch (error: any) {
      console.error("Proposal save error:", error);
      toast({ title: "Error", description: error.message || "Failed to save proposal", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  /* ─── Convert to Invoice ─── */
  const convertToInvoice = async () => {
    // Save first if not saved
    if (!existingId) {
      await saveProposal("approved");
    } else {
      // Update status to accepted
      await supabase.from("proposals" as any).update({ status: "accepted" }).eq("id", existingId);
    }

    const proposalSavedId = existingId;
    if (!proposalSavedId) {
      toast({ title: "Error", description: "Please save the estimate first", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // Generate invoice number
      const { data: invNum, error: rpcErr } = await supabase.rpc("generate_invoice_number");
      if (rpcErr) throw rpcErr;

      // Get agent id
      const { data: auth } = await supabase.auth.getUser();
      const agentId = auth.user?.id || "00000000-0000-0000-0000-000000000001";

      // Create a lead for the invoice
      const { data: newLead, error: leadErr } = await supabase
        .from("leads")
        .insert({
          customer_name: customerName,
          customer_phone: customerPhone || "N/A",
          customer_address: customerAddress || "N/A",
          service_type: lineItems[0]?.description || "Estimate Conversion",
          status: "completed",
          assigned_agent_id: agentId,
          latitude: 0,
          longitude: 0,
          completed_at: new Date().toISOString(),
          customer_id: selectedCustomerId,
        })
        .select("id")
        .single();
      if (leadErr) throw leadErr;

      // Create invoice
      const validItems = lineItems.filter((i) => i.description && i.amount > 0);
      const { data: newInvoice, error: invErr } = await supabase
        .from("invoices")
        .insert({
          invoice_number: invNum as string,
          lead_id: newLead.id,
          agent_id: agentId,
          customer_name: customerName,
          customer_phone: customerPhone || null,
          customer_address: customerAddress || null,
          customer_email: customerEmail || null,
          customer_id: selectedCustomerId || null,
          line_items: validItems,
          subtotal,
          tax_rate: taxRate,
          tax_amount: taxAmount,
          grand_total: grandTotal,
          notes: notes || null,
          status: "draft",
          due_date: dueDate || null,
          issue_date: issueDate,
        } as any)
        .select("id")
        .single();
      if (invErr) throw invErr;

      // Copy line items to invoice_items
      if (newInvoice && validItems.length > 0) {
        await supabase.from("invoice_items").insert(
          validItems.map((i) => ({
            invoice_id: newInvoice.id,
            service_id: i.service_id || null,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.rate,
            amount: i.amount,
          })) as any
        );
      }

      clearDraft();
      toast({ title: "Converted to Invoice! 🎉", description: `Invoice ${invNum} created as Draft` });
      onConvertedToInvoice?.(newInvoice!.id);
      if (!onConvertedToInvoice) onSuccess?.();
    } catch (err: any) {
      console.error("Convert to invoice error:", err);
      toast({ title: "Error", description: err.message || "Failed to convert", variant: "destructive" });
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
    <div className="min-h-screen bg-muted/40">
      <UnsavedQuoteDialog
        open={exitGuard.showModal}
        onContinue={exitGuard.confirmContinue}
        onSaveForLater={exitGuard.confirmSaveForLater}
        onDiscard={exitGuard.confirmDiscard}
      />

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">{isEditing ? "Edit Estimate" : "New Estimate"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exitGuard.requestExit}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" onClick={() => saveProposal("draft")} disabled={loading}>
            Save Draft
          </Button>
          {isEditing && (
            <Button variant="outline" size="sm" onClick={convertToInvoice} disabled={loading} className="border-amber-500 text-amber-700 hover:bg-amber-50">
              <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
              Convert to Invoice
            </Button>
          )}
          <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveProposal("sent")} disabled={loading}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Send To…
          </Button>
        </div>
      </div>

      {/* ── A4 Card ── */}
      <div className="max-w-3xl mx-auto my-8 bg-background shadow-lg rounded-lg border p-8 md:p-12 space-y-8">
        {/* ── HEADER ROW ── */}
        <div className="flex flex-row items-start justify-between">
          <div className="shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="max-h-[150px] max-w-[300px] w-auto object-contain" />
            ) : (
              <div className="scale-125 origin-left">
                <BeCoolLogo />
              </div>
            )}
          </div>
          <div className="flex flex-col items-end text-right gap-2">
            <p className="font-bold text-lg text-foreground">{companySettings.company_name || "Your Company"}</p>
            <div>
              {companySettings.physical_address && <p className="text-sm text-muted-foreground">{companySettings.physical_address}</p>}
              {companySettings.vat_number && <p className="text-sm text-muted-foreground">VAT: {companySettings.vat_number}</p>}
            </div>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Phone: 0800 BE COOL &nbsp;|&nbsp; Email: info@0800becool.co.za &nbsp;|&nbsp; Website: www.0800becool.co.za
            </p>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── BILLED TO + DATES ROW ── */}
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
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Proposal Number</p>
            <p className="text-sm font-medium text-foreground px-2 py-1.5">{proposalNumber || "Generating…"}</p>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Estimated Amount (ZAR)</p>
            <p className="text-xl font-bold px-2 py-0.5" style={{ color: "#0077B6" }}>{formatCurrency(grandTotal)}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 -mt-4">
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

        <div className="h-px bg-border" />

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
                <ProductSearchDropdown value={item.description} allOptions={allOptions} onChange={(val) => updateLineItem(idx, "description", val)} onSelect={(opt) => pickOption(opt, idx)} />
              </div>
              <div><GhostInput type="number" min="0" step="0.01" className="text-right" value={item.rate || ""} onChange={(e) => updateLineItem(idx, "rate", e.target.value)} placeholder="0.00" /></div>
              <div><GhostInput type="number" min="0" step="1" className="text-right" value={item.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} placeholder="1" /></div>
              <div><GhostInput type="number" min="0" step="1" className="text-right" value={item.markup || ""} onChange={(e) => updateLineItem(idx, "markup", e.target.value)} placeholder="0" /></div>
              <div className="text-right text-sm font-medium py-1.5 px-2">{formatCurrency(item.amount)}</div>
              <div className="flex justify-center">
                <button onClick={() => removeLineItem(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"><X className="h-4 w-4" /></button>
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
            <div className="flex justify-between text-base font-bold p-2 rounded" style={{ backgroundColor: "#0077B610", color: "#0077B6" }}>
              <span>Total (ZAR)</span>
              <span>{formatCurrency(grandTotal)}</span>
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
      <div className="sticky bottom-0 z-40 bg-background border-t px-4 py-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => generateDocumentPdf({
          docType: "Proposal", docNumber: proposalNumber, companyName: companySettings.company_name || "Your Company",
          companyAddress: companySettings.physical_address || "", vatNumber: companySettings.vat_number || "",
          customerName, customerAddress, customerEmail, issueDate, dueDate,
          lineItems: lineItems.filter(i => i.description), subtotal, discountAmount, taxRate, taxAmount, total: grandTotal, notes, terms,
        })}>
          <FileDown className="h-4 w-4 mr-1" />PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast({ title: "Email placeholder", description: "Email sending will be connected soon." })}>
          <Send className="h-4 w-4 mr-1" />Send
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveProposal("approved")} disabled={loading}>
          Mark Approved
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveProposal("draft")} disabled={loading}>
          Save Draft
        </Button>
        <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveProposal("sent")} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Send Proposal
        </Button>
      </div>
    </div>
  );
};

export default ProposalBuilder;
