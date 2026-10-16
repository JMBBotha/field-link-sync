import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload } from "lucide-react";
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
import StickyActionBar from "@/components/shared/StickyActionBar";
import { blockR0 } from "@/lib/zeroPriceGuard";
import { useInvoiceAutofill, type AutofillFlag } from "@/hooks/useInvoiceAutofill";
import {
  fetchCompanyProfiles, invoiceTotals, depositAmount as calcDeposit, depositDue, profileBanking, fillTermsPlaceholders,
  type CompanyProfile, type DepositType, VAT_PERCENT,
} from "@/lib/companyProfiles";

/* ────────── Types ────────── */

interface LineItem {
  description: string;
  quantity: number;
  rate: number;
  markup?: number;
  amount: number;
  service_id?: string | null;
  /** Short name printed in bold on the invoice (optional). */
  line_name?: string;
  room_label?: string;
  line_type?: "item" | "unit" | "installation" | "labour" | "deposit" | "other";
  /** Editor-only marker (never saved): tech-sourced line to check, or a deposit credit. */
  flag?: AutofillFlag;
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
  /** Open an existing DRAFT invoice for editing (sent invoices are locked). */
  editInvoiceId?: string | null;
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
  editInvoiceId,
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

  // Tax: 15% on every line (enforced in the database too)
  const taxRate = VAT_PERCENT;

  // Issuing company (Massair CT / Massair Ind CC …)
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [profileId, setProfileId] = useState<string | null>(null);
  const profile = profiles.find((p) => p.id === profileId) || null;

  // Client VAT number (printed under Billed To; saved back to the client record)
  const [clientVat, setClientVat] = useState("");

  // Deposit request (% of the VAT-inclusive total, or a fixed amount)
  const [depositType, setDepositType] = useState<DepositType | null>(null);
  const [depositValue, setDepositValue] = useState(0);

  // Editing an existing draft
  const [editLoaded, setEditLoaded] = useState(!editInvoiceId);
  const [editLeadId, setEditLeadId] = useState<string | null>(null);

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
  const totals = invoiceTotals(lineItems.map((i) => i.amount), showDiscount && discountValue > 0 ? { type: discountType, value: discountValue } : null);
  const subtotal = totals.subtotal;
  const discountAmount = totals.discountAmount;
  const taxAmount = totals.vat;
  const grandTotal = totals.total;
  const amountDue = grandTotal - amountPaid;
  const depositRequested = calcDeposit(grandTotal, depositType, depositValue);
  const depositOutstanding = depositDue(depositRequested, amountPaid);

  /* ─── Fetch data ─── */
  useEffect(() => {
    // Invoice number is given on save, from the chosen company's own series (no numbers wasted on open).
    fetchCompanyProfiles().then((list) => {
      setProfiles(list);
      setProfileId((prev) => prev || list.find((p) => p.is_default)?.id || list[0]?.id || null);
    });
    supabase
      .from("customers")
      .select("id, name, email, phone, address")
      .or("status.is.null,status.neq.archived")
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
      .select("email, name, phone, address, vat_number")
      .eq("id", cid)
      .single()
      .then(({ data }) => {
        if (data) {
          if ((data as any).vat_number) setClientVat((prev) => prev || (data as any).vat_number);
          if (data.email) setCustomerEmail(data.email);
          if (!customerName && data.name) setCustomerName(data.name);
          if (!customerPhone && data.phone) setCustomerPhone(data.phone);
          if (!customerAddress && data.address) setCustomerAddress(data.address || "");
        }
      });
  }, [selectedCustomerId]);

