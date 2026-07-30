import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import ReportShell from "@/components/reports/ReportShell";
import { formatRand } from "@/utils/formatRand";

interface VatRow {
  period_month: string | null;
  invoice_count: number | null;
  total_excl_vat: number | null;
  total_vat_collected: number | null;
  total_incl_vat: number | null;
}

const monthLabel = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("en-ZA", { month: "long", year: "numeric" }) : "—";

const VatSummaryReportPage = () => {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data = [], isLoading } = useQuery({
    queryKey: ["v_vat_summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_vat_summary" as any)
        .select("*")
        .order("period_month", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as VatRow[];
    },
  });

  const rows = useMemo(
    () =>
      data.filter((r) => {
        const d = r.period_month || "";
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    [data, from, to]
  );

  const totals = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + Number(r.invoice_count || 0),
      excl: acc.excl + Number(r.total_excl_vat || 0),
      vat: acc.vat + Number(r.total_vat_collected || 0),
      incl: acc.incl + Number(r.total_incl_vat || 0),
    }),
    { invoices: 0, excl: 0, vat: 0, incl: 0 }
  );

  const exportRows = rows.map((r) => ({
    Period: monthLabel(r.period_month),
    Invoices: r.invoice_count || 0,
    Subtotal: Number(r.total_excl_vat || 0).toFixed(2),
    "VAT (15%)": Number(r.total_vat_collected || 0).toFixed(2),
    Total: Number(r.total_incl_vat || 0).toFixed(2),
  }));

  return (
    <ReportShell
      title="VAT Summary"
      subtitle="VAT (15%) collected per month, with subtotal, VAT and VAT-inclusive totals for SARS reporting."
      dateRange={{ from, to, onFromChange: setFrom, onToChange: setTo }}
      exportRows={exportRows}
      exportFilename="vat-summary"
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60">
            <TableHead>Period</TableHead>
            <TableHead className="text-right">Invoices</TableHead>
            <TableHead className="text-right">Subtotal (excl. VAT)</TableHead>
            <TableHead className="text-right">VAT (15%)</TableHead>
            <TableHead className="text-right">Total (incl. VAT)</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No VAT data for this period.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((r) => (
                <TableRow key={r.period_month}>
                  <TableCell className="font-medium">{monthLabel(r.period_month)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoice_count || 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(Number(r.total_excl_vat || 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRand(Number(r.total_vat_collected || 0))}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRand(Number(r.total_incl_vat || 0))}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{totals.invoices}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.excl)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.vat)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.incl)}</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </ReportShell>
  );
};

export default VatSummaryReportPage;
