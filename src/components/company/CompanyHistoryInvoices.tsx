import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/providers/CompanyProvider";
import { historyTotals, invoiceBalanceOf, isCollectibleInvoice, type HistoryInvoice } from "@/lib/companyHistory";
import { recordInvoicePayment } from "@/lib/payments";
import { formatRand } from "@/utils/formatRand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Detail = {
  invoice: HistoryInvoice & { company_id: string };
  lines: { id: string; description: string | null; line_name: string | null; quantity: number; unit_price: number; amount: number }[];
  payments: { id: string; amount: number; status: string | null; method: string | null; reference: string | null; payment_date: string | null }[];
};

async function loadList(companyId: string): Promise<HistoryInvoice[]> {
  const { data, error } = await supabase.rpc("company_history_invoices", { p_company: companyId });
  if (error) throw new Error(error.message);
  return (data || []) as HistoryInvoice[];
}

async function loadDetail(companyId: string, invoiceId: string): Promise<Detail> {
  const { data, error } = await supabase.rpc("company_history_invoice", { p_company: companyId, p_invoice: invoiceId });
  if (error) throw new Error(error.message);
  return data as Detail;
}

/** Read-only imported invoices for one archived company. No create, send, edit, or delete. */
export default function CompanyHistoryInvoices({ companyId }: { companyId: string }) {
  const { company } = useCompany();
  const paymentsLocked = !!company?.dormant_payments_locked;
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["company-history-invoices", companyId],
    queryFn: () => loadList(companyId),
  });
  const detail = useQuery({
    queryKey: ["company-history-invoice", companyId, openId],
    queryFn: () => loadDetail(companyId, openId!),
    enabled: !!openId,
  });

  if (list.isLoading) return <p className="text-sm text-muted-foreground">Loading invoices…</p>;
  if (list.isError) return <p role="alert" className="text-sm text-destructive" data-testid="history-invoice-error">{list.error instanceof Error ? list.error.message : "Couldn't load invoices"}</p>;

  const rows = list.data || [];
  const totals = historyTotals(rows);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((r) => `${r.invoice_number || ""} ${r.customer_name || ""} ${r.status || ""}`.toLowerCase().includes(needle))
    : rows;
  const shown = openId ? rows.find((r) => r.id === openId) : null;

  const record = async (balance: number) => {
    const amount = Math.round((Number(payAmount) || balance) * 100) / 100;
    if (!(amount > 0) || amount - balance > 0.005) { setPayError("Enter an amount up to the balance."); return; }
    setPaying(true);
    setPayError(null);
    try {
      await recordInvoicePayment({ invoiceId: openId!, amount, method: "eft" });
      setPayAmount("");
      await qc.invalidateQueries({ queryKey: ["company-history-invoices", companyId] });
      await qc.invalidateQueries({ queryKey: ["company-history-invoice", companyId, openId] });
    } catch (e) {
      setPayError(e instanceof Error ? e.message : "Payment was not saved");
    } finally {
      setPaying(false);
    }
  };

  if (shown) {
    const d = detail.data;
    const balance = invoiceBalanceOf(shown);
    const collect = isCollectibleInvoice(shown);
    return (
      <div className="space-y-4" data-testid="history-invoice-detail">
        <Button variant="outline" size="sm" onClick={() => setOpenId(null)}>Back to invoices</Button>
        <div>
          <h2 className="text-xl font-bold">{shown.invoice_number || "Invoice"}</h2>
          <p className="text-sm text-muted-foreground">{shown.customer_name || "—"} · {shown.status || "—"}{shown.archived_at ? " · archived invoice" : ""}{shown.customer_status === "archived" ? " · archived client" : ""}</p>
        </div>
        {detail.isError ? <p role="alert" className="text-sm text-destructive">{detail.error instanceof Error ? detail.error.message : "Couldn't load this invoice"}</p> : null}
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left text-muted-foreground"><th className="py-2">Line</th><th>Qty</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {(d?.lines || []).map((line) => (
              <tr key={line.id} className="border-b border-border/50" data-testid="history-line">
                <td className="py-2">{line.line_name || line.description || "—"}</td>
                <td>{line.quantity}</td>
                <td className="text-right">{formatRand(Number(line.amount) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div>
          <p className="font-medium">Payments</p>
          {(d?.payments || []).length === 0 ? <p className="text-sm text-muted-foreground">No payments.</p> : (d?.payments || []).map((p) => (
            <p key={p.id} className="text-sm" data-testid="history-payment">{formatRand(Number(p.amount) || 0)} · {p.status || "—"} · {p.payment_date || "—"} {p.reference || ""}</p>
          ))}
        </div>
        <p className="text-sm">Total {formatRand(Number(shown.grand_total) || 0)} · Paid {formatRand(Number(shown.paid) || 0)} · Balance {formatRand(balance)}</p>
        {collect && !paymentsLocked ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">Record payment
              <Input className="mt-1 w-36" inputMode="decimal" value={payAmount} placeholder={balance.toFixed(2)} onChange={(e) => setPayAmount(e.target.value)} />
            </label>
            <Button size="sm" disabled={paying} onClick={() => void record(balance)}>{paying ? "Saving…" : "Save payment"}</Button>
            {payError ? <p className="text-sm text-destructive">{payError}</p> : null}
          </div>
        ) : <p className="text-sm text-muted-foreground">{paymentsLocked && collect ? "Payments on this company are locked." : "History only — not in the amount still to collect."}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="history-invoices">
      <div>
        <h2 className="text-2xl font-bold">Invoices</h2>
        <p className="text-sm text-muted-foreground" data-testid="history-invoice-totals">{totals.count} imported · history {formatRand(totals.history)} · still to collect {formatRand(totals.collectible)} · paid {formatRand(totals.paid)}</p>
        <p className="text-sm text-muted-foreground">Still to collect leaves out archived invoices, archived clients, drafts, void and cancelled. History is every imported invoice for this company.</p>
      </div>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search invoices..." className="max-w-sm" aria-label="Search invoices" />
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3">Invoice #</th>
              <th className="px-4 py-3">Client</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3">Due</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{rows.length === 0 ? "No invoices found" : "No invoices match that search"}</td></tr>
            ) : visible.map((inv) => (
              <tr key={inv.id} className="cursor-pointer border-b hover:bg-muted/30" data-testid="history-invoice-row" onClick={() => setOpenId(inv.id)}>
                <td className="px-4 py-3 font-medium text-blue-600">{inv.invoice_number || "—"}</td>
                <td className="px-4 py-3">{inv.customer_name || "—"}</td>
                <td className="px-4 py-3 text-right">{formatRand(Number(inv.grand_total) || 0)}</td>
                <td className="px-4 py-3 text-right">{Number(inv.paid) > 0 ? formatRand(Number(inv.paid)) : "—"}</td>
                <td className="px-4 py-3">{inv.due_date || "—"}</td>
                <td className="px-4 py-3"><Badge variant="outline">{isCollectibleInvoice(inv) ? "To collect" : (inv.status || "History")}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
