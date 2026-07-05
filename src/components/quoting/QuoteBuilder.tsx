import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload, FileDown, Send, BookOpen, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useProductOptions, type ProductOption } from "@/hooks/useProductOptions";
import ProductSearchDropdown from "@/components/shared/ProductSearchDropdown";
import { useQuoteSessionStore } from "@/stores/quoteSessionStore";
import { useUnsavedQuoteGuard } from "@/hooks/useUnsavedQuoteGuard";
import UnsavedQuoteDialog from "@/components/shared/UnsavedQuoteDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import BeCoolLogo from "@/components/shared/BeCoolLogo";
import DocumentHeader from "@/components/shared/DocumentHeader";
import { generateDocumentPdf } from "@/lib/documentPdf";
import { DEFAULT_TERMS, TERMS_BLOCKS } from "@/lib/defaultTerms";
import LocationSelector from "@/components/locations/LocationSelector";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";

/* ────────── Types ────────── */

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  markup?: number;
  amount: number;
  service_id?: string | null;
  product_id?: string | null;
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
  customerId?: string | null;
  templateId?: string | null;
  initialQuoteName?: string | null;
  onBack: () => void;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

/* ────────── Ghost input ────────── */

const GhostInput = ({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) => {
  const displayValue = props.type === "date"
    ? String(props.value || "").replace(/-/g, "/")
    : String(props.value ?? "");
  return (
    <div className="relative">
      <input
        {...props}
        className={cn(
          "w-full bg-transparent border border-transparent rounded px-2 py-1.5 text-sm outline-none transition-colors",
          "hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/30",
          "placeholder:text-muted-foreground/50",
          className
        )}
      />
      <span data-pdf-static className={cn("hidden px-2 py-1.5 text-sm whitespace-nowrap", className)}>
        {displayValue}
      </span>
    </div>
  );
};

/* ────────── Main Component ────────── */

const QuoteBuilder = ({ quoteId, leadId, customerId, templateId, initialQuoteName, onBack }: QuoteBuilderProps) => {
  const { session, user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { settings: companySettings } = useCompanySettings();
  const allOptions = useProductOptions();

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const { companyId } = useUserCompanyId();
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
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [selectedLocationLabel, setSelectedLocationLabel] = useState<string>("");
  const [locationLat, setLocationLat] = useState<number | null>(null);
  const [locationLng, setLocationLng] = useState<number | null>(null);

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
  const [terms, setTerms] = useState(() => {
    // Load default terms
    return DEFAULT_TERMS;
  });

  // Attachments
  const [attachments, setAttachments] = useState<{ name: string; url: string; path: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Brochures
  const [selectedBrochures, setSelectedBrochures] = useState<{ id: string; name: string; file_url: string }[]>([]);
  const [availableBrochures, setAvailableBrochures] = useState<{ id: string; name: string; file_url: string; brand: string | null }[]>([]);
  const [showBrochurePicker, setShowBrochurePicker] = useState(false);
  const [brochureSearch, setBrochureSearch] = useState("");

  /* ─── Zustand store ─── */
  const { isDirty, setDraft, setDirty, clearDraft } = useQuoteSessionStore();

  // Mark dirty on any field change
  const markDirty = useCallback(() => {
    setDraft({
      clientId: selectedCustomerId,
      clientName: customerName,
      lineItems,
      issueDate,
      dueDate: validUntil,
      notes,
      terms,
      leadId: selectedLeadId,
      discountType,
      discountValue,
      showDiscount,
      reference,
      clientEmail: customerEmail,
      clientPhone: customerPhone,
      clientAddress: customerAddress,
    });
  }, [selectedCustomerId, customerName, lineItems, issueDate, validUntil, notes, terms, selectedLeadId, discountType, discountValue, showDiscount, reference, customerEmail, customerPhone, customerAddress, setDraft]);

  // Track changes
  useEffect(() => {
    // Only mark dirty after initial load (not on mount)
    if (lineItems.some((i) => i.description || i.amount > 0) || customerName) {
      markDirty();
    }
  }, [lineItems, customerName, notes, terms, reference, selectedLeadId, discountValue]);

  /* ─── Derived: canSave ─── */
  const canSave = !!selectedCustomerId;

  /* ─── Exit guard ─── */
  const handleSaveDraft = useCallback(async () => {
    if (!user?.id) return;
    if (!canSave) return;
    await saveQuote("draft");
    if (!mountedRef.current) return;
    clearDraft();
    onBack();
  }, [canSave, clearDraft, onBack, user?.id]);

  const handleSendQuote = useCallback(async () => {
    if (!user?.id) return;
    if (!canSave) return;
    await saveQuote("sent");
    if (!mountedRef.current) return;
    clearDraft();
    onBack();
  }, [canSave, clearDraft, onBack, user?.id]);

  const handleDeleteQuote = useCallback(async () => {
    if (savedQuoteId) {
      await supabase.from("quotes").delete().eq("id", savedQuoteId);
    }
    if (!mountedRef.current) return;
    clearDraft();
    onBack();
  }, [savedQuoteId, clearDraft, onBack]);

  const handleExit = useCallback(() => {
    clearDraft();
    onBack();
  }, [clearDraft, onBack]);

  const exitGuard = useUnsavedQuoteGuard({
    isDirty,
    canSave,
    onSaveDraft: handleSaveDraft,
    onSendQuote: handleSendQuote,
    onDeleteQuote: handleDeleteQuote,
    onExit: handleExit,
  });

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
    // Available brochures
    supabase
      .from("product_brochures" as any)
      .select("id, name, file_url, brand")
      .eq("is_active", true)
      .order("sort_order")
      .then(({ data }: any) => {
        if (data) setAvailableBrochures(data);
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

      // Load linked location (if any)
      const linkedLocId = (quote as any).location_id;
      if (linkedLocId) {
        const { data: loc } = await (supabase as any)
          .from("customer_locations")
          .select("id,label,address,latitude,longitude")
          .eq("id", linkedLocId)
          .maybeSingle();
        if (loc) {
          setSelectedLocationId(loc.id);
          setSelectedLocationLabel(loc.label);
          setLocationLat(loc.latitude != null ? Number(loc.latitude) : null);
          setLocationLng(loc.longitude != null ? Number(loc.longitude) : null);
        }
      }

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
      // Load saved brochures
      const { data: savedBrochures } = await (supabase.from("quote_brochures") as any)
        .select("brochure_id, sort_order")
        .eq("quote_id", quoteId)
        .order("sort_order");
      if (savedBrochures?.length) {
        const { data: brochureDetails } = await (supabase.from("product_brochures") as any)
          .select("id, name, file_url")
          .in("id", savedBrochures.map((sb: any) => sb.brochure_id));
        if (brochureDetails) {
          // Preserve sort order
          const orderMap = new Map(savedBrochures.map((sb: any) => [sb.brochure_id, sb.sort_order]));
          setSelectedBrochures(
            brochureDetails
              .map((b: any) => ({ id: b.id, name: b.name, file_url: b.file_url }))
              .sort((a: any, b: any) => ((orderMap.get(a.id) as number) || 0) - ((orderMap.get(b.id) as number) || 0))
          );
        }
      }
      // After loading, mark clean
      setDirty(false);
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

  // Pre-populate customer from customerId (when opening from Customer detail)
  useEffect(() => {
    if (!customerId || quoteId || leadId) return;
    setSelectedCustomerId(customerId);
  }, [customerId, quoteId, leadId]);

  // Prefill reference from initialQuoteName
  useEffect(() => {
    if (quoteId) return;
    if (initialQuoteName && !reference) setReference(initialQuoteName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuoteName, quoteId]);

  // Pre-populate line items / terms / notes from a template
  useEffect(() => {
    if (!templateId || quoteId) return;
    let cancelled = false;
    (async () => {
      const { data: template } = await supabase
        .from("quote_templates")
        .select("*")
        .eq("id", templateId)
        .maybeSingle();
      if (cancelled || !template) return;

      // Line items – prefer new jsonb column, fall back to legacy table
      let items: any[] = [];
      const tItems = (template as any).line_items;
      if (Array.isArray(tItems) && tItems.length > 0) {
        items = tItems;
      } else {
        const { data: legacy } = await supabase
          .from("quote_template_items")
          .select("*")
          .eq("template_id", templateId);
        items = legacy || [];
      }

      if (items.length > 0 && !cancelled) {
        setLineItems(
          items.map((it: any) => {
            const quantity = Number(it.quantity) || 1;
            const rate = Number(it.unit_price) || 0;
            return {
              service_id: it.service_id || null,
              description: it.description || "",
              quantity,
              rate,
              markup: 0,
              amount: quantity * rate,
            };
          })
        );
      }

      // Terms & notes
      const tTerms = (template as any).terms_text;
      if (tTerms && !cancelled) setTerms(tTerms);
      const tNotes = (template as any).notes;
      if (tNotes && !cancelled) setNotes(tNotes);

      // Use template name as reference if none set yet
      if (!cancelled && !reference && !initialQuoteName && (template as any).name) {
        setReference((template as any).name);
      }

      if (!cancelled) {
        toast({ title: `Template loaded: ${(template as any).name || ""}` });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId, quoteId]);

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
    if (templateId) return; // template supplies its own terms
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
  }, [companySettings, quoteId, templateId]);

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
      product_id: opt.source === "product" ? opt.id : null,
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
    if (!user?.id) {
      toast({ title: "Not authenticated", description: "Please sign in again.", variant: "destructive" });
      return;
    }
    if (!selectedCustomerId) {
      toast({ title: "Client Required", description: "Please assign a client before saving this quote.", variant: "destructive" });
      throw new Error("A client must be associated with the quote before saving.");
    }
    if (lineItems.every((i) => !i.description || i.amount === 0)) {
      toast({ title: "Error", description: "Add at least one line item", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      if (!session) throw new Error("Not authenticated");

      // Quote number is now auto-assigned by DB trigger when customer_id is set
      // Only generate manually if updating an existing quote that already has a number
      let finalNumber = quoteNumber;
      if (!finalNumber || finalNumber === "Q-####") {
        // Will be auto-assigned by trigger, use a temp placeholder for display
        finalNumber = "Generating...";
      }

      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId(session?.user.id);
      const quotePayload: any = {
        customer_id: selectedCustomerId || null,
        sales_engineer_id: session.user.id,
        company_id,
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
        location_id: selectedLocationId || null,
        ...(status !== "draft" ? { status, sent_at: new Date().toISOString() } : {}),
      };

      let qId = savedQuoteId;

      if (qId) {
        const { error } = await supabase.from("quotes").update(quotePayload).eq("id", qId);
        if (error) throw error;
        await supabase.from("quote_line_items").delete().eq("quote_id", qId);
      } else {
        // Don't set quote_number on insert — trigger auto-assigns it when customer_id is set
        const { data, error } = await supabase.from("quotes").insert(quotePayload).select("id, quote_number").single();
        if (error) throw error;
        qId = data.id;
        setSavedQuoteId(qId);
        if (data.quote_number) setQuoteNumber(data.quote_number);
      }

      // Reload quote to get trigger-assigned quote_number
      if (qId) {
        const { data: refreshed } = await supabase.from("quotes").select("quote_number").eq("id", qId).single();
        if (refreshed?.quote_number) setQuoteNumber(refreshed.quote_number);
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

      // Save brochure selections
      if (qId) {
        await (supabase.from("quote_brochures") as any).delete().eq("quote_id", qId);
        if (selectedBrochures.length > 0) {
          await (supabase.from("quote_brochures") as any).insert(
            selectedBrochures.map((b, idx) => ({
              quote_id: qId!,
              brochure_id: b.id,
              sort_order: idx,
            }))
          );
        }
      }

      if (!mountedRef.current) return;
      clearDraft();
      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({
        title: status === "sent" ? "Quote Sent! 📧" : "Quote Saved! ✅",
        description: `${finalNumber} – ${formatCurrency(total)}`,
      });
      if (status === "sent") onBack();
    } catch (err: any) {
      console.error("Quote save error:", err);
      if (mountedRef.current) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    } finally {
      if (mountedRef.current) setLoading(false);
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

  const handleGeneratePdf = async () => {
    try {
      const brochureAttachments = selectedBrochures.map((brochure) => {
        let url = brochure.file_url;
        if (!url.startsWith("http")) {
          const { data } = supabase.storage.from("product-brochures").getPublicUrl(url);
          url = data.publicUrl;
        }
        return { id: brochure.id, name: brochure.name, file_url: url };
      });

      await generateDocumentPdf({
        docType: "Quote",
        docNumber: quoteNumber || "QUOTE",
        companyName: companySettings.company_name || "0800-BE-COOL!",
        logoUrl: logoUrl,
        customerName: customerName,
        customerEmail: customerEmail,
        issueDate,
        dueDate: validUntil,
        lineItems: lineItems.filter((i) => i.description.trim()).map((i) => ({
          description: i.description,
          quantity: i.quantity,
          rate: i.rate,
          markup: i.markup,
          amount: i.amount,
        })),
        subtotal: taxableAmount,
        taxRate,
        taxAmount,
        total,
        terms: terms || undefined,
        brochures: brochureAttachments.length > 0 ? brochureAttachments : undefined,
      });

      toast({ title: "PDF Downloaded" });
    } catch (err: any) {
      console.error("PDF generation error:", err);
      toast({ title: "PDF Error", description: err?.message || "PDF generation failed.", variant: "destructive" });
    }
  };

  /* ─── Render ─── */
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Exit guard modal */}
      <UnsavedQuoteDialog
        open={exitGuard.showModal}
        onContinue={exitGuard.confirmContinue}
        onSaveForLater={exitGuard.confirmSaveDraft}
        onDiscard={handleExit}
        onSendQuote={exitGuard.confirmSendQuote}
        onDeleteQuote={exitGuard.confirmDeleteQuote}
        canSave={canSave}
        canSend={canSave && lineItems.some(i => i.description && i.amount > 0)}
      />

      {/* ── Top bar ── */}
      <div data-pdf-hide className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">{quoteId ? "Edit Quote" : "New Quote"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exitGuard.requestExit}>
            Cancel
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveQuote("draft")}
                    disabled={loading || !canSave}
                  >
                    Save as Draft
                  </Button>
                </span>
              </TooltipTrigger>
              {!canSave && <TooltipContent>Assign a client to save this quote</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    className="text-white"
                    style={{ backgroundColor: "#0077B6" }}
                    onClick={() => saveQuote("sent")}
                    disabled={loading || !canSave}
                  >
                    {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Send To…
                  </Button>
                </span>
              </TooltipTrigger>
              {!canSave && <TooltipContent>Assign a client to save this quote</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Client-required warning banner ── */}
      {!canSave && (
        <div data-pdf-hide className="bg-destructive/10 border-b border-destructive/30 text-destructive px-4 py-2 text-sm flex items-center gap-2">
          <span className="font-semibold">Client required:</span>
          <span>Associate a client below before this quote can be saved or sent.</span>
        </div>
      )}

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-auto bg-slate-100">

      {/* ── A4 Card ── */}
      <div data-pdf-capture-root="quote" className="max-w-3xl mx-auto my-8 bg-white shadow-lg rounded-lg border p-8 md:p-12 space-y-8">
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
                  <button data-pdf-hide onClick={() => setShowCustomerPicker(true)} className="text-[11px] text-primary hover:underline mt-1">Change</button>
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
                      <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-accent text-sm transition-colors">
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

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date of Issue</p>
              <GhostInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quote Number</p>
              <p className="text-sm font-medium text-foreground px-2 py-1.5">
                {!selectedCustomerId
                  ? <span className="text-amber-600 text-xs">Pending – assign a client</span>
                  : quoteNumber || "Generating…"}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quoted Amount (ZAR)</p>
              <p className="text-[28px] font-bold px-2 py-0.5" style={{ color: "#0077B6" }}>{formatCurrency(total)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6" style={{ marginTop: "-12px" }}>
            <div />
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Valid Until</p>
              <GhostInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
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
            <div data-pdf-hide-markup className="text-right">Markup%</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 items-center py-1 group relative">
              <div className="relative">
                <ProductSearchDropdown value={item.description} allOptions={allOptions} onChange={(val) => updateLineItem(idx, "description", val)} onSelect={(opt) => pickOption(opt, idx)} />
                <span data-pdf-static className="hidden px-2 py-1.5 text-sm">{item.description || ""}</span>
              </div>
              <div><GhostInput type="number" min="0" step="0.01" className="text-right" value={item.rate || ""} onChange={(e) => updateLineItem(idx, "rate", e.target.value)} placeholder="0.00" /></div>
              <div><GhostInput type="number" min="0" step="1" className="text-right" value={item.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} placeholder="1" /></div>
              <div data-pdf-hide-markup><GhostInput type="number" min="0" step="1" className="text-right" value={item.markup || ""} onChange={(e) => updateLineItem(idx, "markup", e.target.value)} placeholder="0" /></div>
              <div className="text-right text-sm font-medium py-1.5 px-2">{formatCurrency(item.amount)}</div>
              <div className="flex justify-center">
                <button onClick={() => removeLineItem(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"><X className="h-4 w-4" /></button>
              </div>
            </div>
          ))}

          <button data-pdf-hide onClick={addLineItem} className="w-full text-left px-2 py-2.5 text-sm text-primary hover:bg-primary/5 rounded mt-1 flex items-center gap-1.5 transition-colors">
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
              <button data-pdf-hide onClick={() => setShowDiscount(true)} className="text-sm text-primary hover:underline">+ Add a Discount</button>
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
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── LINK TO JOB ── */}
        <div>
          <button data-pdf-hide className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowLinks(!showLinks)}>
            {showLinks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Link to Job
          </button>
          {showLinks && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead / Job</p>
                <select value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
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

        {/* ── TERMS (on-screen only; PDF appends styled T&C pages separately) ── */}
        <div data-pdf-hide className="space-y-3">
          
          <div className="space-y-2 text-sm leading-relaxed">
            {TERMS_BLOCKS.map((block, i) => {
              if (block.type === "spacer") return <div key={i} className="h-2" />;
              if (block.type === "title") return <p key={i} className="text-center font-bold text-base">{block.text}</p>;
              if (block.type === "heading") return <p key={i} className="font-semibold mt-2">{block.text}</p>;
              if (block.type === "banking") return <p key={i} className="font-medium">{block.text}</p>;
              return <p key={i}>{block.text}</p>;
            })}
          </div>
        </div>

        

        <div className="h-px bg-border" />

        {/* ── BROCHURES (PDF attachments) ── */}
        <div data-pdf-hide className="space-y-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-primary" /> Product Brochures
            </p>
            <span className="text-[10px] text-muted-foreground">
              {selectedBrochures.length} selected — will be appended to PDF
            </span>
          </div>

          {/* Selected brochures */}
          {selectedBrochures.length > 0 && (
            <div className="space-y-1">
              {selectedBrochures.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-md border bg-white px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {b.name}
                  </span>
                  <button
                    onClick={() => setSelectedBrochures((prev) => prev.filter((x) => x.id !== b.id))}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add brochure picker */}
          {!showBrochurePicker ? (
            <button
              onClick={() => setShowBrochurePicker(true)}
              className="text-sm text-primary hover:underline flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add Brochure
            </button>
          ) : (
            <div className="space-y-2 border rounded-md p-3 bg-white">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  placeholder="Search brochures…"
                  value={brochureSearch}
                  onChange={(e) => setBrochureSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {availableBrochures
                  .filter((b) => {
                    const q = brochureSearch.toLowerCase();
                    return !selectedBrochures.some((s) => s.id === b.id) &&
                      (!q || b.name.toLowerCase().includes(q) || (b.brand || "").toLowerCase().includes(q));
                  })
                  .map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setSelectedBrochures((prev) => [...prev, { id: b.id, name: b.name, file_url: b.file_url }]);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-accent text-sm transition-colors rounded flex items-center justify-between"
                    >
                      <span>{b.name}</span>
                      {b.brand && <span className="text-[10px] text-muted-foreground">{b.brand}</span>}
                    </button>
                  ))}
              </div>
              <button
                onClick={() => { setShowBrochurePicker(false); setBrochureSearch(""); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Done
              </button>
            </div>
          )}
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
      </div>{/* end scrollable content area */}

      {/* ── Bottom action bar — outside scroll container ── */}
      <div data-pdf-hide className="shrink-0 z-40 bg-background border-t px-4 py-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" type="button" onClick={handleGeneratePdf}>
          <FileDown className="h-4 w-4 mr-1" />PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast({ title: "Email placeholder", description: "Email sending will be connected soon." })} disabled={!canSave}>
          <Send className="h-4 w-4 mr-1" />Send
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveQuote("accepted")} disabled={loading || !canSave}>
          Mark Approved
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveQuote("draft")} disabled={loading || !canSave}>
          Save Draft
        </Button>
        <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveQuote("sent")} disabled={loading || !canSave}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Send Quote
        </Button>
      </div>
    </div>
  );
};

export default QuoteBuilder;
