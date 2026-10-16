import ClientAdjustQuote from "@/components/client/ClientAdjustQuote";
import { useQuoteUnitCards, QuoteUnitCardsView } from "@/components/quoting/QuoteUnitCards";
import type { CompanyProfile } from "@/lib/companyProfiles";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CheckCircle, Phone, MessageSquare } from "lucide-react";
import ClientDepositActions from "@/components/client/ClientDepositActions";
import { useToast } from "@/hooks/use-toast";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import PayfastPayButton from "@/components/payments/PayfastPayButton";
import EstimateDocument, { type EstimateDocLineItem } from "@/components/quoting/EstimateDocument";
import { lineQtyText, buildClientRollup, type ClientRollupArea } from "@/lib/clientQuoteRollup";
import SignaturePad from "@/components/jobs/SignaturePad";
import { fetchQuoteInvoiceByToken, type DepositInvoiceRow } from "@/lib/depositInvoice";
import { isDepositCleared } from "@/components/shared/DepositPaymentChip";
import logo from "@/assets/logo.png";
import logoWhite from "@/assets/brand/logo-white.png";
import { publicQuoteUrl } from "@/lib/publicAppUrl";

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

/** Collapses stray whitespace in stored first/last names ("Andre  Blom"). */
const tidyName = (value?: string | null) => (value || "").replace(/\s+/g, " ").trim();



