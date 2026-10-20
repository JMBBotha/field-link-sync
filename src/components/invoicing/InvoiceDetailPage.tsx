import { useState, useEffect, useRef } from "react";
import { MarkSentManuallyButton, SentManuallyBadge } from "@/components/documents/MarkSentManually";
import { ArrowLeft, Loader2, Send, CheckCircle, Printer, Download, Share2, Phone, Mail, MapPin, MessageCircle, Copy, Pencil, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import SendInvoiceEmailButton from "@/components/invoicing/SendInvoiceEmailButton";
import { generateAndUploadPDF, downloadInvoicePDF, printInvoicePDF, shareInvoice, sendViaWhatsApp } from "@/lib/invoicePDF";
import { sumSettled } from "@/lib/payments";
import PaymentRecorder from "@/components/invoicing/PaymentRecorder";
import CreditNotesPanel from "@/components/invoicing/CreditNotesPanel";
import PurchaseOrdersPanel from "@/components/invoicing/PurchaseOrdersPanel";
import { creditedByInvoice, fetchCreditNotes, type CreditNoteRow } from "@/lib/creditNotes";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";
import CreateInvoicePage from "@/components/invoicing/CreateInvoicePage";
import { useAuth } from "@/contexts/AuthContext";
import { documentProfile, fetchCompanyProfiles, profileTermsInfo, type CompanyProfile } from "@/lib/companyProfiles";


import HelpTip from "@/components/help/HelpTip";
import DocumentStyleSwitch from "@/components/quoting/DocumentStyleSwitch";
import { formatRand } from "@/utils/formatRand";

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  rate?: number;
  amount: number;
  line_name?: string | null;
  room_label?: string | null;
}

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  service_id: string | null;
  line_name?: string | null;
  room_label?: string | null;
  sort_order?: number | null;
}

interface InvoiceDetailPageProps {
  invoiceId: string;
  onBack: () => void;
  onUpdate?: () => void;
}

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-muted", text: "text-muted-foreground", label: "Draft" },
    sent: { bg: "bg-blue-500", text: "text-white", label: "Sent" },
    partially_paid: { bg: "bg-amber-500", text: "text-white", label: "Partially Paid" },
    paid: { bg: "bg-green-500", text: "text-white", label: "Paid" },
    overdue: { bg: "bg-red-500", text: "text-white", label: "Overdue" },
  };
  const c = config[status] || { bg: "bg-muted", text: "text-muted-foreground", label: status };
  return <Badge className={`${c.bg} ${c.text} text-xs px-3 py-1`}>{c.label}</Badge>;
};

const formatCurrency = (amount: number) =>
  formatRand(Number(amount) || 0);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" });

