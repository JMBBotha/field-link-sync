import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mail, MessageCircle, Loader2, Check, Download } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { buildQuoteLineItems } from "@/lib/convertQuoteToInvoice";
import { generateDocumentPdfBlob } from "@/lib/documentPdf";
import EstimateDocument from "./EstimateDocument";

interface SendQuoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  quoteNumber: string;
  customerId: string | null;
  customerName: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Sends the SAVED quote to a client by email/WhatsApp, and lets the user
 * download it. The PDF is always generated from the same EstimateDocument
 * component and DOM-capture pipeline used by the read-only estimate page
 * (`/admin/estimates/:id`), so what gets downloaded or emailed here is
 * guaranteed to match the "new" estimate/invoice template exactly — never
 * the legacy react-pdf layout.
 */
const SendQuoteDialog = ({
  open,
  onOpenChange,
  quoteId,
  quoteNumber,
  customerId,
  customerName,
}: SendQuoteDialogProps) => {
  const { settings } = useCompanySettings();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"email" | "whatsapp" | "pdf" | null>(null);
  const [sent, setSent] = useState<{ email: boolean; whatsapp: boolean }>({ email: false, whatsapp: false });

  useEffect(() => {
    if (!open || !customerId) return;
    let cancelled = false;
    (async () => {
      const [{ data: cust }, { data: lead }] = await Promise.all([
        supabase.from("customers").select("email, phone").eq("id", customerId).maybeSingle(),
        supabase.from("leads").select("id").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      const c = cust as { email?: string | null; phone?: string | null } | null;
      setEmail(c?.email || "");
      setPhone(c?.phone || "");
      setLeadId((lead as { id?: string } | null)?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [open, customerId]);

  // Fetch the freshly-saved quote (plus customer + line items) straight from
  // the DB whenever the dialog opens, so the PDF we build/send always
  // reflects exactly what was just persisted — same source data as the
  // canonical estimate view.
  const { data: quote } = useQuery({
    queryKey: ["send-quote-doc", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name, company_name, address, email, phone)")
        .eq("id", quoteId)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: open && !!quoteId,
  });

  const { data: items = [] } = useQuery({
    queryKey: ["send-quote-doc-items", quoteId, quote?.visual_sections],
    queryFn: () => buildQuoteLineItems(quoteId, quote?.visual_sections),
    enabled: open && !!quoteId && !!quote,
  });

  const customer = quote?.customers || {};
  const subtotal = Number(quote?.subtotal) || 0;
  const taxAmount = Number(quote?.vat_amount) || 0;
  const total = Number(quote?.total) || 0;
  const docItems = items.map((i) => ({
    description: i.description,
    quantity: i.quantity,
    unit_price: i.rate,
    amount: i.amount,
  }));
  const resolvedCustomerName = customer.name || quote?.customer_name || customerName || "Customer";

  const buildPdf = async (): Promise<Blob> => {
    if (!quote) throw new Error("Quote not loaded yet — please wait a moment and try again.");
    return generateDocumentPdfBlob({
      docType: "Quote",
      docNumber: quote.quote_number || quoteNumber || "DRAFT",
      companyName: settings.company_name || "0800-BE-COOL",
      companyAddress: settings.physical_address,
      vatNumber: settings.vat_number,
      customerName: resolvedCustomerName,
      customerAddress: customer.address || undefined,
      customerEmail: customer.email || undefined,
      issueDate: quote.created_at,
      lineItems: items,
      subtotal,
      taxRate: Number(quote.vat_rate) || 0.15,
      taxAmount,
      total,
      notes: quote.notes || undefined,
      captureSelector: '[data-pdf-capture-root="estimate"]',
    });
  };

  const logDelivery = async (channel: "email" | "whatsapp", recipient: string) => {
    const { data: userData } = await supabase.auth.getUser();
    const agentId = userData?.user?.id;
    if (!agentId) return;
    await supabase.from("communication_log").insert({
      agent_id: agentId,
      customer_id: customerId,
      lead_id: leadId,
      type: channel,
      subject: `Quote ${quoteNumber} sent`,
      body: `Quote ${quoteNumber} (${total.toFixed(2)} incl. VAT) was sent to ${recipient} via ${channel}.`,
    });
    await supabase
      .from("quotes")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", quoteId);
  };

  const handleDownload = async () => {
    setBusy("pdf");
    try {
      const blob = await buildPdf();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${quoteNumber || "quote"}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({
        title: "PDF failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleEmail = async () => {
    if (!email.trim()) {
      toast({ title: "Email required", description: "Add a client email address first.", variant: "destructive" });
      return;
    }
    setBusy("email");
    try {
      const pdfBase64 = await blobToBase64(await buildPdf());
      const { error } = await supabase.functions.invoke("send-quote-email", {
        body: {
          to: email.trim(),
          subject: `Your quote ${quoteNumber}`,
          quoteNumber,
          clientName: resolvedCustomerName,
          totalAmount: total,
          unsubscribeToken: crypto.randomUUID(),
          pdfBase64,
        },
      });
      if (error) throw error;
      await logDelivery("email", email.trim());
      setSent((s) => ({ ...s, email: true }));
      toast({ title: "Quote emailed", description: `Sent to ${email.trim()}` });
    } catch (err) {
      toast({
        title: "Email failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleWhatsApp = async () => {
    if (!phone.trim()) {
      toast({ title: "Number required", description: "Add a client WhatsApp number first.", variant: "destructive" });
      return;
    }
    setBusy("whatsapp");
    try {
      const pdfBase64 = await blobToBase64(await buildPdf());
      const { data, error } = await supabase.functions.invoke("send-quote-whatsapp", {
        body: {
          quoteId,
          quoteNumber,
          to: phone.trim(),
          clientName: resolvedCustomerName,
          totalAmount: total,
          pdfBase64,
        },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; error?: string } | null;
      if (res && res.ok === false) throw new Error(res.error || "WhatsApp send failed");
      await logDelivery("whatsapp", phone.trim());
      setSent((s) => ({ ...s, whatsapp: true }));
      toast({ title: "Quote sent on WhatsApp", description: `Sent to ${phone.trim()}` });
    } catch (err) {
      toast({
        title: "WhatsApp send failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send quote {quoteNumber} to client</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            The saved quote is attached as a PDF and the send is logged against {resolvedCustomerName || "the client"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="send-quote-email" className="text-xs">Email address</Label>
            <div className="flex gap-2">
              <Input
                id="send-quote-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                className="h-9 text-sm"
              />
              <Button onClick={handleEmail} disabled={busy !== null} className="h-9 shrink-0 gap-1.5">
                {busy === "email" ? <Loader2 className="h-4 w-4 animate-spin" /> : sent.email ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
                Email
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="send-quote-phone" className="text-xs">WhatsApp number</Label>
            <div className="flex gap-2">
              <Input
                id="send-quote-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+27 82 000 0000"
                className="h-9 text-sm"
              />
              <Button
                onClick={handleWhatsApp}
                disabled={busy !== null}
                variant="secondary"
                className="h-9 shrink-0 gap-1.5"
              >
                {busy === "whatsapp" ? <Loader2 className="h-4 w-4 animate-spin" /> : sent.whatsapp ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
                WhatsApp
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={handleDownload} disabled={busy !== null} className="gap-1.5">
            {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download PDF
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>

      {/* Off-screen render of the CORRECT estimate template so html2canvas has
          a real, up-to-date DOM node to capture for downloads/emails. Kept
          out of the dialog's visible layout but not display:none (required
          for html2canvas to measure and capture it). */}
      {open && quote && (
        <div style={{ position: "fixed", top: 0, left: "-10000px", width: "820px", pointerEvents: "none" }} aria-hidden="true">
          <EstimateDocument
            estimateNumber={quote.quote_number || quoteNumber}
            issueDate={quote.created_at}
            validUntil={quote.valid_until}
            customerName={resolvedCustomerName}
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
        </div>
      )}
    </Dialog>
  );
};

export default SendQuoteDialog;
