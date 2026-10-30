import { SentManuallyBadge } from "@/components/documents/MarkSentManually";
import { useRole } from "@/hooks/useRole";
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { invoiceMoney, matchesMoneyFilter, type MoneyFilter } from "@/lib/moneySummary";
import ListCard from "@/components/cards/ListCard";
import { FileText, Filter, ChevronRight, Loader2, Search, Plus, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { exportToCSV } from "@/lib/csvExport";
import DepositPaymentChip from "@/components/shared/DepositPaymentChip";
import { attachPaymentTotals } from "@/lib/depositInvoice";
import { fetchCreditNotes, type CreditNoteRow } from "@/lib/creditNotes";
import jsPDF from "jspdf";
import { formatRand } from "@/utils/formatRand";
import { parseInvoiceParams, filterInvoices, matchesInvoiceState, clearParams, resolveMoneyFilter, MONEY_LABEL } from "@/lib/drilldown";
import RowMenu from "@/components/shared/RowMenu";
import { useNavigate } from "react-router-dom";
import { buildDepositWhatsAppUrl } from "@/lib/depositShare";
import { publicQuoteUrl } from "@/lib/publicAppUrl";
import { useToast } from "@/hooks/use-toast";
import FilterChips from "@/components/shared/FilterChips";
import { Checkbox } from "@/components/ui/checkbox";
import CreateContractDialog from "@/components/agreements/CreateContractDialog";
import ContractEditorDialog from "@/components/agreements/ContractEditorDialog";
import { sameClientCheck } from "@/lib/agreementTemplates/contracts";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import { InvoiceDueChip, FollowupReview } from "@/components/invoiceDue/InvoiceDueChip";

interface Invoice {
  id: string;
  invoice_number: string;
  customer_name: string;
  grand_total: number;
  status: string;
  created_at: string;
  lead_id: string;
  agent_id: string;
  due_date: string | null;
  paid_date: string | null;
  issue_date: string;
}

interface InvoiceListPageProps {
  agentId?: string;
  onSelectInvoice: (invoice: Invoice) => void;
  onCreateInvoice: () => void;
}

const statusFilters = [
  { value: "all", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "draft", label: "Draft" },
  { value: "sent", label: "Sent" },
  { value: "paid", label: "Paid" },
  { value: "overdue", label: "Overdue" },
  { value: "void", label: "Void" },
];

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "bg-muted", text: "text-muted-foreground", label: "Draft" },
    sent: { bg: "bg-blue-500", text: "text-white", label: "Sent" },
    paid: { bg: "bg-green-500", text: "text-white", label: "Paid" },
    overdue: { bg: "bg-red-500", text: "text-white", label: "Overdue" },
    partially_paid: { bg: "bg-amber-500", text: "text-white", label: "Part paid" },
    part_paid: { bg: "bg-amber-500", text: "text-white", label: "Part paid" },
    void: { bg: "bg-muted", text: "text-muted-foreground", label: "Void" },
    cancelled: { bg: "bg-muted", text: "text-muted-foreground", label: "Cancelled" },
  };
  const c = config[status] || { bg: "bg-muted", text: "text-muted-foreground", label: status };
  return <Badge className={`${c.bg} ${c.text} text-xs px-2 py-0.5`}>{c.label}</Badge>;
};

const formatCurrency = (amount: number) =>
  formatRand(Number(amount) || 0);

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