  // Autofill from the job: quote lines, deposit credit, tech extras (sell price), labour overrun, notes.
  const [quoteChoice, setQuoteChoice] = useState<string | null>(null);
  const [autoQuoteId, setAutoQuoteId] = useState<string | null>(null);
  const autofill = useInvoiceAutofill(prefillLead?.id || prefillFromLead?.id, quoteChoice, allOptions, companySettings.default_hourly_rate);
  const appliedKey = useRef<string | null>(null);
  const autoNotes = useRef("");
  useEffect(() => {
    if (!autofill || appliedKey.current === autofill.key) return;
    appliedKey.current = autofill.key;
    setAutoQuoteId(autofill.quoteId);
    if (autofill.customerId) setSelectedCustomerId((prev) => prev || autofill.customerId);
    if (autofill.lines.length) {
      setLineItems((prev) => {
        const keep = autofill.quoteId ? [] : prev.filter((i) => i.description && !i.flag);
        return [...keep, ...autofill.lines];
      });
    }
    const lastAuto = autoNotes.current;
    autoNotes.current = autofill.notes;
    setNotes((prev) => (!prev.trim() || prev === lastAuto ? autofill.notes : prev));
  }, [autofill]);

  // Load an existing draft for editing
  useEffect(() => {
    if (!editInvoiceId) return;
    (async () => {
      const [{ data: inv }, { data: items }] = await Promise.all([
        supabase.from("invoices").select("*").eq("id", editInvoiceId).single(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        supabase.from("invoice_items").select("*").eq("invoice_id", editInvoiceId).order("sort_order" as any).order("created_at"),
      ]);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const i = inv as any;
      if (!i) { toast({ title: "Invoice not found", variant: "destructive" }); onBack(); return; }
      if (i.status !== "draft") { toast({ title: "This invoice is locked", description: "Sent invoices can't be edited. Duplicate it instead.", variant: "destructive" }); onBack(); return; }
      setInvoiceNumber(i.invoice_number);
      setSelectedCustomerId(i.customer_id);
      setCustomerName(i.customer_name || "");
      setCustomerPhone(i.customer_phone || "");
      setCustomerAddress(i.customer_address || "");
      setCustomerEmail(i.customer_email || "");
      setClientVat(i.billed_to_vat_number || "");
      if (i.issue_date) setIssueDate(i.issue_date);
      if (i.due_date) setDueDate(i.due_date);
      setNotes(i.notes || "");
      setLeadId(i.lead_id || "");
      setEditLeadId(i.lead_id || null);
      setAutoQuoteId(i.quote_id || null);
      if (i.company_profile_id) setProfileId(i.company_profile_id);
      if (i.discount_type && Number(i.discount_value) > 0) { setShowDiscount(true); setDiscountType(i.discount_type); setDiscountValue(Number(i.discount_value)); }
      if (i.deposit_type) { setDepositType(i.deposit_type); setDepositValue(Number(i.deposit_value) || 0); }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const src: any[] = (items && items.length ? items : (i.line_items || []));
      setLineItems(src.length ? src.map((r) => ({
        description: r.description || "",
        quantity: Number(r.quantity) || 1,
        rate: Number(r.unit_price ?? r.rate) || 0,
        markup: 0,
        amount: Number(r.amount) || 0,
        service_id: r.service_id || null,
        line_name: r.line_name || "",
        room_label: r.room_label || "",
        line_type: r.line_type || "item",
        ...(Number(r.amount) < 0 ? { flag: "credit" as AutofillFlag } : {}),
      })) : [{ description: "", quantity: 1, rate: 0, amount: 0 }]);
      appliedKey.current = "edit"; // don't let job autofill overwrite saved lines
      setEditLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editInvoiceId]);

  // Terms: the chosen company's own terms (if set) or its banking details
  useEffect(() => {
    const parts: string[] = [];
    if (profile) {
      if (profile.terms_text) { setTerms(fillTermsPlaceholders(profile.terms_text, profile)); return; }
      const pb = profileBanking(profile)!;
      parts.push("Banking Details:");
      if (pb.bank_name) parts.push(`Bank: ${pb.bank_name}`);
      if (pb.account_name) parts.push(`Account name: ${pb.account_name}`);
      if (pb.account_number) parts.push(`Account: ${pb.account_number}`);
      if (pb.branch_code) parts.push(`Branch: ${pb.branch_code}`);
      if (pb.account_type) parts.push(`Type: ${pb.account_type}`);
      setTerms(parts.join("\n"));
      return;
    }
    const b = companySettings.banking_details;
    if (b && (b.bank_name || b.account_number)) {
      parts.push("Banking Details:");
      if (b.bank_name) parts.push(`Bank: ${b.bank_name}`);
      if (b.account_number) parts.push(`Account: ${b.account_number}`);
      if (b.branch_code) parts.push(`Branch: ${b.branch_code}`);
      if (b.account_type) parts.push(`Type: ${b.account_type}`);
    }
    setTerms(parts.join("\n"));
  }, [companySettings, profile]);

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
    if (field === "line_name" || field === "room_label") {
      item[field] = value as string;
    } else if (field === "line_type") {
      item.line_type = value as LineItem["line_type"];
    } else if (field === "description") {
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
    if (item.flag === "credit") item.amount = -Math.abs(item.amount);
    items[index] = item;
    setLineItems(items);
  };

  const pickOption = (opt: ProductOption, index: number) => {
    const items = [...lineItems];
    items[index] = {
      ...items[index],
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
  /** Separate installation line for a room (FreshBooks style: unit line + installation line per room). */
  const addInstallLine = (room?: string) => setLineItems([...lineItems, {
    description: "Installation", line_name: "Installation", room_label: room || "", line_type: "installation",
    quantity: 1, rate: 0, markup: 0, amount: 0,
  }]);
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
        const { data: signed, error: signErr } = await supabase.storage
          .from("invoice-attachments")
          .createSignedUrl(path, 60 * 60 * 24 * 365);
        if (signErr) throw signErr;
        setAttachments((prev) => [...prev, { name: file.name, url: signed.signedUrl }]);
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
    if (!editLoaded) return;
    if (blockR0(lineItems, toast)) return;
    if (!customerName.trim()) {
      toast({ title: "Error", description: "Please select or enter a client", variant: "destructive" });
      return;
    }
    if (lineItems.every((i) => !i.description || i.amount === 0)) {
      toast({ title: "Error", description: "Add at least one line item", variant: "destructive" });
      return;
    }
    if (subtotal < 0) {
      toast({ title: "Error", description: "The deposit credit is more than the invoice lines", variant: "destructive" });
      return;
    }
    if (depositType && (depositValue <= 0 || (depositType === "percent" ? depositValue > 100 : depositValue > grandTotal))) {
      toast({ title: "Check the deposit", description: depositType === "percent" ? "Deposit % must be between 1 and 100" : "Deposit can't be more than the total", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId(user?.id);

      let finalLeadId = leadId || editLeadId || "";
      if (!finalLeadId) {
        const { data: newLead, error: leadError } = await supabase
          .from("leads")
          .insert({
            customer_name: customerName,
            customer_phone: customerPhone || "N/A",
            customer_address: customerAddress || "N/A",
            service_type: lineItems[0]?.line_name || lineItems[0]?.description || "Invoice",
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

      // Client-facing lines: unit price is the SELL price (cost × markup); cost/markup never saved.
      const validItems = lineItems
        .filter((i) => i.description && (i.amount > 0 || (i.flag === "credit" && i.amount < 0)))
        .map((i) => ({
          description: i.description,
          line_name: i.line_name?.trim() || null,
          room_label: i.room_label?.trim() || null,
          line_type: i.flag === "credit" ? "deposit" : (i.line_type || "item"),
          quantity: i.quantity,
          rate: Math.round(i.rate * (1 + (i.markup || 0) / 100) * 100) / 100,
          amount: Math.round(i.amount * 100) / 100,
          service_id: i.service_id || null,
        }));

      const vat = clientVat.trim() || null;
      const header = {
        lead_id: finalLeadId,
        quote_id: autoQuoteId,
        customer_name: customerName,
        customer_phone: customerPhone || null,
        customer_address: customerAddress || null,
        customer_email: customerEmail || null,
        customer_id: selectedCustomerId || null,
        billed_to_vat_number: vat,
        company_profile_id: profileId,
        line_items: validItems,
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        discount_type: discountAmount > 0 ? discountType : null,
        discount_value: discountAmount > 0 ? discountValue : null,
        discount_amount: discountAmount,
        deposit_type: depositType,
        deposit_value: depositType ? depositValue : null,
        notes: notes || null,
        due_date: dueDate || null,
        issue_date: issueDate,
      };

      // Always write as DRAFT first (lines can only change on a draft), then send/mark paid as a last, explicit step.
      let invoiceId = editInvoiceId || null;
      let finalNumber = invoiceNumber;
      if (invoiceId) {
        const { error } = await supabase.from("invoices").update({ ...header, updated_at: new Date().toISOString() } as any).eq("id", invoiceId);
        if (error) throw error;
        const { error: delErr } = await supabase.from("invoice_items").delete().eq("invoice_id", invoiceId);
        if (delErr) throw delErr;
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: num, error: numErr } = await (supabase.rpc as any)("next_invoice_number", { p_profile: profileId });
        if (numErr) throw numErr;
        finalNumber = num as string;
        setInvoiceNumber(finalNumber);
        const { data: inserted, error } = await supabase
          .from("invoices")
          .insert({ ...header, invoice_number: finalNumber, agent_id: agentId, company_id, payment_method: null, status: "draft" } as any)
          .select("id")
          .single();
        if (error) throw error;
        invoiceId = inserted.id;
      }

      if (validItems.length > 0) {
        const { error: itemsErr } = await supabase.from("invoice_items").insert(
          validItems.map((i, idx) => ({
            invoice_id: invoiceId,
            service_id: i.service_id || null,
            description: i.description,
            line_name: i.line_name,
            room_label: i.room_label,
            line_type: i.line_type,
            sort_order: idx,
            vat_rate: VAT_PERCENT,
            quantity: i.quantity,
            unit_price: i.rate, // sell price (see validItems)
            amount: i.amount,
          })) as any
        );
        if (itemsErr) throw itemsErr;
      }

      // Client record keeps its VAT number (shown under Billed To next time)
      if (selectedCustomerId && vat) {
        await supabase.from("customers").update({ vat_number: vat } as any).eq("id", selectedCustomerId);
      }

      if (status !== "draft") {
        // Explicit click only. The client notification below is the one message (same as before).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: stErr } = await (supabase.rpc as any)("finalise_new_invoice", { p_invoice: invoiceId, p_status: status });
        if (stErr) throw stErr;
      }

      // Notification
      if (selectedCustomerId && status !== "draft" && invoiceId) {
        try {
          await notifyInvoiceSent(selectedCustomerId, invoiceId, finalNumber, formatCurrency(grandTotal));
        } catch (e) {
          console.error("[Notification] Error:", e);
        }
      }

      clearDraft();
      toast({
        title: editInvoiceId ? "Invoice saved" : "Invoice Created! 💰",
        description: `${finalNumber} – ${status === "paid" ? "Paid" : status === "sent" ? "Sent" : "Draft"}`,
      });
      onSuccess();
    } catch (error: any) {
      console.error("Invoice save error:", error);
      toast({ title: "Error", description: error.message || "Failed to save invoice", variant: "destructive" });
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
    <div className="min-h-screen bg-muted/40 pb-28 lg:pb-24 overflow-x-clip">
      <UnsavedQuoteDialog
        open={exitGuard.showModal}
        onContinue={exitGuard.confirmContinue}
        onSaveForLater={exitGuard.confirmSaveForLater}
        onDiscard={exitGuard.confirmDiscard}
      />

      {/* ── Top bar ── */}
      <div className="sticky top-0 z-40 bg-background border-b px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
        <h1 className="text-base sm:text-lg font-bold text-foreground whitespace-nowrap">{editInvoiceId ? "Edit Draft Invoice" : "New Invoice"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exitGuard.requestExit}>
            Cancel
          </Button>
          <Button variant="outline" size="sm" className="hidden lg:inline-flex" onClick={() => saveInvoice("draft")} disabled={loading || !editLoaded}>
            Save Draft
          </Button>
          <Button size="sm" className="hidden lg:inline-flex text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveInvoice("sent")} disabled={loading || !editLoaded}>
            {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Send To…
          </Button>
        </div>
      </div>

      {/* ── A4 Card ── */}
      <div data-pdf-capture-root="invoice" className="max-w-3xl mx-auto my-3 sm:my-8 bg-white shadow-lg rounded-lg border p-4 sm:p-8 md:p-12 space-y-8 text-slate-900 [&_.text-foreground]:!text-slate-900 [&_.text-muted-foreground]:!text-slate-500 [&_input]:!text-slate-900 [&_textarea]:!text-slate-900 [&_select]:!text-slate-900 [&_input::placeholder]:!text-slate-400 [&_textarea::placeholder]:!text-slate-400">
        {/* ── HEADER ROW ── */}
        <DocumentHeader
          logoUrl={logoUrl}
          companyName={companySettings.company_name}
          physicalAddress={companySettings.physical_address}
          vatNumber={companySettings.vat_number}
          profile={profile}
        />

        {/* ── ISSUING COMPANY ── */}
        {profiles.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-sm print:hidden" data-html2canvas-ignore>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Invoice from</span>
            <select
              value={profileId || ""}
              onChange={(e) => setProfileId(e.target.value)}
              disabled={!!editInvoiceId}
              className="border rounded px-2 py-1 text-sm bg-background"
              data-testid="company-profile-picker"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.legal_name}{p.vat_number ? "" : " (no VAT no.)"}</option>
              ))}
            </select>
            {editInvoiceId && <span className="text-[11px] text-muted-foreground">To change company, duplicate the invoice.</span>}
          </div>
        )}

        {/* ── BILLED TO + DATES ROW ── */}
        <div className="space-y-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
            <div className="col-span-1 space-y-1 relative">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billed To</p>
              {customerName && !showCustomerPicker ? (
                <div>
                  <p className="text-sm font-semibold text-foreground">{customerName}</p>
                  {customerAddress && <p className="text-xs text-muted-foreground">{customerAddress}</p>}
                  {customerEmail && <p className="text-xs text-muted-foreground">{customerEmail}</p>}
                  <GhostInput placeholder="Client VAT No (optional)" value={clientVat} onChange={(e) => setClientVat(e.target.value)} className="!px-0 text-xs" data-testid="client-vat-input" />
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
              <p className="text-sm font-medium text-foreground px-2 py-1.5">{invoiceNumber || (profile ? `${profile.invoice_prefix}… (given on save)` : "Given on save")}</p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Amount Due (ZAR)</p>
              <p className="text-xl sm:text-[28px] font-bold px-2 py-0.5 whitespace-nowrap" style={{ color: "#0077B6" }}>{formatCurrency(amountDue)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6 md:-mt-3">
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
          {!autoQuoteId && !!autofill?.suggestions.length && (
            <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 space-y-1">
              <p>No quote is linked to this job. This client has:</p>
              <div className="flex flex-wrap gap-1.5">
                {autofill.suggestions.map((q) => (
                  <button key={q.id} type="button" onClick={() => setQuoteChoice(q.id)} className="rounded border border-amber-400 bg-white px-2 py-0.5 hover:bg-amber-100">
                    {q.quote_number || "Quote"} {formatCurrency(q.total)} ({q.status}) – use
                  </button>
                ))}
              </div>
            </div>
          )}
          {lineItems.some((i) => i.flag === "tech") && (
            <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
              Lines marked "From tech – check" came from the technician. Check they aren't already in the quote lines and that the price is right.
            </p>
          )}
          <div className="grid grid-cols-[repeat(4,minmax(0,1fr))_24px] sm:grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2 mb-1">
            <div className="hidden sm:block">Description</div>
            <div className="text-right">Cost</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Markup%</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-[repeat(4,minmax(0,1fr))_24px] sm:grid-cols-[1fr_80px_50px_60px_80px_30px] gap-x-2 gap-y-1 items-center py-1 group relative border-b sm:border-0 pb-2 sm:pb-1">
              <div className="relative col-span-5 sm:col-span-1 min-w-0">
                <ProductSearchDropdown
                  value={item.description}
                  allOptions={allOptions}
                  onChange={(val) => updateLineItem(idx, "description", val)}
                  onSelect={(opt) => pickOption(opt, idx)}
                />
                {item.flag && (
                  <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800">
                    {item.flag === "tech" ? "From tech – check" : "Deposit credit"}
                  </span>
                )}
                <div className="mt-1 flex gap-1">
                  <GhostInput placeholder="Line name" value={item.line_name || ""} onChange={(e) => updateLineItem(idx, "line_name", e.target.value)} className="!py-0.5 text-xs" />
                  <GhostInput placeholder="Room / area" value={item.room_label || ""} onChange={(e) => updateLineItem(idx, "room_label", e.target.value)} className="!py-0.5 text-xs w-28" />
                  <select value={item.line_type || "item"} onChange={(e) => updateLineItem(idx, "line_type", e.target.value)} className="text-[11px] border rounded px-1 bg-background">
                    <option value="item">Item</option>
                    <option value="unit">Unit</option>
                    <option value="installation">Installation</option>
                    <option value="labour">Labour</option>
                    <option value="other">Other</option>
                  </select>
                </div>
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
              <div className="text-right text-xs sm:text-sm font-medium py-1.5 px-1 sm:px-2 whitespace-nowrap">{formatCurrency(item.amount)}</div>
              <div className="flex justify-center">
                <button onClick={() => removeLineItem(idx)} className="sm:opacity-0 sm:group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <button onClick={addLineItem} className="w-full text-left px-2 py-2.5 text-sm text-primary hover:bg-primary/5 rounded mt-1 flex items-center gap-1.5 transition-colors">
            <Plus className="h-4 w-4" /> Add a Line
          </button>
          <button onClick={() => addInstallLine([...lineItems].reverse().find((i) => i.room_label)?.room_label)} className="w-full text-left px-2 py-1.5 text-sm text-primary hover:bg-primary/5 rounded flex items-center gap-1.5 transition-colors">
            <Plus className="h-4 w-4" /> Add an Installation line (per room)
          </button>
          <p className="px-2 text-[11px] text-muted-foreground">Every line carries {VAT_PERCENT}% VAT.</p>
        </div>

        <div className="h-px bg-border" />

        {/* ── TOTALS ── */}
        <div className="flex justify-end">
          <div className="w-full sm:w-72 space-y-2">
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
            {!depositType ? (
              <button onClick={() => { setDepositType("percent"); setDepositValue(50); }} className="text-sm text-primary hover:underline" data-testid="request-deposit">+ Request a Deposit</button>
            ) : (
              <div className="space-y-1 rounded border border-amber-300 bg-amber-50 p-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Deposit</span>
                  <select value={depositType} onChange={(e) => setDepositType(e.target.value as DepositType)} className="text-xs border rounded px-1.5 py-1 bg-background">
                    <option value="percent">% of total incl. VAT</option>
                    <option value="fixed">ZAR</option>
                  </select>
                  <GhostInput type="number" min="0" className="w-20 text-right" value={depositValue || ""} onChange={(e) => setDepositValue(Number(e.target.value) || 0)} />
                  <button onClick={() => { setDepositType(null); setDepositValue(0); }} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                </div>
                <div className="flex justify-between text-sm"><span>Deposit Requested</span><span>{formatCurrency(depositRequested)}</span></div>
                <div className="flex justify-between text-sm font-bold"><span>Deposit Due</span><span>{formatCurrency(depositOutstanding)}</span></div>
              </div>
            )}
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
      <StickyActionBar className="mx-0 px-3 sm:px-4 gap-1.5 sm:gap-2 [&>button]:px-2 sm:[&>button]:px-3">
        <Button variant="outline" size="sm" onClick={() => saveInvoice("paid")} disabled={loading || !editLoaded}>
          Mark Paid
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveInvoice("draft")} disabled={loading || !editLoaded}>
          Save Draft
        </Button>
        <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveInvoice("sent")} disabled={loading || !editLoaded}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Send Invoice
        </Button>
      </StickyActionBar>
    </div>
  );
};

export default CreateInvoicePage;
