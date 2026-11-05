import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { historyTotals, type HistoryInvoice } from "@/lib/companyHistory";
import { formatRand } from "@/utils/formatRand";

type Col = { key: string; label: string };

async function load(rpc: string, companyId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await (supabase.rpc as any)(rpc, { p_company: companyId });
  if (error) throw new Error(error.message);
  return (data || []) as Record<string, unknown>[];
}

/** Read-only list of one imported table. No add or delete. */
export default function CompanyHistorySimple({ companyId, title, rpc, columns, testId }: {
  companyId: string;
  title: string;
  rpc: "company_history_quotes" | "company_history_customers" | "company_history_payments";
  columns: Col[];
  testId: string;
}) {
  const q = useQuery({ queryKey: [rpc, companyId], queryFn: () => load(rpc, companyId) });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Couldn't load"}</p>;
  const rows = q.data || [];
  return (
    <div className="space-y-3" data-testid={testId}>
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-sm text-muted-foreground">{rows.length} imported for this company</p>
      <div className="overflow-hidden rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-left text-muted-foreground">
              {columns.map((c) => <th key={c.key} className="px-4 py-3">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">None imported</td></tr>
            ) : rows.map((row, i) => (
              <tr key={String(row.id || i)} className="border-b">
                {columns.map((c) => <td key={c.key} className="px-4 py-3">{row[c.key] == null || row[c.key] === "" ? "—" : String(row[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CompanyHistorySummary({ companyId }: { companyId: string }) {
  const q = useQuery({
    queryKey: ["company-history-invoices", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("company_history_invoices", { p_company: companyId });
      if (error) throw new Error(error.message);
      return (data || []) as HistoryInvoice[];
    },
  });
  if (q.isLoading) return <p className="text-sm text-muted-foreground">Loading history…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-destructive">{q.error instanceof Error ? q.error.message : "Couldn't load history"}</p>;
  const t = historyTotals(q.data || []);
  return (
    <div className="space-y-2" data-testid="history-summary">
      <h2 className="text-2xl font-bold">History</h2>
      <p className="text-sm">{t.count} invoices · still to collect {formatRand(t.collectible)} · paid {formatRand(t.paid)}</p>
      <p className="text-sm text-muted-foreground">Open Invoices for lines and payments. Estimates, clients and payments on the left are this company only.</p>
    </div>
  );
}

export function ArchivedHistoryNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="space-y-2">
      <h2 className="text-2xl font-bold">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
