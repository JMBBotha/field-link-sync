import { useState, useEffect, useMemo, useRef } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

/* ────────── Types ────────── */

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  amount: number;
  service_id?: string | null;
}

interface ProductOption {
  id: string;
  name: string;
  description: string | null;
  rate: number;
  category: string;
  isFavorite: boolean;
  source: "template" | "product";
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

interface QuoteBuilderProps {
  quoteId?: string | null;
  leadId?: string | null;
  onBack: () => void;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

/* ────────── Ghost input (FreshBooks style — borderless until hover/focus) ────────── */

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

/* ────────── Helpers ────────── */

const isAcCategory = (cat: string) => {
  const l = cat.toLowerCase();
  return l.includes("ac") || l.includes("air con");
};

const sortProductOptions = (options: ProductOption[]) => {
  return [...options].sort((a, b) => {
    const aStarAc = a.isFavorite && isAcCategory(a.category) ? 0 : 1;
    const bStarAc = b.isFavorite && isAcCategory(b.category) ? 0 : 1;
    if (aStarAc !== bStarAc) return aStarAc - bStarAc;
    const aFav = a.isFavorite ? 0 : 1;
    const bFav = b.isFavorite ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return a.name.localeCompare(b.name);
  });
};

const filterOptions = (options: ProductOption[], query: string) => {
  if (!query) return options.slice(0, 8);
  const q = query.toLowerCase();
  return options.filter(
    (o) => o.name.toLowerCase().includes(q) || (o.description && o.description.toLowerCase().includes(q))
  );
};

/* ────────── Main Component ────────── */

const QuoteBuilder = ({ quoteId, leadId, onBack }: QuoteBuilderProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { settings: companySettings } = useCompanySettings();

  const [loading, setLoading] = useState(false);
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(quoteId || null);
  const [quoteNumber, setQuoteNumber] = useState<string>("");

  // Customer
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Dates
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split("T")[0];
  });
  const [reference, setReference] = useState("");