const ClientProposalView = () => {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [lineItems, setLineItems] = useState<EstimateDocLineItem[]>([]);
  const [clientAreas, setClientAreas] = useState<ClientRollupArea[]>([]);
  const [customer, setCustomer] = useState<PublicCustomer | null>(null);
  const [company, setCompany] = useState<PublicCompany | null>(null);
  // The quote company's own record (get_public_quote 'profile'): header + banking (Johan 2026-10-12).
  const [companyProfile, setCompanyProfile] = useState<Partial<CompanyProfile> | null>(null);
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [acceptedName, setAcceptedName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionDone, setActionDone] = useState<"accepted" | "declined" | null>(null);
  const [depositInvoice, setDepositInvoice] = useState<DepositInvoiceRow | null>(null);
  const [unitLines, setUnitLines] = useState<any[] | null>(null);
  const [showUnitCards, setShowUnitCards] = useState(false);
  const { cards: unitCards } = useQuoteUnitCards(unitLines, { enabled: showUnitCards });
  // Ask for changes (Johan 2026-10-13 12:07)
  const [changeState, setChangeState] = useState<{ open: boolean; requested_at: string } | null>(null);
  const [showChanges, setShowChanges] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [hasAlternatives, setHasAlternatives] = useState(false);
  const [compareSignal, setCompareSignal] = useState(0);
  const compareRef = useRef<HTMLDivElement>(null);
  const [changeMsg, setChangeMsg] = useState("");
  const [changePhone, setChangePhone] = useState("");
  const acceptRef = useRef<HTMLDivElement>(null);
  const changesRef = useRef<HTMLDivElement>(null);


  useEffect(() => {
    if (token) loadQuote();
  }, [token]);

  // Arriving from the "View all quotes" page: ?action=accept|changes jumps straight to that flow (Johan 13 Oct 14:58).
  const bundleToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("bundle") : null;
  const jumpedRef = useRef(false);
  useEffect(() => {
    if (!quote || jumpedRef.current || !["sent", "viewed"].includes(quote.status)) return;
    const action = new URLSearchParams(window.location.search).get("action");
    if (!action) return;
    jumpedRef.current = true;
    if (action === "changes") setShowChanges(true);
    let tries = 0;
    const jump = () => {
      const el = action === "changes" ? changesRef.current : acceptRef.current;
      if (el) el.scrollIntoView({ behavior: "auto", block: "center" });
      else if (tries++ < 20) setTimeout(jump, 150);
    };
    setTimeout(jump, 600);
  }, [quote]);

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
          qtyText: lineQtyText(it),
          imageUrl: it.image_url || null,
        };
      });
      setLineItems(items);
      // Client-facing roll-up: one block per room, no itemised piping/labour.
      setClientAreas(buildClientRollup(bundle.items || [], bundle.areas || [], { targetSubtotal: Number(q.subtotal) }));
      setSections(bundle.sections || []);
      setUnitLines(bundle.items || []);
      supabase.rpc("public_quote_show_unit_cards" as never, { p_token: token } as never)
        .then(({ data }: any) => setShowUnitCards(data === true), () => setShowUnitCards(false));
      supabase.rpc("public_quote_change_state" as never, { p_token: token } as never)
        .then(({ data }: any) => setChangeState(data && data.open ? data : null), () => setChangeState(null));
      setCustomer(bundle.customer || null);
      setCompany(bundle.company || null);
      setCompanyProfile(bundle.profile || null);

      // Prefill the accept name once from the quote's customer (still editable).
      const prefill =
        (bundle.customer?.name as string | null) ||
        (q.customer_name as string | null) ||
        (bundle.customer?.company_name as string | null) ||
        "";
      setAcceptedName((prev) => (prev ? prev : tidyName(prefill)));

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

  const handleRequestChanges = async () => {
    if (changeMsg.trim().length < 3) {
      toast({ title: "Tell us what you'd like changed", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data: ok, error: e } = await supabase.rpc("request_quote_changes" as never, {
        p_token: token!, p_message: changeMsg.trim(), p_name: acceptedName.trim() || null, p_phone: changePhone.trim() || null,
      } as never);
      if (e) throw e;
      if (ok) {
        setChangeState({ open: true, requested_at: new Date().toISOString() });
        setChangeMsg("");
        setShowChanges(false);
        toast({ title: "Request sent", description: "Your consultant will update the quote." });
      } else {
        toast({ title: "Unable to send request", description: "This quote can no longer be changed online. Please contact us.", variant: "destructive" });
      }
    } catch (err: any) {
      toast({ title: "Failed to send request", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!window.confirm("Decline this quote?")) return;
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

  // Drafts are not accepted online (Johan 2026-10-13); the database refuses them too.
  const isActionable = ["sent", "viewed"].includes(quote.status) && !actionDone;
  const isDraft = quote.status === "draft" && !actionDone;
  const brandName = (companyProfile as any)?.legal_name || (companyProfile as any)?.trading_name || company?.company_name || "";
  // Massair CT: transparent logo straight on the blue header, no white box (Johan 13 Oct 12:52).
  const logoOnColour = /^massair ct\b/i.test(brandName);
  const headerLogo: string | null = logoOnColour ? logoWhite : ((companyProfile as any)?.logo_url || null);
  const brandPhone: string | null = (companyProfile as any)?.phone || null;
  const fmtR = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n || 0);
  const goTo = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: "smooth", block: "center" });
  const openCompare = () => { setCompareSignal((n) => n + 1); setTimeout(() => compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); };

  const discountValue = Number(quote.discount_value) || 0;
  const isPercentDiscount = quote.discount_type === "percent" || quote.discount_type === "percentage";
  const discountAmount =
    discountValue > 0
      ? isPercentDiscount
        ? (Number(quote.subtotal) || 0) * (discountValue / 100)
        : discountValue
      : 0;
  const discountLabel = isPercentDiscount && discountValue > 0 ? `${discountValue}%` : null;

  const customerName = tidyName(customer?.name || quote.customer_name || "") || "Valued Customer";

  return (
    <div className={`min-h-screen bg-gradient-to-b from-blue-50 to-white ${isActionable ? "pb-24" : ""}`}>
      {/* One header (Johan 16 Oct 09:34): the document's own company header is the page header; only a slim status strip here. */}
      {(quote.status === "accepted" || actionDone === "accepted" || quote.status === "declined" || actionDone === "declined" || changeState?.open) && (
        <div className="print:hidden text-center pt-3">
          {quote.status === "accepted" || actionDone === "accepted" ? (
            <Badge className="bg-emerald-500 text-white text-sm px-4 py-1">✅ Accepted</Badge>
          ) : quote.status === "declined" || actionDone === "declined" ? (
            <Badge className="bg-red-500 text-white text-sm px-4 py-1">Declined</Badge>
          ) : (
            <Badge className="bg-amber-500 text-white text-sm px-4 py-1">Changes requested</Badge>
          )}
        </div>
      )}

      <main className="max-w-4xl mx-auto p-3 md:p-8 space-y-4 md:space-y-6">
        {bundleToken && (
          <a href={`/quote/all/${encodeURIComponent(bundleToken)}`} className="inline-block text-sm text-[#0B4FA8] underline print:hidden">← Back to all quotes</a>
        )}
        {/* Accept spot 1: summary card at the top */}
        {isActionable && (
          <Card className="rounded-2xl border-0 shadow-md print:hidden" data-testid="quote-summary-accept">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-muted-foreground">{customerName} · Quote {quote.quote_number}</p>
                <p className="text-xl font-extrabold text-[#0B4FA8]">{fmtR(Number(quote.total) || 0)} <span className="text-xs font-medium text-muted-foreground">incl. VAT</span></p>
                {quote.valid_until && <p className="text-xs text-muted-foreground">Valid until {new Date(quote.valid_until).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}</p>}
              </div>
              <div className="flex gap-2">
                {hasAlternatives && (
                  <Button variant="outline" className="h-11 rounded-xl text-[#0B4FA8]" onClick={openCompare}>Compare brands</Button>
                )}
                <Button className="h-11 flex-1 sm:flex-none rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold" onClick={() => goTo(acceptRef.current)}>
                  <CheckCircle className="h-4 w-4 mr-2" /> Accept quote
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

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
          customerVat={(customer as any)?.vat_number}
          items={lineItems}
          presentationMode="clientRollup"
          clientAreas={clientAreas}
          subtotal={Number(quote.subtotal) || 0}
          taxRate={Number(quote.vat_rate) || 0.15}
          taxAmount={Number(quote.vat_amount) || 0}
          grandTotal={Number(quote.total) || 0}
          notes={quote.notes}
          termsText={quote.terms_text}
          discountAmount={discountAmount}
          discountLabel={discountLabel}
          companyOverride={company}
          companyProfile={companyProfile}
          paymentPlan={(quote as any).payment_plan ?? null}
          collapseTerms
          afterTotalsAction={isActionable ? (
            <div className="print:hidden" style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }} data-testid="accept-after-lines">
              <Button className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold w-full sm:w-auto" onClick={() => goTo(acceptRef.current)}>
                <CheckCircle className="h-4 w-4 mr-2" /> Accept quote · {fmtR(Number(quote.total) || 0)}
              </Button>
            </div>
          ) : null}
          unitCards={<QuoteUnitCardsView cards={unitCards} companyId={(companyProfile as any)?.company_id ?? null} variant={(companyProfile as any)?.document_style === "bold" ? "bold" : "light"} />}
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

        {isDraft && (
          <Card className="rounded-2xl border-0 shadow-md print:hidden">
            <CardContent className="p-5 text-center text-sm text-muted-foreground">
              This quote is still being prepared. You'll be able to accept it once it has been sent to you.
            </CardContent>
          </Card>
        )}

        {isActionable && changeState?.open && (
          <Card className="rounded-2xl border-0 shadow-md bg-amber-50 border-t-4 border-t-amber-500 print:hidden">
            <CardContent className="p-5 text-center text-sm text-amber-800">
              Changes requested on {new Date(changeState.requested_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}. Your consultant will update the quote and send it again.
            </CardContent>
          </Card>
        )}

        {isActionable && token && <div ref={compareRef}><ClientAdjustQuote token={token} defaultName={acceptedName} onEditingChange={setAdjusting} onAlternatives={setHasAlternatives} openSignal={compareSignal} /></div>}

        {/* Ask for changes */}
        {isActionable && showChanges && (
          <div ref={changesRef}>
            <Card className="rounded-2xl shadow-lg border-2 border-[#F7941D] print:hidden">
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-foreground">Ask for changes</h3>
                <p className="text-sm text-muted-foreground">Tell us what you'd like changed. Your consultant will update the quote.</p>
                <Textarea
                  value={changeMsg}
                  onChange={(e) => setChangeMsg(e.target.value.slice(0, 2000))}
                  placeholder="e.g. Can you quote a 12K unit for the main bedroom instead?"
                  className="rounded-xl min-h-[96px]"
                />
                <Input value={changePhone} onChange={(e) => setChangePhone(e.target.value)} placeholder="Best number to reach you (optional)" className="rounded-xl" inputMode="tel" />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => setShowChanges(false)} disabled={submitting}>Cancel</Button>
                  <Button onClick={handleRequestChanges} disabled={submitting} className="bg-[#0B4FA8] hover:bg-[#0B4FA8]/90 text-white rounded-lg">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                    Send request
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Accept */}
        {isActionable && (
          <div ref={acceptRef}>
          <Card className="rounded-2xl shadow-lg border-0 border-t-4 border-t-emerald-600 print:hidden">
            <CardContent className="p-6 space-y-5">
              <h3 className="text-lg font-semibold text-center text-foreground">Accept this quote</h3>

              <div className="space-y-1.5">
                <p className="text-sm text-muted-foreground">Complete full name</p>
                <Input
                  placeholder="Your full name"
                  value={acceptedName}
                  onChange={(e) => setAcceptedName(e.target.value)}
                  className="rounded-xl"
                />
              </div>

              <div>
                <p className="text-sm text-muted-foreground mb-2">Signature (optional)</p>
                <SignaturePad value={signature} onChange={setSignature} height={240} />
              </div>

              <Button
                onClick={handleAccept}
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white h-12 text-base font-bold"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                Accept quote · {fmtR(Number(quote.total) || 0)}
              </Button>
              <div className="flex items-center justify-center gap-4">
                <Button size="sm" variant="outline" className="h-8 text-xs text-[#0B4FA8]" onClick={() => { setShowChanges(true); setTimeout(() => goTo(changesRef.current), 50); }}>
                  Ask for changes
                </Button>
                <button type="button" onClick={handleDecline} disabled={submitting} className="text-xs text-muted-foreground underline">Decline</button>
              </div>
            </CardContent>
          </Card>
          </div>
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
                {/* Online gateway only when one is actually configured for this company (PayFast is not connected). */}
                {depositInvoice?.id && depositInvoice.gateway_enabled && !isDepositCleared(depositInvoice) && (
                  <PayfastPayButton
                    enabled
                    invoiceId={depositInvoice.id}
                    invoiceNumber={depositInvoice.invoice_number || "Deposit"}
                    amount={Number(depositInvoice.deposit_amount ?? depositInvoice.grand_total) || 0}
                    customerEmail={null}
                    customerName={quote.accepted_by || "Customer"}
                    returnUrl={token ? publicQuoteUrl(token) : undefined}
                    cancelUrl={token ? publicQuoteUrl(token) : undefined}
                  />
                )}
                {token && depositInvoice?.id && (
                  <ClientDepositActions invoice={depositInvoice} payUrl={publicQuoteUrl(token)} banking={company?.banking_details} profile={companyProfile} />
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="text-center py-6 space-y-3">
          <p className="text-sm text-muted-foreground">Questions? Contact us anytime</p>
          {brandPhone && (
            <div className="flex justify-center gap-3">
              <Button size="sm" variant="outline" asChild>
                <a href={`tel:${brandPhone.replace(/[^\d+]/g, "")}`}>
                  <Phone className="h-4 w-4 mr-2" />
                  {brandPhone}
                </a>
              </Button>
            </div>
          )}
          <div className="border-t pt-4 mt-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              By accepting this quote, you consent to {brandName || "us"} processing your personal information
              in accordance with the Protection of Personal Information Act (POPIA).
            </p>
            <p className="text-xs text-muted-foreground">
              <a href="#" className="underline hover:text-foreground">Privacy Policy</a> | <a href="#" className="underline hover:text-foreground">Terms & Conditions</a>
            </p>
          </div>
          <p className="text-xs text-muted-foreground mt-4">{brandName} © {new Date().getFullYear()}</p>
        </div>
      </main>

      {/* Sticky bottom bar (Johan 16 Oct 09:34): total + Accept (+ Compare brands only when alternatives exist), one row. */}
      {isActionable && !adjusting && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-white shadow-[0_-4px_14px_rgba(0,0,0,0.12)] print:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} data-testid="sticky-accept-bar">
          <div className="max-w-4xl mx-auto px-3 py-2 flex items-center gap-2">
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[10px] text-muted-foreground">Total incl. VAT</div>
              <b className="text-[#0B4FA8] text-sm">{fmtR(Number(quote.total) || 0)}</b>
            </div>
            {hasAlternatives && (
              <Button variant="outline" className="h-11 px-3 rounded-xl text-[#0B4FA8] text-sm" onClick={openCompare}>Compare brands</Button>
            )}
            <Button onClick={() => goTo(acceptRef.current)} disabled={submitting} className="h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold">
              <CheckCircle className="h-4 w-4 mr-1.5" /> Accept
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientProposalView;