const InvoiceDetailPage = ({ invoiceId, onBack, onUpdate }: InvoiceDetailPageProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [invoice, setInvoice] = useState<any>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [amountPaid, setAmountPaid] = useState(0);
  const [credits, setCredits] = useState<CreditNoteRow[]>([]);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showMobileBar, setShowMobileBar] = useState(false);
  const [profiles, setProfiles] = useState<CompanyProfile[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const { user } = useAuth();

  useEffect(() => { fetchCompanyProfiles().then(setProfiles); }, []);

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([entry]) => setShowMobileBar(!entry.isIntersecting),
      { threshold: 0 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading, invoice?.id]);

  const fetchInvoice = async () => {
    setLoading(true);
    const [invoiceResult, itemsResult, paymentsResult] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", invoiceId).single(),
      supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("sort_order" as any, { ascending: true }).order("created_at", { ascending: true }),
      supabase.from("payments").select("amount, status, gateway").eq("invoice_id", invoiceId),
    ]);

    if (invoiceResult.error) {
      console.error("Error fetching invoice:", invoiceResult.error);
      toast({ title: "Error", description: "Failed to load invoice", variant: "destructive" });
    } else {
      setInvoice(invoiceResult.data);
    }
    setInvoiceItems((itemsResult.data as unknown as InvoiceItem[]) || []);
    // Only settled payments count as cash applied (payment allocation SoT).
    setAmountPaid(sumSettled(((paymentsResult.data as any[]) || [])));
    setCredits(await fetchCreditNotes([invoiceId]));
    setLoading(false);
  };


  // Use invoice_items if available, otherwise fall back to JSONB line_items
  const displayItems: LineItem[] = invoiceItems.length > 0
    ? invoiceItems.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, amount: i.amount, line_name: i.line_name, room_label: i.room_label }))
    : (invoice?.line_items as any[] || []).map((i: any) => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.rate || i.unit_price || 0,
        amount: i.amount,
      }));

  const docProfile = documentProfile(invoice, profiles);
  const isDraft = invoice?.status === "draft";

  // Only non-payment transitions (draft → sent). Paid/partially_paid are
  // derived by the DB from recorded payments — never written here.
  const updateStatus = async (newStatus: "sent") => {
    setUpdating(true);
    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("invoices")
      .update(updateData)
      .eq("id", invoiceId);

    if (error) {
      toast({ title: "Error", description: "Failed to update invoice", variant: "destructive" });
    } else {
      toast({ title: "Updated ✅", description: `Invoice marked as ${newStatus}` });
      setInvoice({ ...invoice, status: newStatus, ...updateData });
      onUpdate?.();
    }
    setUpdating(false);
  };

  const getInvoiceDataForPDF = () => ({
    id: invoice.id,
    invoice_number: invoice.invoice_number,
    customer_name: invoice.customer_name,
    customer_phone: invoice.customer_phone,
    customer_email: invoice.customer_email,
    customer_address: invoice.customer_address,
    issue_date: invoice.issue_date || invoice.created_at,
    due_date: invoice.due_date,
    status: invoice.status,
    line_items: displayItems,
    subtotal: invoice.subtotal,
    tax_rate: invoice.tax_rate,
    tax_amount: invoice.tax_amount,
    grand_total: invoice.grand_total,
    payment_method: invoice.payment_method,
    notes: invoice.notes,
    termsCompany: profileTermsInfo(docProfile),
  });

  const handleDuplicate = async () => {
    setDuplicating(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)("duplicate_invoice", { p_invoice: invoice.id });
    setDuplicating(false);
    if (error || !data) {
      toast({ title: "Couldn't duplicate", description: error?.message || "Try again", variant: "destructive" });
      return;
    }
    toast({ title: "Duplicated as a new draft", description: "Check the client, dates and lines, then save." });
    onUpdate?.();
    setEditingId(data as string);
  };

  const handleDownloadPDF = async () => {
    setGeneratingPDF(true);
    try {
      await downloadInvoicePDF(getInvoiceDataForPDF());
      toast({ title: "PDF Downloaded 📄" });
    } catch (err) {
      console.error("Download PDF error:", err);
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    }
    setGeneratingPDF(false);
  };

  const handleGenerateAndShare = async () => {
    setGeneratingPDF(true);
    try {
      const pdfUrl = await generateAndUploadPDF(getInvoiceDataForPDF());
      if (pdfUrl) {
        setInvoice({ ...invoice, pdf_url: pdfUrl });
      }
      const shared = await shareInvoice(getInvoiceDataForPDF(), pdfUrl);
      if (!shared) {
        toast({ title: "Copied! 📋", description: "Invoice details copied to clipboard" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to generate PDF", variant: "destructive" });
    }
    setGeneratingPDF(false);
  };

  const handleWhatsApp = async () => {
    setGeneratingPDF(true);
    try {
      let pdfUrl = invoice.pdf_url;
      if (!pdfUrl) {
        pdfUrl = await generateAndUploadPDF(getInvoiceDataForPDF());
        if (pdfUrl) setInvoice({ ...invoice, pdf_url: pdfUrl });
      }
      sendViaWhatsApp(getInvoiceDataForPDF(), pdfUrl);
    } catch {
      sendViaWhatsApp(getInvoiceDataForPDF());
    }
    setGeneratingPDF(false);
  };

  if (editingId) {
    return (
      <CreateInvoicePage
        agentId={user?.id || invoice?.agent_id || ""}
        editInvoiceId={editingId}
        onBack={() => { setEditingId(null); fetchInvoice(); }}
        onSuccess={() => { setEditingId(null); onUpdate?.(); onBack(); }}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-4">
        <Button variant="ghost" onClick={onBack}><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
        <p className="text-center text-muted-foreground mt-8">Invoice not found</p>
      </div>
    );
  }

  const docActions = (size: "sm" | "default" = "sm") => (
    <>
      <Button variant="ghost" size={size} className="h-9 rounded-md text-xs" onClick={handleDownloadPDF} disabled={generatingPDF}>
        {generatingPDF ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />} PDF
      </Button>
      {invoice.customer_phone && (
        <Button variant="ghost" size={size} className="h-9 rounded-md text-xs" onClick={handleWhatsApp} disabled={generatingPDF}>
          <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
        </Button>
      )}
      <Button variant="ghost" size={size} className="h-9 rounded-md text-xs" onClick={() => void printInvoicePDF(getInvoiceDataForPDF())}>
        <Printer className="h-3.5 w-3.5 mr-1" /> Print
      </Button>
    </>
  );

  return (
    <div className="v8-scope max-w-4xl mx-auto p-4 space-y-4 pb-24 md:pb-4">
      {/* Header */}
      <div ref={headerRef} className="v8-navy flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold">Invoice</h1>
          {getStatusBadge(invoice.status)}<SentManuallyBadge doc={invoice as any} className="ml-1" />
        </div>
        <div className="flex items-center gap-1">
          <DocumentStyleSwitch companyId={(invoice as any).company_id ?? null} />
          {docActions()}
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleGenerateAndShare} disabled={generatingPDF}>
            {generatingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* FreshBooks-style invoice document (screen + print/PDF) */}
      <InvoiceDocument
        invoiceNumber={invoice.invoice_number}
        issueDate={invoice.issue_date || invoice.created_at}
        dueDate={invoice.due_date}
        customerName={invoice.customer_name}
        customerAddress={invoice.customer_address}
        customerEmail={invoice.customer_email}
        customerPhone={invoice.customer_phone}
        items={displayItems}
        subtotal={Number(invoice.subtotal) || 0}
        taxRate={Number(invoice.tax_rate) || 15}
        taxAmount={Number(invoice.tax_amount) || 0}
        grandTotal={Number(invoice.grand_total) || 0}
        amountPaid={amountPaid}
        credited={creditedByInvoice(credits).get(invoice.id) || 0}
        notes={invoice.notes}
        profile={docProfile}
        billedToVat={invoice.billed_to_vat_number}
        discountAmount={Number(invoice.discount_amount) || 0}
        depositAmount={Number(invoice.deposit_amount) || 0}
        depositLabel={invoice.deposit_type === "percent" ? `${Number(invoice.deposit_value)}% of total incl. VAT` : null}
      />


      {/* Payments — record & history (auto-updates invoice status via DB trigger) */}
      <div className="flex items-center justify-end -mb-2">
        <HelpTip title="Payments" side="left">
          Recording a payment auto-updates this invoice's status: any payment →
          <strong> Partially Paid</strong>, full balance → <strong>Paid</strong>. No manual toggling needed.
        </HelpTip>
      </div>
      <div id="invoice-payment-recorder">
        <PaymentRecorder
          invoiceId={invoice.id}
          invoiceTotal={Number(invoice.grand_total)}
          credited={creditedByInvoice(credits).get(invoice.id) || 0}
          onChange={() => { fetchInvoice(); onUpdate?.(); }}
        />
      </div>

      {/* Draft supplier POs (office only, manual, never emailed) */}
      <PurchaseOrdersPanel invoice={invoice} />

      {/* Accounting step 2: credit notes / write-offs (office only; reps see their own invoices' notes) */}
      <CreditNotesPanel
        invoice={invoice}
        outstanding={Math.max(0, Math.round(((Number(invoice.grand_total) || 0) - amountPaid - (creditedByInvoice(credits).get(invoice.id) || 0)) * 100) / 100)}
        credits={credits}
        onChange={() => { fetchInvoice(); onUpdate?.(); }}
      />

      <div className="print:hidden">
        <div className="w-full space-y-2">
          <div className="flex gap-2">
            {isDraft ? (
              <Button variant="outline" className="flex-1 h-11 rounded-lg" onClick={() => setEditingId(invoice.id)}>
                <Pencil className="h-4 w-4 mr-2" /> Edit draft
              </Button>
            ) : (
              <p className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="h-3.5 w-3.5" /> Sent invoices are locked. Duplicate it, or use a credit note.
              </p>
            )}
            <Button variant="outline" className="flex-1 h-11 rounded-lg" onClick={handleDuplicate} disabled={duplicating}>
              {duplicating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Copy className="h-4 w-4 mr-2" />} Duplicate
            </Button>
          </div>
          {/* Primary action based on status */}
          {/* Mark as sent without emailing: dialog asks how (WhatsApp / handed over / other), server logs + notifies the owner. */}
          <SendInvoiceEmailButton invoiceId={invoice.id} status={invoice.status} className="w-full h-11 rounded-lg font-semibold" onEdit={() => setEditingId(invoice.id)} onSent={() => { fetchInvoice(); onUpdate?.(); }} />
          <MarkSentManuallyButton kind="invoice" id={invoice.id} status={invoice.status} size="default" className="w-full h-11 rounded-lg font-semibold" onDone={() => { fetchInvoice(); onUpdate?.(); }} />
          {/* Paid is DERIVED from recorded payments — never set directly. */}
          {(invoice.status === "sent" || invoice.status === "partially_paid" || invoice.status === "overdue") &&
            Number(invoice.grand_total) - amountPaid > 0.005 && (
            <Button
              variant="default"
              className="w-full h-11 rounded-lg font-semibold"
              onClick={() => document.getElementById("invoice-payment-recorder")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Record Payment ({formatCurrency(Math.max(0, Number(invoice.grand_total) - amountPaid))} due)
            </Button>
          )}

        </div>
      </div>

      {/* Mobile-only quiet footer, shown once the header toolbar scrolls away */}
      {showMobileBar && (
        <div className="md:hidden print:hidden fixed bottom-0 inset-x-0 z-30 bg-background/95 backdrop-blur border-t border-border">
          <div className="max-w-4xl mx-auto flex items-center justify-around gap-1 px-3 py-2">
            {docActions()}
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceDetailPage;
