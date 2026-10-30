import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ArrowLeft, FileText, Download, Clock, CheckCircle } from "lucide-react";
import PayfastPayButton from "@/components/payments/PayfastPayButton";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { attachPaymentTotals } from "@/lib/depositInvoice";
import { format } from "date-fns";
import logo from "@/assets/logo.png";
import { publicCustomerUrl } from "@/lib/publicAppUrl";
import { documentProfile, profileBanking } from "@/lib/companyProfiles";
import { formatRand } from "@/utils/formatRand";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_address: string | null;
  line_items: LineItem[];
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  payment_method: string | null;
  notes: string | null;
  status: string;
  paid_date: string | null;
  created_at: string;
}

const CustomerInvoiceView = () => {
  const { token, invoiceId } = useParams<{ token: string; invoiceId?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      validateAndFetchInvoices();
    }
  }, [token, invoiceId]);

  const validateAndFetchInvoices = async () => {
    try {
      setLoading(true);

      // Validate token
      const { data: custId, error: tokenError } = await supabase.rpc(
        "validate_customer_token",
        { p_token: token }
      );

      if (tokenError || !custId) {
        setError("Invalid or expired link.");
        return;
      }

      setCustomerId(custId);

      // Get customer's leads
      const { data: leads } = await supabase
        .from("leads")
        .select("id")
        .eq("customer_id", custId);

      const leadIds = leads?.map((l) => l.id) || [];

      if (leadIds.length === 0) {
        setInvoices([]);
        return;
      }

      // Fetch invoices for customer's leads
      const { data: invoicesData, error: invError } = await supabase
        .from("invoices")
        .select("*")
        .in("lead_id", leadIds)
        .order("created_at", { ascending: false });

      if (invError) throw invError;

      // Parse line_items for each invoice
      const parsedInvoices = (invoicesData || []).filter((inv: any) => !["void", "cancelled", "draft"].includes(String(inv.status || ""))).map((inv) => ({
        ...inv,
        line_items: Array.isArray(inv.line_items)
          ? inv.line_items
          : typeof inv.line_items === "string"
          ? JSON.parse(inv.line_items)
          : [],
      })) as Invoice[];

      await attachPaymentTotals(parsedInvoices as any[]);
      setInvoices([...parsedInvoices]);

      // If specific invoice requested, select it
      if (invoiceId) {
        const found = parsedInvoices.find((i) => i.id === invoiceId);
        setSelectedInvoice(found || null);
      }

    } catch (err) {
      console.error("Error:", err);
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Invoice Detail View — mobile first (Johan 30 Oct): amount due, due date, how to pay, short lines; details collapsed.
  if (selectedInvoice) {
    const inv: any = selectedInvoice;
    const prof = documentProfile(inv, []);
    const bank = profileBanking(prof);
    const brand = prof?.trading_name || prof?.legal_name || null;
    const total = Number(inv.grand_total) || 0;
    const due = inv.status === "paid" ? 0 : (inv.remaining ?? total);
    const paidSoFar = Math.max(0, Math.round((total - due) * 100) / 100);
    const money = (n: number) => formatRand(Number(n) || 0);
    const dueDate = inv.due_date ? format(new Date(inv.due_date + "T00:00:00"), "d MMMM yyyy") : null;
    const overdue = inv.due_date && due > 0 && new Date(inv.due_date + "T23:59:59") < new Date();
    const items = selectedInvoice.line_items || [];
    const short = items.slice(0, 4);
    const bankRows = bank ? [["Account name", bank.account_name], ["Bank", bank.bank_name], ["Account", bank.account_number], ["Branch code", bank.branch_code], ["Type", bank.account_type], ["Reference", inv.invoice_number]].filter(([, v]) => v) : [];
    const copy = (v: string) => { navigator.clipboard?.writeText(v).then(() => toast({ title: "Copied", description: v })).catch(() => {}); };
    return (
      <div className="min-h-screen bg-[#F3F6FA]">
        <header className="bg-primary text-white px-4 py-3 shadow-md print:hidden">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20 shrink-0" onClick={() => setSelectedInvoice(null)} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            {prof?.logo_url ? <img src={prof.logo_url} alt={brand || ""} className="h-9" /> : brand ? <span className="font-semibold truncate">{brand}</span> : <img src={logo} alt="" className="h-9" />}
            <span className="ml-auto text-sm opacity-90 shrink-0">{inv.invoice_number}</span>
          </div>
        </header>

        <main className="max-w-2xl mx-auto p-4 space-y-3">
          <section className="rounded-2xl bg-white p-5 shadow-sm text-center" data-testid="client-amount-due">
            {due > 0 ? (<>
              <p className="text-sm font-medium text-muted-foreground">Amount due</p>
              <p className="mt-1 text-[40px] leading-tight font-extrabold tabular-nums text-ink">{money(due)}</p>
              {dueDate && <p className={`mt-2 text-base font-semibold ${overdue ? "text-red-600" : "text-ink"}`} data-testid="client-due-date">{overdue ? "Overdue since" : "Due"} {dueDate}</p>}
              {paidSoFar > 0 && <p className="mt-1 text-sm text-muted-foreground">{money(paidSoFar)} of {money(total)} already paid, thank you</p>}
            </>) : (
              <p className="flex items-center justify-center gap-2 text-xl font-bold text-green-600"><CheckCircle className="h-6 w-6" /> Paid in full, thank you</p>
            )}
          </section>

          {due > 0 && (
            <section className="rounded-2xl bg-white p-5 shadow-sm space-y-3 print:hidden" data-testid="client-pay">
              <h2 className="text-base font-bold text-ink">How to pay</h2>
              <PayfastPayButton invoiceId={inv.id} invoiceNumber={inv.invoice_number} amount={due} customerEmail={null} customerName={inv.customer_name}
                returnUrl={token ? publicCustomerUrl(token, invoiceId ? `invoice/${invoiceId}` : "") : undefined}
                cancelUrl={token ? publicCustomerUrl(token, invoiceId ? `invoice/${invoiceId}` : "") : undefined} />
              {bankRows.length > 0 && (
                <div className="rounded-xl border bg-[#F8FAFC] p-3">
                  <p className="mb-2 text-sm font-semibold text-ink">Bank details (EFT)</p>
                  <dl className="space-y-1.5 text-sm">
                    {bankRows.map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between gap-3">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="flex items-center gap-2 font-medium text-ink text-right">{v}
                          {(k === "Account" || k === "Reference" || k === "Branch code") && <button type="button" className="text-xs font-semibold leading-none text-primary" onClick={() => copy(String(v))}>Copy</button>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">Please use {inv.invoice_number} as the reference.</p>
                </div>
              )}
            </section>
          )}

          <section className="rounded-2xl bg-white p-5 shadow-sm" data-testid="client-lines">
            <h2 className="mb-2 text-base font-bold text-ink">What it's for</h2>
            <ul className="divide-y text-sm">
              {short.map((it, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2">
                  <span className="min-w-0 text-ink">{Number(it.quantity) > 1 ? `${it.quantity} × ` : ""}{it.description}</span>
                  <span className="shrink-0 tabular-nums font-medium">{money(it.total)}</span>
                </li>
              ))}
            </ul>
            {items.length > short.length && <p className="pt-1 text-xs text-muted-foreground">+ {items.length - short.length} more in the details below</p>}
            <div className="mt-2 flex justify-between border-t pt-2 text-sm font-semibold"><span>Invoice total (incl. VAT)</span><span className="tabular-nums">{money(total)}</span></div>
          </section>

          <details className="rounded-2xl bg-white p-5 shadow-sm group" data-testid="client-details">
            <summary className="cursor-pointer list-none text-base font-bold text-ink flex items-center justify-between">Invoice details <span className="text-sm font-medium text-primary group-open:hidden">Show</span><span className="text-sm font-medium text-primary hidden group-open:inline">Hide</span></summary>
            <div className="mt-3 space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><p className="text-muted-foreground">Invoice</p><p className="font-medium">{inv.invoice_number}</p></div>
                <div><p className="text-muted-foreground">Date</p><p className="font-medium">{format(new Date(inv.issue_date || inv.created_at), "d MMM yyyy")}</p></div>
              </div>
              <div>
                <p className="text-muted-foreground">Bill to</p>
                <p className="font-medium">{inv.customer_name}</p>
                {inv.customer_address && <p className="text-muted-foreground">{inv.customer_address}</p>}
                {inv.billed_to_vat_number && String(inv.billed_to_vat_number).trim() && <p className="text-muted-foreground" data-testid="billed-to-vat">VAT No {String(inv.billed_to_vat_number).trim()}</p>}
              </div>
              {prof?.legal_name && <div><p className="text-muted-foreground">From</p><p className="font-medium">{prof.legal_name}</p>{(prof as any).vat_number && <p className="text-muted-foreground">VAT No {(prof as any).vat_number}</p>}</div>}
              <ul className="divide-y">
                {items.map((it, i) => (
                  <li key={i} className="py-2">
                    <div className="flex justify-between gap-3"><span className="min-w-0">{it.description}</span><span className="shrink-0 tabular-nums">{money(it.total)}</span></div>
                    <p className="text-xs text-muted-foreground">{it.quantity} × {money(it.unitPrice)}</p>
                  </li>
                ))}
              </ul>
              <div className="space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{money(inv.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">VAT ({inv.tax_rate}%)</span><span className="tabular-nums">{money(inv.tax_amount)}</span></div>
                <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(total)}</span></div>
                {paidSoFar > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Paid</span><span className="tabular-nums">−{money(paidSoFar)}</span></div>}
                <div className="flex justify-between font-bold"><span>Amount due</span><span className="tabular-nums">{money(due)}</span></div>
              </div>
              {inv.notes && <div className="rounded-lg bg-muted p-3"><p className="text-xs text-muted-foreground mb-1">Notes</p><p>{inv.notes}</p></div>}
              <Button onClick={handlePrint} variant="outline" className="w-full print:hidden"><Download className="h-4 w-4 mr-2" />Download / Print</Button>
            </div>
          </details>
        </main>
      </div>
    );
  }

  // Invoice List View
  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-primary text-white p-4 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => navigate(`/customer/${token}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logo} alt="Be Cool" className="h-10" />
          <h1 className="font-bold">Your Invoices</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4">
        {invoices.length === 0 ? (
          <Card className="text-center py-8">
            <CardContent>
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No invoices yet</p>
            </CardContent>
          </Card>
        ) : (
          invoices.map((invoice) => (
            <Card
              key={invoice.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedInvoice(invoice)}
            >
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">{invoice.invoice_number}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {format(new Date(invoice.created_at), "dd MMM yyyy")}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold">R {Number(invoice.grand_total).toFixed(2)}</p>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      className={
                        invoice.status === "paid"
                          ? "bg-green-500"
                          : invoice.status === "sent"
                          ? "bg-blue-500"
                          : "bg-gray-500"
                      }
                    >
                      {invoice.status}
                    </Badge>
                    <DepositPaymentChip invoice={invoice} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
};

export default CustomerInvoiceView;
