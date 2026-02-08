import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Loader2 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { exportToCSV } from "@/lib/csvExport";

const formatZAR = (n: number) => `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`;

interface Props {
  startDate: string;
  endDate: string;
}

const RevenueReport = ({ startDate, endDate }: Props) => {
  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["report-revenue", startDate, endDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, grand_total, tax_amount, subtotal, status, issue_date, paid_date, agent_id")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const totalRevenue = invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.grand_total), 0);
  const totalInvoiced = invoices.reduce((s, i) => s + Number(i.grand_total), 0);
  const totalOutstanding = invoices.filter((i) => i.status !== "paid" && i.status !== "cancelled").reduce((s, i) => s + Number(i.grand_total), 0);

  // Group by month for chart
  const monthlyData = invoices
    .filter((i) => i.status === "paid")
    .reduce((acc: Record<string, number>, inv) => {
      const month = inv.paid_date ? inv.paid_date.substring(0, 7) : inv.issue_date.substring(0, 7);
      acc[month] = (acc[month] || 0) + Number(inv.grand_total);
      return acc;
    }, {});
  const chartData = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, revenue]) => ({ month, revenue }));

  const handleExport = () => {
    exportToCSV(
      invoices.map((i) => ({
        Invoice: i.invoice_number,
        Customer: i.customer_name,
        "Issue Date": i.issue_date,
        Status: i.status,
        Subtotal: Number(i.subtotal).toFixed(2),
        VAT: Number(i.tax_amount).toFixed(2),
        Total: Number(i.grand_total).toFixed(2),
      })),
      `revenue-report-${startDate}-${endDate}`
    );
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="rounded-2xl shadow-md border-0">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Invoiced</p>
            <p className="text-2xl font-bold">{formatZAR(totalInvoiced)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-md border-0">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Revenue (Paid)</p>
            <p className="text-2xl font-bold text-green-600">{formatZAR(totalRevenue)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl shadow-md border-0">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Outstanding</p>
            <p className="text-2xl font-bold text-orange-600">{formatZAR(totalOutstanding)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="rounded-2xl shadow-md border-0">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Revenue by Month</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R${(v / 1000).toFixed(0)}k`} />
                  <Tooltip formatter={(v: number) => formatZAR(v)} />
                  <Bar dataKey="revenue" fill="hsl(142, 76%, 36%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table + Export */}
      <Card className="rounded-2xl shadow-md border-0">
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Invoice Details ({invoices.length})</CardTitle>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.invoice_number}</TableCell>
                  <TableCell>{inv.customer_name}</TableCell>
                  <TableCell className="text-xs">{inv.issue_date}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-medium ${inv.status === "paid" ? "text-green-600" : inv.status === "overdue" ? "text-red-600" : "text-muted-foreground"}`}>
                      {inv.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(Number(inv.grand_total))}</TableCell>
                </TableRow>
              ))}
              {invoices.length > 0 && (
                <TableRow className="font-bold border-t-2">
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell className="text-right font-mono">{formatZAR(totalInvoiced)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default RevenueReport;
