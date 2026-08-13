import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, Send, CheckCircle, Printer, Download, Share2, Phone, Mail, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { generateAndUploadPDF, downloadInvoicePDF, shareInvoice, sendViaWhatsApp } from "@/lib/invoicePDF";
import PaymentRecorder from "@/components/invoicing/PaymentRecorder";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";

import HelpTip from "@/components/help/HelpTip";

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  rate?: number;
  amount: number;
}

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  service_id: string | null;
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
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

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

  useEffect(() => {
    fetchInvoice();
  }, [invoiceId]);

  const fetchInvoice = async () => {
    setLoading(true);
    const [invoiceResult, itemsResult, paymentsResult] = await Promise.all([
      supabase.from("invoices").select("*").eq("id", invoiceId).single(),
      supabase.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("created_at", { ascending: true }),
      supabase.from("payments").select("amount").eq("invoice_id", invoiceId),
    ]);

    if (invoiceResult.error) {
      console.error("Error fetching invoice:", invoiceResult.error);
      toast({ title: "Error", description: "Failed to load invoice", variant: "destructive" });
    } else {
      setInvoice(invoiceResult.data);
    }
    setInvoiceItems((itemsResult.data as unknown as InvoiceItem[]) || []);
    setAmountPaid(((paymentsResult.data as any[]) || []).reduce((s, p) => s + (Number(p.amount) || 0), 0));
    setLoading(false);
  };


  // Use invoice_items if available, otherwise fall back to JSONB line_items
  const displayItems: LineItem[] = invoiceItems.length > 0
    ? invoiceItems.map(i => ({ description: i.description, quantity: i.quantity, unit_price: i.unit_price, amount: i.amount }))
    : (invoice?.line_items as any[] || []).map((i: any) => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.rate || i.unit_price || 0,
        amount: i.amount,
      }));

  const updateStatus = async (newStatus: string) => {
    setUpdating(true);
    const updateData: any = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === "paid") {
      updateData.paid_date = new Date().toISOString().split("T")[0];
    }

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
  });

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

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4 pb-44">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">Invoice</h1>
          {getStatusBadge(invoice.status)}
        </div>
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleGenerateAndShare} disabled={generatingPDF}>
          {generatingPDF ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        </Button>
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
        notes={invoice.notes}
      />


      {/* Payments — record & history (auto-updates invoice status via DB trigger) */}
      <div className="flex items-center justify-end -mb-2">
        <HelpTip title="Payments" side="left">
          Recording a payment auto-updates this invoice's status: any payment →
          <strong> Partially Paid</strong>, full balance → <strong>Paid</strong>. No manual toggling needed.
        </HelpTip>
      </div>
      <PaymentRecorder invoiceId={invoice.id} invoiceTotal={Number(invoice.grand_total)} />

      {/* Extra spacer so the fixed action bar doesn't cover payments */}
      <div className="h-32" />

      {/* Fixed Action Buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-md border-t z-50 max-w-lg mx-auto space-y-2">
        {/* Primary action based on status */}
        {invoice.status === "draft" && (
          <Button
            className="w-full h-12 rounded-xl font-semibold"
            style={{ backgroundColor: '#0077B6' }}
            onClick={() => updateStatus("sent")}
            disabled={updating}
          >
            {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Mark as Sent
          </Button>
        )}
        {invoice.status === "sent" && (
          <Button
            className="w-full h-12 rounded-xl font-semibold bg-green-600 hover:bg-green-700"
            onClick={() => updateStatus("paid")}
            disabled={updating}
          >
            {updating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Mark as Paid
          </Button>
        )}

        {/* Share/Download actions */}
        <div className="grid grid-cols-3 gap-2">
          <Button variant="outline" className="h-10 rounded-xl text-xs" onClick={handleDownloadPDF} disabled={generatingPDF}>
            {generatingPDF ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />} PDF
          </Button>
          {invoice.customer_phone && (
            <Button variant="outline" className="h-10 rounded-xl text-xs" onClick={handleWhatsApp} disabled={generatingPDF}>
              <MessageCircle className="h-3.5 w-3.5 mr-1" /> WhatsApp
            </Button>
          )}
          <Button variant="outline" className="h-10 rounded-xl text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5 mr-1" /> Print
          </Button>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetailPage;
