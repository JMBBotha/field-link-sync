import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle, XCircle, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import PayfastPayButton from "@/components/payments/PayfastPayButton";
import EstimateDocument, { type EstimateDocLineItem } from "@/components/quoting/EstimateDocument";
import SignaturePad from "@/components/jobs/SignaturePad";
import { fetchQuoteInvoiceByToken, type DepositInvoiceRow } from "@/lib/depositInvoice";
import { isDepositCleared } from "@/components/shared/DepositPaymentChip";
import logo from "@/assets/logo.png";

interface QuoteData {
  id: string;
  quote_number: string;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  valid_until: string | null;
  created_at: string;
  accepted_by: string | null;
  customer_name: string | null;
  terms_text: string | null;
  discount_type: string | null;
  discount_value: number | null;
}

interface PublicCustomer {
  name: string | null;
  company_name: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
}

interface PublicCompany {
  company_name: string | null;
  physical_address: string | null;
  vat_number: string | null;
  banking_details: Record<string, string | undefined> | null;
  default_deposit_percentage: number | null;
  default_payment_terms_days: number | null;
}

interface ProposalSection {
  id: string;
  section_type: string;
  title: string;
  content: string | null;
  sort_order: number;
}

const ClientProposalView = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [lineItems, setLineItems] = useState<EstimateDocLineItem[]>([]);
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptedName, setAcceptedName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionDone, setActionDone] = useState<"accepted" | "declined" | null>(null);
  const [depositInvoice, setDepositInvoice] = useState<DepositInvoiceRow | null>(null);


  useEffect(() => {
    if (token) loadQuote();
  }, [token]);

  const loadQuote = async () => {
    try {
      // Token-scoped fetch: the database only returns data when the exact
      // public token is supplied (no anonymous table access).
      const { data: payload, error: rpcErr } = await supabase.rpc("get_public_quote", { p_token: token });
      if (rpcErr || !payload) {
        setError("Invalid or expired quote link.");
        return;
      }

      // Mark as viewed (also token-scoped).
      await supabase.rpc("get_quote_by_public_token", { p_token: token });

      const bundle = payload as any;
      const q = bundle.quote;
      if (!q) { setError("Quote not found."); return; }
      setQuote(q);

      // Document lines: name on the first row, stored sales blurb beneath it —
      // the same shape EstimateDocument renders for staff.
      const items: EstimateDocLineItem[] = (bundle.items || []).map((it: any) => {
        const name = it.item_name || it.description || "Item";
        const blurb = it.item_name ? it.description || null : null;
        const quantity = Number(it.quantity) || 0;
        const unit_price = Number(it.unit_price) || 0;
        return {
          description: blurb ? `${name}\n${blurb}` : name,
          quantity,
          unit_price,
          amount: Number(it.total_price) || quantity * unit_price,
          imageUrl: it.image_url || null,
        };
      });
      setLineItems(items);
      setSections(bundle.sections || []);
      setCustomer(bundle.customer || null);
      setCompany(bundle.company || null);

      // Prefill the accept name once from the quote's customer (still editable).
      const prefill =
        (bundle.customer?.name as string | null) ||
        (q.customer_name as string | null) ||
        (bundle.customer?.company_name as string | null) ||
        "";
      setAcceptedName((prev) => (prev ? prev : (prefill || "").trim()));

      // Deposit invoice (created on accept) — read via the token-gated RPC so
      // anonymous clients can see the chip without touching invoices RLS.
      try {
        setDepositInvoice(await fetchQuoteInvoiceByToken(token!));
      } catch {
        setDepositInvoice(null);
      }
    } catch {
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!acceptedName.trim()) {
      toast({ title: "Please enter your name", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const signatureData = signature
        ? { image: signature, timestamp: new Date().toISOString() }
        : null;

      const { data: success } = await supabase.rpc("accept_quote_by_token", {
        p_token: token!,
        p_accepted_by: acceptedName.trim(),
        p_signature: signatureData,
      });


      if (success) {
        setActionDone("accepted");
        toast({ title: "Quote accepted! ✅" });
        // The accept RPC creates the deposit invoice — refresh via token so the chip shows.
        try {
          setDepositInvoice(await fetchQuoteInvoiceByToken(token!));
        } catch {
          /* token read failed — chip stays hidden */
        }
      } else {
        toast({ title: "Unable to accept quote", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Failed to accept quote", description: err?.message || "Please try again or contact us.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    setSubmitting(true);
    try {
      const { data: success } = await supabase.rpc("decline_quote_by_token", { p_token: token! });
      if (success) {
        setActionDone("declined");
        toast({ title: "Quote declined" });
      }
    } catch (err: any) {
      toast({ title: "Failed to decline quote", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
        <Card className="max-w-md w-full rounded-2xl shadow-xl">
          <CardHeader className="text-center">
            <img src={logo} alt="Be Cool" className="h-16 mx-auto mb-4" />
            <CardTitle className="text-destructive">Access Error</CardTitle>
            <p className="text-muted-foreground text-sm mt-2">{error}</p>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!quote) return null;

  const isActionable = ["sent", "viewed", "draft"].includes(quote.status) && !actionDone;

  const discountValue = Number(quote.discount_value) || 0;
  const discountAmount =
    discountValue > 0
      ? quote.discount_type === "percent"
        ? (Number(quote.subtotal) || 0) * (discountValue / 100)
        : discountValue
      : 0;
  const discountLabel = quote.discount_type === "percent" && discountValue > 0 ? `${discountValue}%` : null;

  const customerName = customer?.name || quote.customer_name || "Valued Customer";

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Cover Header */}
      <header className="bg-primary text-white px-4 py-8 print:hidden">
        <div className="max-w-4xl mx-auto text-center">
          <img src={logo} alt="Be Cool" className="h-16 mx-auto mb-4" />
          <h1 className="text-2xl md:text-3xl font-bold">Service Proposal</h1>
          <p className="text-blue-100 mt-2">Quote #{quote.quote_number}</p>
          {quote.status === "accepted" || actionDone === "accepted" ? (
            <Badge className="mt-3 bg-emerald-500 text-white text-sm px-4 py-1">✅ Accepted</Badge>
          ) : quote.status === "declined" || actionDone === "declined" ? (
            <Badge className="mt-3 bg-red-500 text-white text-sm px-4 py-1">Declined</Badge>
          ) : null}
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
        {/* The quote document — identical layout to the staff estimate/PDF */}
        <EstimateDocument
          estimateNumber={quote.quote_number}
          issueDate={quote.created_at}
          validUntil={quote.valid_until}
          customerName={customerName}
          customerCompany={customer?.company_name}
          customerAddress={customer?.address}
          customerEmail={customer?.email}
          customerPhone={customer?.phone}
          items={lineItems}
          subtotal={Number(quote.subtotal) || 0}
          taxRate={Number(quote.vat_rate) || 0.15}
          taxAmount={Number(quote.vat_amount) || 0}
          grandTotal={Number(quote.total) || 0}
          notes={quote.notes}
          termsText={quote.terms_text}
          discountAmount={discountAmount}
          discountLabel={discountLabel}
          companyOverride={company}
        />

        {/* Optional extra proposal sections (below the document) */}
        {sections.map((section) => (
          <Card key={section.id} className="rounded-2xl shadow-md border-0 print:hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {section.content && (
                <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap">
                  {section.content}
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {/* Accept/Decline Actions */}
        {isActionable && (
          <Card className="rounded-2xl shadow-lg border-0 border-t-4 border-t-primary print:hidden">
            <CardContent className="p-6 space-y-5">
              <h3 className="text-lg font-semibold text-center text-foreground">Accept This Quote</h3>

              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">Complete full name</p>
                <Input
                  placeholder="Your full name"
                  value={acceptedName}
                  onChange={(e) => setAcceptedName(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              {/* Signature Pad (DPR-correct, touch + mouse) */}
              <div>
                <p className="text-sm text-muted-foreground mb-2">Signature (optional)</p>
                <SignaturePad value={signature} onChange={setSignature} height={160} />
              </div>


              <div className="flex gap-3">
                <Button
                  onClick={handleAccept}
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-12"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  Accept Quote
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDecline}
                  disabled={submitting}
                  className="flex-1 rounded-xl h-12 text-destructive border-destructive/30 hover:bg-destructive/5"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Outcome Messages */}
        {(actionDone === "accepted" || quote.status === "accepted") && (
          <Card className="rounded-2xl shadow-lg border-0 bg-emerald-50 border-t-4 border-t-emerald-500">
            <CardContent className="p-6 text-center space-y-3">
              <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto" />
              <h3 className="text-lg font-bold text-emerald-800">Quote Accepted!</h3>
              <p className="text-sm text-emerald-600">
                Thank you{quote.accepted_by ? `, ${quote.accepted_by}` : ""}. We'll be in touch to schedule the work.
              </p>
              <div className="flex flex-col items-center gap-3 pt-1">
                <DepositPaymentChip invoice={depositInvoice} accepted />
                {depositInvoice?.id && !isDepositCleared(depositInvoice) && (
                  <PayfastPayButton
                    invoiceId={depositInvoice.id}
                    invoiceNumber={depositInvoice.invoice_number || "Deposit"}
                    amount={Number(depositInvoice.grand_total) || 0}
                    customerEmail={null}
                    customerName={quote.accepted_by || "Customer"}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center py-6 space-y-3">
          <p className="text-sm text-muted-foreground">Questions? Contact us anytime</p>
          <div className="flex justify-center gap-3">
            <Button size="sm" variant="outline" asChild>
              <a href="tel:0800232665">
                <Phone className="h-4 w-4 mr-2" />
                0800-BE-COOL
              </a>
            </Button>
          </div>
          <div className="border-t pt-4 mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              By accepting this quote, you consent to AC Super Service processing your personal information
              in accordance with the Protection of Personal Information Act (POPIA).
            </p>
            <p className="text-xs text-muted-foreground">
              <a href="#" className="underline hover:text-foreground">Privacy Policy</a> | <a href="#" className="underline hover:text-foreground">Terms & Conditions</a>
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-4">AC Super Service © {new Date().getFullYear()}</p>
        </div>
      </main>
    </div>
  );
};

export default ClientProposalView;
