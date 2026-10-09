import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import ReportShell from "@/components/reports/ReportShell";
import { exportToCSV } from "@/lib/csvExport";
import { formatRand } from "@/utils/formatRand";
import { aggregateVat, KIND_LABEL, type VatCycle, type VatLine } from "@/lib/vatReport";

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** VAT report: output (invoices − credit notes) minus input (expenses) per SARS period; rate by document date. */
const VatSummaryReportPage = () => {
  const now = new Date();
  const [from, setFrom] = useState(iso(new Date(now.getFullYear() - 1, now.getMonth(), 1)));
  const [to, setTo] = useState(iso(now));
  const [cycle, setCycle] = useState<VatCycle>("B");

  const { data: lines = [], isLoading, error } = useQuery({
    queryKey: ["vat_report_lines", from, to],
    enabled: !!from && !!to,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("vat_report_lines", { p_from: from, p_to: to });
      if (error) throw error;
      return (data || []) as VatLine[];
    },
  });
  const periods = useMemo(() => aggregateVat(lines, cycle), [lines, cycle]);
  const tot = periods.reduce((a, p) => ({ out: a.out + p.outputVat - p.creditVat, inp: a.inp + p.inputVat, net: a.net + p.net, diffs: a.diffs + p.rateDiffs }), { out: 0, inp: 0, net: 0, diffs: 0 });

  const exportRows = periods.map((p) => ({
    Period: p.label, From: p.start, To: p.end,
    "Sales incl VAT": p.sales.toFixed(2), "Output VAT": p.outputVat.toFixed(2),
    "Credit notes incl VAT": p.credits.toFixed(2), "Credit note VAT": p.creditVat.toFixed(2),
    "Expenses incl VAT": p.purchases.toFixed(2), "Input VAT": p.inputVat.toFixed(2),
    "Net VAT payable": p.net.toFixed(2), Documents: p.docs,
  }));
  const exportLines = () =>
    exportToCSV(lines.map((l) => ({ Date: l.date, Type: KIND_LABEL[l.kind], Ref: l.ref || "", Party: l.party || "", "Amount incl VAT": Number(l.incl).toFixed(2), "VAT rate %": Number(l.rate), VAT: Number(l.vat).toFixed(2), "VAT on document": Number(l.stored_vat).toFixed(2) })), `vat-lines-${from}-to-${to}`);

  return (
    <ReportShell
      title="VAT Report"
      subtitle="Output VAT (invoices less credit notes) minus input VAT (expenses), per VAT period. Rate by document date: 14% before 1 April 2018, 15% from then."
      dateRange={{ from, to, onFromChange: setFrom, onToChange: setTo }}
      exportRows={exportRows}
      exportFilename={`vat-report-${from}-to-${to}`}
    >
      <div className="flex flex-wrap items-center gap-2 p-3" data-testid="vat-controls">
        <Select value={cycle} onValueChange={(v) => setCycle(v as VatCycle)}>
          <SelectTrigger className="h-9 w-[260px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="B">2-monthly (Category B: Jan–Feb …)</SelectItem>
            <SelectItem value="A">2-monthly (Category A: Dec–Jan …)</SelectItem>
            <SelectItem value="M">Monthly</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={exportLines} disabled={!lines.length} data-testid="vat-export-lines">Export document lines (CSV)</Button>
        {tot.diffs > 0 && <span className="text-xs text-amber-600">{tot.diffs} document(s) show a different VAT amount than the rate for their date; the report uses the dated rate.</span>}
      </div>
      {error && <p className="px-3 text-sm text-destructive">{(error as any).message}</p>}
      <div className="overflow-x-auto">
        <Table data-testid="vat-table">
          <TableHeader>
            <TableRow className="bg-muted/60">
              <TableHead>Period</TableHead>
              <TableHead className="text-right">Sales (incl.)</TableHead>
              <TableHead className="text-right">Output VAT</TableHead>
              <TableHead className="text-right">Credit-note VAT</TableHead>
              <TableHead className="text-right">Expenses (incl.)</TableHead>
              <TableHead className="text-right">Input VAT</TableHead>
              <TableHead className="text-right">Net VAT payable</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Loading…</TableCell></TableRow>
            ) : periods.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">No VAT data for this period.</TableCell></TableRow>
            ) : (
              <>
                {periods.map((p) => (
                  <TableRow key={p.start} data-testid="vat-period">
                    <TableCell className="whitespace-nowrap font-medium">{p.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(p.sales)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(p.outputVat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.creditVat ? `−${formatRand(p.creditVat)}` : formatRand(0)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(p.purchases)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.inputVat ? `−${formatRand(p.inputVat)}` : formatRand(0)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatRand(p.net)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell>Total</TableCell>
                  <TableCell colSpan={2} className="text-right tabular-nums">Output {formatRand(tot.out)}</TableCell>
                  <TableCell colSpan={3} className="text-right tabular-nums">Input {formatRand(tot.inp)}</TableCell>
                  <TableCell className="text-right tabular-nums" data-testid="vat-net-total">{formatRand(tot.net)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </ReportShell>
  );
};

export default VatSummaryReportPage;
