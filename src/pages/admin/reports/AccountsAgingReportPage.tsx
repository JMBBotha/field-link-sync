import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportShell from "@/components/reports/ReportShell";
import { formatRand } from "@/utils/formatRand";

interface AgingRow {
  invoice_id: string;
  invoice_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  issue_date: string | null;
  effective_due_date: string | null;
  grand_total: number | null;
  paid_amount: number | null;
  balance_due: number | null;
  aging_bucket: string | null;
}

const BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"] as const;

/** Maps whatever label the view returns onto our display buckets. */
const normalizeBucket = (raw: string | null): (typeof BUCKETS)[number] => {
  const b = (raw || "").toLowerCase();
  if (b.includes("90") && (b.includes("+") || b.includes("over") || b.includes("more"))) return "90+";
  if (b.includes("61") || b.includes("90")) return "61-90";
  if (b.includes("31") || b.includes("60")) return "31-60";
  if (b.includes("1-30") || b.includes("30")) return "1-30";
  return "Current";
};

const AccountsAgingReportPage = () => {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["v_accounts_aging"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_accounts_aging" as any)
        .select("*")
        .order("customer_name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as AgingRow[];
    },
  });

  const rows = useMemo(
    () =>
      data.filter((r) => {
        const d = r.issue_date || "";
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [data, from, to]
  );

  const byClient = useMemo(() => {
    const map = new Map<string, { name: string; buckets: Record<string, number>; total: number }>();
    rows.forEach((r) => {
      const key = r.customer_id || r.customer_name || "unknown";
      const entry =
        map.get(key) ||
        { name: r.customer_name || "Unknown client", buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])), total: 0 };
      const amount = Number(r.balance_due || 0);
      entry.buckets[normalizeBucket(r.aging_bucket)] += amount;
      entry.total += amount;
      map.set(key, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const totals = useMemo(() => {
    const t: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
    let grand = 0;
    byClient.forEach((c) => {
      BUCKETS.forEach((b) => (t[b] += c.buckets[b]));
      grand += c.total;
    });
    return { t, grand };
  }, [byClient]);

  const exportRows = byClient.map((c) => ({
    Client: c.name,
    ...Object.fromEntries(BUCKETS.map((b) => [b, c.buckets[b].toFixed(2)])),
    Total: c.total.toFixed(2),
  }));

  return (
    <ReportShell
      title="Accounts Aging"
      subtitle="Outstanding invoice balances per client, bucketed by how overdue they are."
      dateRange={{ from, to, onFromChange: setFrom, onToChange: setTo }}
      exportRows={exportRows}
      exportFilename="accounts-aging"
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60">
            <TableHead>Client</TableHead>
            {BUCKETS.map((b) => (
              <TableHead key={b} className="text-right">
                {b === "Current" ? "Current" : `${b} days`}
              </TableHead>
            ))}
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={BUCKETS.length + 2} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : byClient.length === 0 ? (
            <TableRow>
              <TableCell colSpan={BUCKETS.length + 2} className="py-10 text-center text-muted-foreground">
                No outstanding balances for this period.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {byClient.map((c) => (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  {BUCKETS.map((b) => (
                    <TableCell key={b} className="text-right tabular-nums">
                      {formatRand(c.buckets[b])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">{formatRand(c.total)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Grand total</TableCell>
                {BUCKETS.map((b) => (
                  <TableCell key={b} className="text-right tabular-nums">
                    {formatRand(totals.t[b])}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">{formatRand(totals.grand)}</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </ReportShell>
  );
};

export default AccountsAgingReportPage;