  // Line items
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: "", quantity: 1, rate: 0, amount: 0 },
  ]);
  const [allOptions, setAllOptions] = useState<ProductOption[]>([]);
  const [descSuggestions, setDescSuggestions] = useState<ProductOption[]>([]);
  const [activeDescIdx, setActiveDescIdx] = useState<number | null>(null);

  // Discount
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(0);

  // Tax
  const [taxRate] = useState(15);

  // Links
  const [selectedLeadId, setSelectedLeadId] = useState(leadId || "");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [showLinks, setShowLinks] = useState(false);

  // Notes / Terms
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("");

  // Attachments
  const [attachments, setAttachments] = useState<{ name: string; url: string; path: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ─── Derived ─── */
  const subtotal = lineItems.reduce((s, i) => s + i.amount, 0);
  const discountAmount = discountType === "percent" ? subtotal * (discountValue / 100) : discountValue;
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * (taxRate / 100);
  const total = taxableAmount + taxAmount;

  /* ─── Fetch data ─── */
  useEffect(() => {
    // Quote number placeholder – real number generated on save only
    if (!quoteId) {
      setQuoteNumber("Q-####");
    }
    // Merged catalog
    Promise.all([
      supabase.from("service_templates").select("id, name, description, default_rate, category").eq("is_active", true).order("name"),
      supabase.from("supplier_products").select("id, short_name, description, cost_price, category, is_pinned").eq("is_active", true).order("is_pinned", { ascending: false }).order("description"),
    ]).then(([svcRes, prodRes]) => {
      const svcData = svcRes.data || [];
      const prodData = prodRes.data || [];
      const merged: ProductOption[] = [
        ...svcData.map((s: any) => ({ id: s.id, name: s.name, description: s.description, rate: Number(s.default_rate), category: s.category, isFavorite: false, source: "template" as const })),
        ...prodData.map((p: any) => ({ id: p.id, name: p.short_name || p.description, description: p.description, rate: Number(p.cost_price), category: p.category, isFavorite: p.is_pinned ?? false, source: "product" as const })),
      ];
      setAllOptions(sortProductOptions(merged));
    });
    // Customers
    supabase
      .from("customers")
      .select("id, name, email, phone, address")
      .order("name")
      .then(({ data }) => {
        if (data) setCustomers(data);
      });
    // Leads
    supabase
      .from("leads")
      .select("id, customer_name, service_type")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setLeads(data);
      });
  }, [quoteId]);

  // Load existing quote
  useEffect(() => {
    if (!quoteId) return;
    const load = async () => {
      const { data: quote } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
      if (!quote) return;
      const { data: items } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId);

      setQuoteNumber(quote.quote_number || "");
      setSelectedCustomerId(quote.customer_id || null);
      setNotes(quote.notes || "");
      setValidUntil(quote.valid_until || validUntil);
      setReference((quote as any).reference_text || "");
      setTerms((quote as any).terms_text || "");

      const dt = (quote as any).discount_type;
      if (dt === "percentage" || dt === "percent") {
        setDiscountType("percent");
        setDiscountValue(Number((quote as any).discount_value) || 0);
        setShowDiscount(true);
      } else if (dt === "fixed") {
        setDiscountType("fixed");
        setDiscountValue(Number((quote as any).discount_value) || 0);
        setShowDiscount(true);
      }

      if (items?.length) {
        setLineItems(
          items.map((it: any) => ({
            service_id: it.service_id,
            description: it.description,
            quantity: it.quantity,
            rate: Number(it.unit_price),
            amount: it.quantity * Number(it.unit_price),
          }))
        );
      }

      // Load customer info
      if (quote.customer_id) {
        const { data: cust } = await supabase
          .from("customers")
          .select("name, email, phone, address")
          .eq("id", quote.customer_id)
          .single();
        if (cust) {
          setCustomerName(cust.name);
          setCustomerEmail(cust.email || "");
          setCustomerPhone(cust.phone);
          setCustomerAddress(cust.address || "");
        }
      }

      // Load attachments
      const { data: atts } = await supabase.from("quote_attachments").select("*").eq("quote_id", quoteId);
      if (atts?.length) {
        setAttachments(
          atts.map((a: any) => ({
            name: a.filename || a.storage_path,
            path: a.storage_path,
            url: supabase.storage.from("quote-photos").getPublicUrl(a.storage_path).data.publicUrl,
          }))
        );
      }
    };
    load();
  }, [quoteId]);

  // Pre-populate from lead
  useEffect(() => {
    if (!leadId || quoteId) return;
    const loadLead = async () => {
      const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (!lead) return;
      setSelectedLeadId(lead.id);
      if (lead.customer_id) {
        setSelectedCustomerId(lead.customer_id);
        const { data: cust } = await supabase
          .from("customers")
          .select("name, email, phone, address")
          .eq("id", lead.customer_id)
          .single();
        if (cust) {
          setCustomerName(cust.name);
          setCustomerEmail(cust.email || "");
          setCustomerPhone(cust.phone);
          setCustomerAddress(cust.address || "");
        }
      } else {
        setCustomerName(lead.customer_name);
        setCustomerPhone(lead.customer_phone);
        setCustomerAddress(lead.customer_address);
      }
    };
    loadLead();
  }, [leadId, quoteId]);

  // Prefill customer email when customer changes
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
    if (quoteId) return;
    const parts: string[] = [];
    parts.push("1. This quotation is valid for 30 days from the date of issue.");
    parts.push("2. A 50% deposit is required upon acceptance.");
    parts.push("3. Balance due upon completion of work.");
    parts.push("4. All prices include 15% VAT.");
    parts.push("5. Warranty: 12 months on parts, 90 days on labour.");
    const b = companySettings.banking_details;
    if (b && (b.bank_name || b.account_number)) {
      parts.push("");
      parts.push("Banking Details:");
      if (b.bank_name) parts.push(`Bank: ${b.bank_name}`);
      if (b.account_number) parts.push(`Account: ${b.account_number}`);
      if (b.branch_code) parts.push(`Branch: ${b.branch_code}`);
      if (b.account_type) parts.push(`Type: ${b.account_type}`);
    }
    setTerms(parts.join("\n"));
  }, [companySettings, quoteId]);

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
      const q = (value as string).toLowerCase();
      if (q.length >= 1) {
        setDescSuggestions(filterOptions(allOptions, q));
        setActiveDescIdx(index);
      } else {
        setDescSuggestions(allOptions.slice(0, 8));
        setActiveDescIdx(index);
      }
    } else if (field === "quantity") {
      item.quantity = Math.max(0, Number(value) || 0);
      item.amount = item.quantity * item.rate;
    } else if (field === "rate") {
      item.rate = Math.max(0, Number(value) || 0);
      item.amount = item.quantity * item.rate;
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
      amount: opt.rate,
      service_id: opt.source === "template" ? opt.id : null,
    };
    setLineItems(items);
    setDescSuggestions([]);
    setActiveDescIdx(null);
  };

  const addLineItem = () => setLineItems([...lineItems, { description: "", quantity: 1, rate: 0, amount: 0 }]);
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
        const path = `quotes/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("quote-photos").upload(path, file);
        if (error) throw error;
        const { data: urlData } = supabase.storage.from("quote-photos").getPublicUrl(path);
        setAttachments((prev) => [...prev, { name: file.name, url: urlData.publicUrl, path }]);
      }
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /* ─── Save ─── */
  const saveQuote = async (status: "draft" | "sent" | "accepted") => {
    if (!customerName.trim() && !selectedCustomerId) {
      toast({ title: "Error", description: "Please select or enter a client", variant: "destructive" });
      return;
    }
    if (lineItems.every((i) => !i.description || i.amount === 0)) {
      toast({ title: "Error", description: "Add at least one line item", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      let finalNumber = quoteNumber;
      if (!finalNumber || finalNumber === "Q-####" || !quoteId) {
        const { data, error } = await supabase.rpc("generate_quote_number");
        if (error) throw error;
        finalNumber = data as string;
        setQuoteNumber(finalNumber);
      }

      const quotePayload: any = {
        customer_id: selectedCustomerId || null,
        sales_engineer_id: session.user.id,
        subtotal,
        vat_rate: taxRate / 100,
        vat_amount: taxAmount,
        total,
        notes: notes || null,
        valid_until: validUntil || null,
        terms_text: terms || null,
        discount_type: showDiscount ? (discountType === "percent" ? "percentage" : "fixed") : "none",
        discount_value: showDiscount ? discountValue : 0,
        reference_text: reference || null,
        lead_id: selectedLeadId || null,
        ...(status !== "draft" ? { status, sent_at: new Date().toISOString() } : {}),
      };

      let qId = savedQuoteId;

      if (qId) {
        const { error } = await supabase.from("quotes").update(quotePayload).eq("id", qId);
        if (error) throw error;
        await supabase.from("quote_line_items").delete().eq("quote_id", qId);
      } else {
        quotePayload.quote_number = finalNumber;
        const { data, error } = await supabase.from("quotes").insert(quotePayload).select("id").single();
        if (error) throw error;
        qId = data.id;
        setSavedQuoteId(qId);
      }

      const validItems = lineItems.filter((item) => item.description.trim());
      if (validItems.length) {
        const { error } = await supabase.from("quote_line_items").insert(
          validItems.map((item) => ({
            quote_id: qId!,
            service_id: item.service_id || null,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.rate,
          }))
        );
        if (error) throw error;
      }

      // Save attachments references
      if (qId && attachments.length > 0) {
        const existingAtts = await supabase.from("quote_attachments").select("storage_path").eq("quote_id", qId);
        const existingPaths = new Set((existingAtts.data || []).map((a: any) => a.storage_path));
        const newAtts = attachments.filter((a) => !existingPaths.has(a.path));
        if (newAtts.length > 0) {
          await supabase.from("quote_attachments").insert(
            newAtts.map((a) => ({ quote_id: qId!, storage_path: a.path, filename: a.name }))
          );
        }
      }

      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({
        title: status === "sent" ? "Quote Sent! 📧" : "Quote Saved! ✅",
        description: `${finalNumber} – ${formatCurrency(total)}`,
      });
      if (status === "sent") onBack();
    } catch (err: any) {
      console.error("Quote save error:", err);
      toast({ title: "Error", description: err.message, variant: "destructive" });
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

  /* ─── Grouped suggestions for dropdown ─── */
  const starredAcSuggestions = descSuggestions.filter((s) => s.isFavorite && isAcCategory(s.category));
  const serviceSuggestions = descSuggestions.filter((s) => s.source === "template");
  const productSuggestions = descSuggestions.filter((s) => s.source === "product" && !(s.isFavorite && isAcCategory(s.category)));

  /* ─── Render ─── */
  return (
    <div className="min-h-screen bg-muted/40">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">{quoteId ? "Edit Quote" : "New Quote"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveQuote("draft")}
            disabled={loading}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            className="text-white"
            style={{ backgroundColor: "#0077B6" }}
            onClick={() => saveQuote("sent")}
            disabled={loading}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Send To…
          </Button>
        </div>
      </div>

      {/* ── A4 Card ── */}
      <div className="max-w-3xl mx-auto my-8 bg-background shadow-lg rounded-lg border p-8 md:p-12 space-y-8">
        {/* ── HEADER ROW ── */}
        <div className="flex flex-row gap-6 items-start justify-start">
          {/* Logo */}
          <div className="shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="max-h-[130px] max-w-[200px] w-auto object-contain" />
            ) : (
              <div className="h-[130px] w-[130px] rounded-lg bg-primary/10 flex items-center justify-center text-primary text-3xl font-bold">
                {companyInitials}
              </div>
            )}
          </div>
          {/* Company info */}
          <div className="flex flex-col">
            <p className="font-bold text-lg text-foreground">{companySettings.company_name || "Your Company"}</p>
            {companySettings.physical_address && <p className="text-sm text-muted-foreground">{companySettings.physical_address}</p>}
            {companySettings.vat_number && <p className="text-sm text-muted-foreground">VAT: {companySettings.vat_number}</p>}
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── BILLED TO + DATES ROW ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {/* Col 1 — Billed To */}
          <div className="col-span-1 space-y-1 relative">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billed To</p>
            {customerName && !showCustomerPicker ? (
              <div>
                <p className="text-sm font-semibold text-foreground">{customerName}</p>
                {customerAddress && <p className="text-xs text-muted-foreground">{customerAddress}</p>}
                {customerEmail && <p className="text-xs text-muted-foreground">{customerEmail}</p>}
                <button
                  onClick={() => setShowCustomerPicker(true)}
                  className="text-[11px] text-primary hover:underline mt-1"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    autoFocus
                    placeholder="Search clients…"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full pl-7 pr-2 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="max-h-40 overflow-y-auto border rounded bg-popover shadow-md">
                  {filteredCustomers.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm transition-colors"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="text-xs text-muted-foreground ml-2">{c.phone}</span>
                    </button>
                  ))}
                  {filteredCustomers.length === 0 && customerSearch && (
                    <p className="text-xs text-muted-foreground p-3">No clients found</p>
                  )}
                </div>
                <button
                  className="text-[11px] text-primary hover:underline flex items-center gap-1"
                  onClick={() => {
                    setCustomerName(customerSearch || "New Client");
                    setShowCustomerPicker(false);
                    setCustomerSearch("");
                  }}
                >
                  <Plus className="h-3 w-3" /> Create a Client
                </button>
              </div>
            )}
          </div>

          {/* Col 2 — Date of Issue */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date of Issue</p>
            <GhostInput
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>

          {/* Col 3 — Quote Number */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quote Number</p>
            <p className="text-sm font-medium text-foreground px-2 py-1.5">{quoteNumber || "Generating…"}</p>
          </div>

          {/* Col 4 — Quoted Amount */}
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quoted Amount (ZAR)</p>
            <p className="text-xl font-bold px-2 py-0.5" style={{ color: "#0077B6" }}>
              {formatCurrency(total)}
            </p>
          </div>
        </div>

        {/* Row 2: Valid Until / Reference */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 -mt-4">
          <div />
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Valid Until</p>
            <GhostInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference / PO#</p>
            <GhostInput
              placeholder="e.g. PO-1234"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div />
        </div>

        <div className="h-px bg-border" />

        {/* ── LINE ITEMS TABLE ── */}
        <div>
          {/* Header */}
          <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2 mb-1">
            <div className="col-span-6">Description</div>
            <div className="col-span-2 text-right">Rate</div>
            <div className="col-span-1 text-right">Qty</div>
            <div className="col-span-2 text-right">Line Total</div>
            <div className="col-span-1" />
          </div>

          {/* Rows */}
          {lineItems.map((item, idx) => (
            <div
              key={idx}
              className="grid grid-cols-12 gap-2 items-center py-1 group relative"
            >
              <div className="col-span-6 relative">
                <GhostInput
                  placeholder="Item description"
                  value={item.description}
                  onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                  onFocus={() => {
                    const q = item.description.toLowerCase();
                    setDescSuggestions(q.length >= 1 ? filterOptions(allOptions, q) : allOptions.slice(0, 8));
                    setActiveDescIdx(idx);
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setDescSuggestions([]);
                      setActiveDescIdx(null);
                    }, 200);
                  }}
                />
                {activeDescIdx === idx && descSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 z-50 w-80 mt-1 bg-popover border rounded-lg shadow-lg max-h-64 overflow-y-auto">
                    {starredAcSuggestions.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">★ Starred AC Units</div>
                        {starredAcSuggestions.map((o) => (
                          <button key={o.id} onMouseDown={(e) => { e.preventDefault(); pickOption(o, idx); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                            <div className="flex justify-between items-center">
                              <span>{o.name} ⭐</span>
                              <span className="text-xs text-muted-foreground">{o.category}</span>
                              <span className="text-xs font-medium">R {o.rate.toFixed(2)}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                    {serviceSuggestions.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">Services</div>
                        {serviceSuggestions.map((o) => (
                          <button key={o.id} onMouseDown={(e) => { e.preventDefault(); pickOption(o, idx); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                            <div className="flex justify-between items-center">
                              <span>{o.name}</span>
                              <span className="text-xs text-muted-foreground">{o.category}</span>
                              <span className="text-xs font-medium">R {o.rate.toFixed(2)}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                    {productSuggestions.length > 0 && (
                      <>
                        <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30">Products</div>
                        {productSuggestions.map((o) => (
                          <button key={o.id} onMouseDown={(e) => { e.preventDefault(); pickOption(o, idx); }} className="w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors">
                            <div className="flex justify-between items-center">
                              <span>{o.name} {o.isFavorite ? "⭐" : ""}</span>
                              <span className="text-xs text-muted-foreground">{o.category}</span>
                              <span className="text-xs font-medium">R {o.rate.toFixed(2)}</span>
                            </div>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="col-span-2">
                <GhostInput
                  type="number"
                  min="0"
                  step="0.01"
                  className="text-right"
                  value={item.rate || ""}
                  onChange={(e) => updateLineItem(idx, "rate", e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="col-span-1">
                <GhostInput
                  type="number"
                  min="0"
                  step="1"
                  className="text-right"
                  value={item.quantity || ""}
                  onChange={(e) => updateLineItem(idx, "quantity", e.target.value)}
                  placeholder="1"
                />
              </div>
              <div className="col-span-2 text-right text-sm font-medium py-1.5 px-2">
                {formatCurrency(item.amount)}
              </div>
              <div className="col-span-1 flex justify-center">
                <button
                  onClick={() => removeLineItem(idx)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button
            onClick={addLineItem}
            className="w-full text-left px-2 py-2.5 text-sm text-primary hover:bg-primary/5 rounded mt-1 flex items-center gap-1.5 transition-colors"
          >
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
              <button
                onClick={() => setShowDiscount(true)}
                className="text-sm text-primary hover:underline"
              >
                + Add a Discount
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Discount</span>
                <select
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
                  className="text-xs border rounded px-1.5 py-1 bg-background"
                >
                  <option value="percent">%</option>
                  <option value="fixed">ZAR</option>
                </select>
                <GhostInput
                  type="number"
                  min="0"
                  className="w-20 text-right"
                  value={discountValue || ""}
                  onChange={(e) => setDiscountValue(Number(e.target.value) || 0)}
                />
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
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── LINK TO JOB (collapsible) ── */}
        <div>
          <button
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowLinks(!showLinks)}
          >
            {showLinks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Link to Job
          </button>
          {showLinks && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead / Job</p>
                <select
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                >
                  <option value="">— None —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.customer_name} – {l.service_type}
                    </option>
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
          <Textarea
            placeholder="Notes — any relevant information not already covered"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-[60px] text-sm border-transparent hover:border-border focus:border-primary"
          />
        </div>

        {/* ── TERMS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Terms</p>
          <Textarea
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            className="min-h-[80px] text-sm border-transparent hover:border-border focus:border-primary"
          />
        </div>

        {/* ── ATTACHMENTS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <a
                key={i}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-xs text-primary hover:underline bg-primary/5 px-2 py-1 rounded"
              >
                <Paperclip className="h-3 w-3" />
                {a.name}
              </a>
            ))}
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-primary hover:underline cursor-pointer">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Attach File"}
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileUpload} multiple />
          </label>
        </div>
      </div>

      {/* ── Sticky bottom bar ── */}
      <div className="sticky bottom-0 z-40 bg-background border-t px-4 py-3 flex items-center justify-end gap-3">
        <Button variant="outline" onClick={() => saveQuote("draft")} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Save Draft
        </Button>
        <Button
          variant="outline"
          onClick={() => saveQuote("accepted")}
          disabled={loading}
          className="text-green-700 border-green-300 hover:bg-green-50"
        >
          Mark Approved
        </Button>
        <Button
          style={{ backgroundColor: "#0077B6" }}
          className="text-white"
          onClick={() => saveQuote("sent")}
          disabled={loading}
        >
          Send Quote
        </Button>
      </div>
    </div>
  );
};

export default QuoteBuilder;
