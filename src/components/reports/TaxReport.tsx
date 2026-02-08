import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Download, Loader2 } from "lucide-react";
import { exportToCSV } from "@/lib/csvExport";

const formatZAR = (n: number) => `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;

interface Props {
  startDate: string;
  endDate: string;
}

const TaxReport = ({ startDate, endDate }: Props) => {
  const { data: invoices = [], isLoading: loadingInv } = useQuery({
    queryKey: ["report-tax-invoices", startDate, endDate],
    queryFn: async () => {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, subtotal, tax_amount, grand_total, status, issue_date")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .eq("status", "paid");
      return data || [];
    },
  });

  const { data: expenses = [], isLoading: loadingExp } = useQuery({
    queryKey: ["report-tax-expenses", startDate, endDate],
    queryFn: async () => {
      const { data } = await supabase
        .from("job_expenses")
        .select("id, description, amount, expense_date")
        .gte("expense_date", startDate)
        .lte("expense_date", endDate);
      return data || [];
    },
  });

  const totalSubtotal = invoices.reduce((s, i) => s + Number(i.subtotal), 0);
  const totalVAT = invoices.reduce((s, i) => s + Number(i.tax_amount), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.grand_total), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const netRevenue = totalSubtotal - totalExpenses;

  const handleExport = () => {
    const rows = [
      { Description: "Total Revenue (excl. VAT)", Amount: totalSubtotal.toFixed(2) },
      { Description: "Total VAT Collected (15%)", Amount: totalVAT.toFixed(2) },
      { Description: "Total Invoiced (incl. VAT)", Amount: totalInvoiced.toFixed(2) },
      { Description: "Total Expenses", Amount: totalExpenses.toFixed(2) },
      { Description: "Net Revenue", Amount: netRevenue.toFixed(2) },
      { Description: "---", Amount: "---" },
      ...invoices.map((i) => ({
        Description: `Invoice ${i.invoice_number} - ${i.customer_name}`,
        Amount: Number(i.grand_total).toFixed(2),
      })),
    ];
    exportToCSV(rows, `sars-tax-report-${startDate}-${endDate}`);
  };

  if (loadingInv || loadingExp) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl shadow-lg border-0 border-t-4 border-t-primary">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">SARS Tax Summary</CardTitle>
            <p className="text-xs text-muted-foreground">Period: {startDate} to {endDate}</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Revenue (excl. VAT)</span>
              <span className="font-semibold">{formatZAR(totalSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">VAT Collected (15%)</span>
              <span className="font-semibold text-primary">{formatZAR(totalVAT)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Invoiced (incl. VAT)</span>
              <span className="font-semibold">{formatZAR(totalInvoiced)}</span>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Expenses</span>
              <span className="font-semibold text-red-600">({formatZAR(totalExpenses)})</span>
            </div>
            <Separator />
            <div className="flex justify-between text-lg font-bold">
              <span>Net Revenue</span>
              <span className={netRevenue >= 0 ? "text-green-600" : "text-red-600"}>{formatZAR(netRevenue)}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground italic">
            * This report is for reference only. Please consult your tax practitioner for SARS submissions.
            Company VAT No: 4123456789 | Registration: 2020/123456/07
          </p>
        </CardContent>
      </Card>

      {/* Paid Invoices Table */}
      <Card className="rounded-2xl shadow-md border-0">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Paid Invoices ({invoices.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Excl. VAT</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                  <TableCell>{inv.customer_name}</TableCell>
                  <TableCell className="text-xs">{inv.issue_date}</TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(Number(inv.subtotal))}</TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(Number(inv.tax_amount))}</TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(Number(inv.grand_total))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default TaxReport;
