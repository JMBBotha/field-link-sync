import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, FileCheck2, Send, Download, Printer, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useRegisterAssistantContext } from "@/hooks/useAssistantContextTracker";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { convertQuoteToInvoice, buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdf } from "@/lib/documentPdf";
import EstimateDocument from "@/components/quoting/EstimateDocument";
import StatusPill from "@/components/shared/StatusPill";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Read-only, client-facing estimate document view.
 * This is the default target when opening an estimate; the Quote Builder is
 * reached from the "Edit" action here.
 */
const AdminEstimateDetailPage = () => {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { settings } = useCompanySettings();
  const [busy, setBusy] = useState<string | null>(null);

  const { data: quote, isLoading } = useQuery({
    queryKey: ["quote-document", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name, company_name, address, email, phone)")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  // Tell the voice assistant which quote is open on screen.
  useRegisterAssistantContext({
    open_quote_id: id,
    open_quote_number: quote?.quote_number ?? undefined,
    open_quote_status: quote?.status ?? undefined,
    selected_customer_id: quote?.customer_id ?? undefined,
    selected_customer_name: quote?.customer_name ?? undefined,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["quote-document-items", id],
    queryFn: () => buildQuoteLineItems(id, quote?.visual_sections),
    enabled: !!id && !!quote,
  });

  const docItems = items.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    unit_price: i.rate,
    amount: i.amount,
  }));

  const customer = quote?.customers || {};
  const subtotal = Number(quote?.subtotal) || 0;
  const taxAmount = Number(quote?.vat_amount) || 0;
  const total = Number(quote?.total) || 0;

  /** Standard workflow: only an accepted estimate may become a billable invoice. */
  const canConvert = String(quote?.status || "").toLowerCase() === "accepted";

  const handleSend = async () => {
    setBusy("send");
    const { error } = await supabase.from("quotes").update({ status: "sent" }).eq("id", id);
    if (error) {
      toast({ title: "Could not update status", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Marked as sent ✅" });
      qc.invalidateQueries({ queryKey: ["quote-document", id] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    }
    setBusy(null);
  };

  const handlePdf = async () => {
    setBusy("pdf");
    try {
      await generateDocumentPdf({
        docType: "Quote",
        docNumber: quote?.quote_number || "DRAFT",
        companyName: settings.company_name || "0800-BE-COOL",
        companyAddress: settings.physical_address,
        vatNumber: settings.vat_number,
        customerName: customer.name || quote?.customer_name || "Customer",
        customerAddress: customer.address || undefined,
        customerEmail: customer.email || undefined,
        issueDate: quote?.created_at,
        lineItems: items,
        subtotal,
        taxRate: Number(quote?.vat_rate) || 0.15,
        taxAmount,
        total,
        notes: quote?.notes || undefined,
        captureSelector: '[data-pdf-capture-root="estimate"]',
      });
    } catch (e: any) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    }
    setBusy(null);
  };

  const handleConvert = async () => {
    if (!user?.id) return;
    setBusy("convert");
    try {
      const invoiceId = await convertQuoteToInvoice(id, user.id);
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Invoice created", description: "Draft invoice generated from estimate." });
      navigate(`/admin/invoices?highlight=${invoiceId}`);
    } catch (e: any) {
      toast({ title: e.message || "Conversion failed", variant: "destructive" });
    }
    setBusy(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/admin/quotes")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <p className="mt-8 text-center text-muted-foreground">Estimate not found</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-32">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => navigate("/admin/quotes")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Estimate {quote.quote_number}</h1>
        <div className="w-9" />
      </div>

      {/* Status banner */}
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-4 py-3 print:hidden">
        <span className="text-sm text-muted-foreground">Status</span>
        <StatusPill status={quote.status} />
        <span className="text-xs text-muted-foreground">
          Created {new Date(quote.created_at).toLocaleDateString("en-ZA")}
        </span>
      </div>

      <EstimateDocument
        estimateNumber={quote.quote_number}
        issueDate={quote.created_at}
        validUntil={quote.valid_until}
        customerName={customer.name || quote.customer_name || "Customer"}
        customerCompany={customer.company_name}
        customerAddress={customer.address}
        customerEmail={customer.email}
        customerPhone={customer.phone}
        items={docItems}
        subtotal={subtotal}
        taxRate={Number(quote.vat_rate) || 0.15}
        taxAmount={taxAmount}
        grandTotal={total}
        notes={quote.notes}
        termsText={quote.terms_text}
      />

      {/* Actions */}
      <div className="flex flex-wrap justify-end gap-2 pt-2 print:hidden">
        <Button variant="outline" onClick={() => navigate(`/admin/quote-builder?quoteId=${quote.id}`)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </Button>
        <Button variant="outline" onClick={handleSend} disabled={busy === "send"}>
          {busy === "send" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          Send
        </Button>
        <Button variant="outline" onClick={handlePdf} disabled={busy === "pdf"}>
          {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          PDF
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </Button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  variant="brand"
                  onClick={handleConvert}
                  disabled={busy === "convert" || !canConvert}
                >
                  {busy === "convert" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileCheck2 className="mr-2 h-4 w-4" />
                  )}
                  Convert to Invoice
                </Button>
              </span>
            </TooltipTrigger>
            {!canConvert && (
              <TooltipContent>
                Estimate must be Accepted before converting to an invoice
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
};

export default AdminEstimateDetailPage;