const InvoiceListPage = ({ agentId, onSelectInvoice, onCreateInvoice }: InvoiceListPageProps) => {
  const { isAdmin } = useRole();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // Multi-select -> "Create service contract" (same client only, Johan 18 Oct 2026)
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [contractOpen, setContractOpen] = useState(false);
  const [openContractId, setOpenContractId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const { byInvoice: dueBy } = useInvoiceDue();
  const dueFilter = searchParams.get("due");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const inf = parseInvoiceParams(searchParams);
  const filter = inf.state ?? "all";
  const setParam = (k: string, v: string | null) =>
    setSearchParams((p) => { const n = new URLSearchParams(p); if (v && v !== "all") n.set(k, v); else n.delete(k); return n; });
  const setFilter = (v: string) => setParam("state", v);
  const moneyFilter = resolveMoneyFilter(searchParams) as MoneyFilter | null;
  const moneyIsAlias = !!moneyFilter && !searchParams.get("money");
  const navigate = useNavigate();
  const { toast } = useToast();
  // Existing share path: public quote page carries the deposit pay block (ClientDepositActions).
  const sendPayLink = async (inv: any) => {
    const { data } = inv.quote_id
      ? await supabase.from("quotes").select("public_token").eq("id", inv.quote_id).maybeSingle()
      : { data: null as any };
    if (!data?.public_token) { toast({ title: "No pay link", description: "This invoice isn't linked to a shared quote." , variant: "destructive" }); return; }
    window.open(buildDepositWhatsAppUrl(inv.invoice_number, Number(inv.grand_total) || 0, publicQuoteUrl(data.public_token)), "_blank", "noopener");
  };
  const [payRows, setPayRows] = useState<any[]>([]);
  const [creditRows, setCreditRows] = useState<CreditNoteRow[]>([]);

  useEffect(() => {
    fetchInvoices();
  }, [agentId]);

  const fetchInvoices = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("invoices")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching invoices:", error);
    } else {
      let results = (data as unknown as Invoice[]) || [];
      if (agentId) {
        results = results.filter(inv => inv.agent_id === agentId);
      }
      await attachPaymentTotals(results as any[]);
      if (results.length) {
        const { data: pays } = await supabase.from("payments").select("invoice_id, amount, status, gateway").in("invoice_id", results.map(r => r.id));
        setPayRows(pays || []);
        setCreditRows(await fetchCreditNotes(results.map(r => r.id)));
      }
      setInvoices([...results]);
    }
    setLoading(false);
  };

  const archivedCount = invoices.filter((i: any) => i.archived_at).length;
  const archiveInvoice = async (inv: Invoice, archive: boolean) => {
    const { error } = await (supabase.rpc as any)("archive_void_invoice", { p_invoice_id: inv.id, p_archive: archive });
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    toast({ title: archive ? `${inv.invoice_number} archived` : `${inv.invoice_number} restored` });
    fetchInvoices();
  };
  const filteredInvoices = filterInvoices(invoices.filter((i: any) => showArchived ? !!i.archived_at : !i.archived_at), inf)
    .filter(inv => {
      if (!dueFilter) return true;
      const d = dueBy.get(inv.id); if (!d) return false;
      return dueFilter === "overdue" ? d.days > 0 : dueFilter === "today" ? d.days === 0 : dueFilter === "soon" ? d.days < 0 && d.days >= -7 : true;
    })
    .filter(inv => {
      if (!moneyFilter) return true;
      const { paid, balance } = invoiceMoney(inv as any, payRows, creditRows);
      return matchesMoneyFilter(inv as any, paid, balance, moneyFilter);
    })
    .filter(inv =>
      !search ||
      inv.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      inv.invoice_number.toLowerCase().includes(search.toLowerCase())
    );

  // Summary stats
  // Shared maths: outstanding = balances after payments/credits; collected counts partial payments.
  const totalOutstanding = invoices
    .filter(inv => matchesInvoiceState(inv.status, "unpaid"))
    .reduce((sum, inv) => sum + invoiceMoney(inv as any, payRows, creditRows).balance, 0);
  const totalPaid = invoices
    .filter(inv => !["void", "cancelled"].includes((inv.status || "").toLowerCase()))
    .reduce((sum, inv) => sum + invoiceMoney(inv as any, payRows, creditRows).paid, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const handleCSVExport = () => {
    if (!isAdmin) return;
    const rows = filteredInvoices.map(inv => ({
      invoice: inv.invoice_number,
      customer: inv.customer_name,
      amount: inv.grand_total,
      status: inv.status,
      issued: inv.issue_date,
      due: inv.due_date || "",
      paid: inv.paid_date || "",
    }));
    exportToCSV(rows, `invoices-${new Date().toISOString().split("T")[0]}`);
  };

  const handlePDFExport = () => {
    if (!isAdmin) return;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Invoice Report", 14, 20);
    doc.setFontSize(9);
    doc.text(`Generated: ${new Date().toLocaleDateString("en-ZA")}`, 14, 28);
    doc.text(`Outstanding: ${formatCurrency(totalOutstanding)} | Collected: ${formatCurrency(totalPaid)}`, 14, 34);

    let y = 44;
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Invoice #", 14, y);
    doc.text("Customer", 50, y);
    doc.text("Amount", 120, y);
    doc.text("Status", 155, y);
    doc.text("Date", 180, y);
    y += 6;
    doc.setFont("helvetica", "normal");

    filteredInvoices.forEach(inv => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(inv.invoice_number, 14, y);
      doc.text(inv.customer_name?.slice(0, 35) || "", 50, y);
      doc.text(formatCurrency(inv.grand_total), 120, y);
      doc.text(inv.status, 155, y);
      doc.text(formatDate(inv.issue_date), 180, y);
      y += 5;
    });

    doc.save(`invoices-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  return (
    <div className="v8-scope w-full space-y-4 p-4 sm:p-6 pb-[calc(env(safe-area-inset-bottom)+5rem)] sm:pb-[calc(env(safe-area-inset-bottom)+5rem)] lg:pb-10" data-testid="invoice-list" /* last row scrolls clear of the bottom nav / sticky bars (Johan 13 Oct) */>
      {/* Page header */}
      <div className="v8-navy flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {invoices.length} invoice{invoices.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button variant="cta" onClick={onCreateInvoice} className="gap-2">
          <Plus className="h-4 w-4" /> New Invoice
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Card role="button" tabIndex={0} onClick={() => setFilter("unpaid")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFilter("unpaid"); } }}
          className={`border-0 shadow-sm cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === "unpaid" ? "ring-2 ring-primary" : ""}`}>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Outstanding</p>
            <p className="text-lg font-bold text-orange-600 dark:text-orange-300">{formatCurrency(totalOutstanding)}</p>
          </CardContent>
        </Card>
        <Card role="button" tabIndex={0} onClick={() => setFilter("paid")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setFilter("paid"); } }}
          className={`border-0 shadow-sm cursor-pointer hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${filter === "paid" ? "ring-2 ring-primary" : ""}`}>
          <CardContent className="p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Collected</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-300">{formatCurrency(totalPaid)}</p>
          </CardContent>
        </Card>
      </div>


      {/* Export Buttons: bulk export is owner/admin only (POPIA) */}
      {isAdmin && <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCSVExport}>
          <Download className="h-3 w-3 mr-1" />CSV
        </Button>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handlePDFExport}>
          <FileText className="h-3 w-3 mr-1" />PDF
        </Button>
      </div>}

      <FilterChips
        shown={filteredInvoices.length}
        chips={[
          ...(moneyIsAlias ? [{ key: "kind", label: MONEY_LABEL[moneyFilter as keyof typeof MONEY_LABEL] }] : []),
          ...(inf.state ? [{ key: "state", label: inf.state === "unpaid" ? "Unpaid (sent + overdue)" : `State: ${inf.state}` }] : []),
          ...(inf.period ? [{ key: "period", label: inf.period === "today" ? "Today" : /d$/.test(inf.period) ? `Last ${inf.period.replace("d", "")} days` : inf.period }] : []),
        ]}
        onClear={(k) => setSearchParams((p) => clearParams(p, k === "kind" ? ["kind", "state"] : [k]))}
        onClearAll={() => setSearchParams((p) => clearParams(p, ["state", "period", "money", "kind"]))}
      />

      {moneyFilter && !moneyIsAlias && (
        <button onClick={() => setSearchParams((p) => clearParams(p, ["money"]))} className="text-xs rounded-full bg-primary text-primary-foreground px-3 py-1">
          {moneyFilter.replace("_", " ")} · clear ✕
        </button>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search invoices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-10 rounded-xl"
        />
      </div>

      {/* Filter Pills */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {statusFilters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {f.label}
            {f.value !== "all" && (
              <span className="ml-1 opacity-70">
                {filterInvoices(invoices, { state: f.value as any }).length}
              </span>
            )}
          </button>
        ))}
        {(archivedCount > 0 || showArchived) && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
              showArchived ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            Archived <span className="ml-1 opacity-70">{archivedCount}</span>
          </button>
        )}
      </div>

      {/* Create Invoice Button */}
      <Button
        onClick={onCreateInvoice}
        variant="outline"
        className="w-full h-11 rounded-xl font-semibold gap-2"
      >
        <Plus className="h-4 w-4" />
        Create New Invoice
      </Button>

      {/* Invoice List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? "s" : ""}
          </p>
          {!selectMode && (
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSelectMode(true)} data-testid="invoice-select-mode">Select for service contract</Button>
          )}
        </div>

        {selectMode && (() => {
          const picked = invoices.filter((i) => selected.includes(i.id));
          const check = sameClientCheck(picked.map((i) => ({ id: i.id, customer_id: (i as any).customer_id ?? null, label: i.invoice_number })));
          return (
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-sm backdrop-blur" data-testid="invoice-contract-bar">
              <span className="text-sm font-medium">{selected.length} selected</span>
              {selected.length > 0 && "reason" in check && <span className="text-xs text-destructive" data-testid="same-client-warning">{check.reason}</span>}
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setSelectMode(false); setSelected([]); }}>Cancel</Button>
                <Button size="sm" variant="cta" disabled={!check.ok} onClick={() => setContractOpen(true)} data-testid="invoice-create-contract">Create service contract</Button>
              </div>
            </div>
          );
        })()}
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No invoices found</p>
          </div>
        ) : (
          filteredInvoices.map((invoice) => { const due = dueBy.get(invoice.id); return (
            <div key={invoice.id}>
            <ListCard
              onOpen={() => (selectMode ? setSelected((s) => (s.includes(invoice.id) ? s.filter((x) => x !== invoice.id) : [...s, invoice.id])) : onSelectInvoice(invoice))}
              leading={selectMode ? <Checkbox checked={selected.includes(invoice.id)} aria-label={`Select ${invoice.invoice_number}`}
                onCheckedChange={() => setSelected((s) => (s.includes(invoice.id) ? s.filter((x) => x !== invoice.id) : [...s, invoice.id]))} /> : undefined}
              stacked
              title={invoice.customer_name || invoice.invoice_number}
              chip={<>{getStatusBadge(invoice.status)}<DepositPaymentChip invoice={invoice} className="text-xs px-2 py-0.5" />{due && <InvoiceDueChip row={due} onClick={() => setReviewId(reviewId === invoice.id ? null : invoice.id)} />}</>}
              amount={(() => { const m = invoiceMoney(invoice as any, payRows, creditRows); return ["paid", "void", "cancelled", "draft"].includes(invoice.status) ? formatCurrency(invoice.grand_total) : formatCurrency(m.balance); })()}
              date={[invoice.invoice_number, formatDate(invoice.created_at)].join(" · ")}
              trailing={<RowMenu items={[
                { label: "Open", onSelect: () => onSelectInvoice(invoice) },
                { label: "Record payment", onSelect: () => onSelectInvoice(invoice), hidden: invoice.status === "paid" },
                { label: "Send pay link (WhatsApp)", onSelect: () => sendPayLink(invoice), hidden: invoice.status === "paid" || !(invoice as any).quote_id },
                { label: "Open quote", onSelect: () => navigate(`/admin/quote-builder?quoteId=${(invoice as any).quote_id}`), hidden: !(invoice as any).quote_id, separatorBefore: true },
                { label: "Open client", onSelect: () => navigate(`/admin/customers/${(invoice as any).customer_id}`), hidden: !(invoice as any).customer_id },
                { label: (invoice as any).archived_at ? "Restore from archive" : "Archive", onSelect: () => archiveInvoice(invoice, !(invoice as any).archived_at), hidden: !["void", "cancelled"].includes(invoice.status), separatorBefore: true },
              ]} />} />
            {due && reviewId === invoice.id && <FollowupReview row={due} onDone={() => setReviewId(null)} />}
            </div>); })
        )}
      </div>
      {contractOpen && (() => {
        const picked = invoices.filter((i) => selected.includes(i.id));
        const check = sameClientCheck(picked.map((i) => ({ id: i.id, customer_id: (i as any).customer_id ?? null, label: i.invoice_number })));
        if (!("customerId" in check)) return null;
        return (
          <CreateContractDialog open onOpenChange={setContractOpen} customerId={check.customerId} customerName={picked[0]?.customer_name}
            invoiceIds={picked.map((i) => i.id)} onCreated={(id) => { setSelectMode(false); setSelected([]); setOpenContractId(id); }} />
        );
      })()}
      {openContractId && <ContractEditorDialog contractId={openContractId} onClose={() => setOpenContractId(null)} />}
    </div>
  );
};

export default InvoiceListPage;
