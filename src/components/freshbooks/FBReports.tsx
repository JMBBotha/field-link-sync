import { useState, useMemo, useRef } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import Papa from "papaparse";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);
const COLORS = ["#2563EB", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6"];

type Preset = "month" | "quarter" | "year" | "custom";

const getPresetRange = (preset: Preset): [string, string] => {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (preset === "month") return [new Date(y, m, 1).toISOString().split("T")[0], new Date(y, m + 1, 0).toISOString().split("T")[0]];
  if (preset === "quarter") { const q = Math.floor(m / 3) * 3; return [new Date(y, q, 1).toISOString().split("T")[0], new Date(y, q + 3, 0).toISOString().split("T")[0]]; }
  return [new Date(y, 0, 1).toISOString().split("T")[0], new Date(y, 11, 31).toISOString().split("T")[0]];
};

const FBReports = () => {
  const { companyId } = useCompany();
  const [preset, setPreset] = useState<Preset>("year");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [rangeFrom, rangeTo] = preset === "custom" && customFrom && customTo ? [customFrom, customTo] : getPresetRange(preset);

  const { data: invoices = [] } = useQuery({
    queryKey: ["fb-reports-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_invoices").select("*").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["fb-reports-payments", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("*").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["fb-reports-expenses", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_expenses").select("*").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  // Filter by date range
  const filteredInvoices = invoices.filter((i: any) => i.created_at >= rangeFrom && i.created_at <= rangeTo + "T23:59:59");
  const filteredPayments = payments.filter((p: any) => p.date >= rangeFrom && p.date <= rangeTo);
  const filteredExpenses = expenses.filter((e: any) => e.date >= rangeFrom && e.date <= rangeTo);

  // Status breakdown
  const statusData = ["draft", "sent", "paid", "overdue", "partial"].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    value: filteredInvoices.filter((i: any) => i.status === s).length,
  })).filter(d => d.value > 0);

  // Expense by category
  const categoryMap = new Map<string, number>();
  filteredExpenses.forEach((e: any) => categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + Number(e.amount)));
  const expenseData = Array.from(categoryMap.entries()).map(([name, value]) => ({ name, value }));

  // Revenue vs Expenses monthly – revenue from payments, expenses from expenses
  const monthlyComparison = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
    const m = d.getMonth(), y = d.getFullYear();
    const rev = payments.filter((p: any) => { const pd = new Date(p.date); return pd.getMonth() === m && pd.getFullYear() === y; }).reduce((s: number, p: any) => s + Number(p.amount), 0);
    const exp = expenses.filter((e: any) => { const ed = new Date(e.date); return ed.getMonth() === m && ed.getFullYear() === y; }).reduce((s: number, e: any) => s + Number(e.amount), 0);
    return { month: d.toLocaleString("default", { month: "short" }), revenue: rev, expenses: exp };
  });

  // P&L
  const totalRevenue = filteredPayments.reduce((s: number, p: any) => s + Number(p.amount), 0);
  const totalExpenses = filteredExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const net = totalRevenue - totalExpenses;

  // Aging report
  const today = new Date();
  const overdueInvoices = invoices.filter((i: any) => i.due_date && new Date(i.due_date) < today && !["paid", "cancelled"].includes(i.status));
  const aging = useMemo(() => {
    const groups = { "0-30": [] as any[], "31-60": [] as any[], "61-90": [] as any[], "90+": [] as any[] };
    overdueInvoices.forEach((inv: any) => {
      const days = Math.floor((today.getTime() - new Date(inv.due_date).getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) groups["0-30"].push(inv);
      else if (days <= 60) groups["31-60"].push(inv);
      else if (days <= 90) groups["61-90"].push(inv);
      else groups["90+"].push(inv);
    });
    return groups;
  }, [overdueInvoices]);

  const exportCSV = () => {
    const rows = [
      { section: "P&L", item: "Revenue", amount: totalRevenue },
      { section: "P&L", item: "Expenses", amount: totalExpenses },
      { section: "P&L", item: "Net Profit", amount: net },
      ...statusData.map(s => ({ section: "Invoice Status", item: s.name, amount: s.value })),
      ...expenseData.map(e => ({ section: "Expense Category", item: e.name, amount: e.value })),
      ...(["0-30", "31-60", "61-90", "90+"] as const).map(b => ({
        section: "Aging", item: `${b} days`, amount: aging[b].reduce((s: number, i: any) => s + Number(i.amount), 0),
      })),
    ];
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `report-${rangeFrom}-${rangeTo}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "CSV exported" });
  };

  const exportPDF = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<html><head><title>Report ${rangeFrom} to ${rangeTo}</title><style>body{font-family:sans-serif;padding:2rem}table{width:100%;border-collapse:collapse;margin:1rem 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#2563EB;color:#fff}h1,h2{color:#333}.summary{display:flex;gap:2rem;margin:1rem 0}.summary div{flex:1;text-align:center;padding:1rem;border:1px solid #eee;border-radius:8px}</style></head><body>`);
    printWindow.document.write(`<h1>Financial Report</h1><p>${rangeFrom} — ${rangeTo}</p>`);
    printWindow.document.write(`<div class="summary"><div><h3>Revenue</h3><p>${fmt(totalRevenue)}</p></div><div><h3>Expenses</h3><p>${fmt(totalExpenses)}</p></div><div><h3>Net Profit</h3><p>${fmt(net)}</p></div></div>`);
    printWindow.document.write(`<h2>Invoice Status</h2><table><tr><th>Status</th><th>Count</th></tr>${statusData.map(s => `<tr><td>${s.name}</td><td>${s.value}</td></tr>`).join("")}</table>`);
    printWindow.document.write(`<h2>Expenses by Category</h2><table><tr><th>Category</th><th>Amount</th></tr>${expenseData.map(e => `<tr><td>${e.name}</td><td>${fmt(e.value)}</td></tr>`).join("")}</table>`);
    printWindow.document.write(`<h2>Aging Report</h2><table><tr><th>Bucket</th><th>Count</th><th>Total</th></tr>${(["0-30", "31-60", "61-90", "90+"] as const).map(b => `<tr><td>${b} days</td><td>${aging[b].length}</td><td>${fmt(aging[b].reduce((s: number, i: any) => s + Number(i.amount), 0))}</td></tr>`).join("")}</table>`);
    printWindow.document.write(`</body></html>`);
    printWindow.document.close();
    printWindow.print();
    toast({ title: "PDF report opened for printing" });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Reports</h2>

      {/* Date range + export */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {(["month", "quarter", "year", "custom"] as Preset[]).map(p => (
            <Button key={p} size="sm"
              className={preset === p ? "bg-primary hover:bg-primary/90 text-primary-foreground" : "bg-slate-500 hover:bg-slate-600 text-white"}
              onClick={() => setPreset(p)}>
              {p === "month" ? "This Month" : p === "quarter" ? "This Quarter" : p === "year" ? "This Year" : "Custom"}
            </Button>
          ))}
          {preset === "custom" && (
            <div className="flex gap-2">
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="w-36" />
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="w-36" />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="bg-slate-500 hover:bg-slate-600 text-white" onClick={exportCSV}><Download className="h-4 w-4 mr-1" />Export CSV</Button>
          <Button size="sm" className="bg-slate-500 hover:bg-slate-600 text-white" onClick={exportPDF}><FileText className="h-4 w-4 mr-1" />Export PDF</Button>
        </div>
      </div>

      {/* P&L Card */}
      <div className="bg-card rounded-lg shadow-sm border border-border p-6 border-l-4 border-l-blue-500">
        <h3 className="font-semibold text-foreground mb-3">Profit & Loss Summary</h3>
        <div className="grid grid-cols-3 gap-6 text-center">
          <div><p className="text-sm text-muted-foreground">Revenue</p><p className="text-xl font-bold text-green-600">{fmt(totalRevenue)}</p></div>
          <div><p className="text-sm text-muted-foreground">Expenses</p><p className="text-xl font-bold text-red-600">{fmt(totalExpenses)}</p></div>
          <div><p className="text-sm text-muted-foreground">Net Profit</p><p className={`text-xl font-bold ${net >= 0 ? "text-green-600" : "text-red-600"}`}>{fmt(net)}</p></div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Invoice Status Breakdown</h3>
          {statusData.length === 0 ? <p className="text-muted-foreground text-sm">No data</p> : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="font-semibold text-foreground mb-4">Expenses by Category</h3>
          {expenseData.length === 0 ? <p className="text-muted-foreground text-sm">No data</p> : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart><Pie data={expenseData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                {expenseData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip formatter={(v: number) => fmt(v)} /></PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-card rounded-lg shadow-sm border border-border p-6 lg:col-span-2">
          <h3 className="font-semibold text-foreground mb-4">Revenue vs Expenses</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" fill="#EF4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Aging Report */}
      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <h3 className="font-semibold text-foreground mb-4">Aging Report — Overdue Invoices</h3>
        {overdueInvoices.length === 0 ? <p className="text-muted-foreground text-sm">No overdue invoices</p> : (
          <div className="space-y-4">
            {(["0-30", "31-60", "61-90", "90+"] as const).map(bucket => (
              <div key={bucket}>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className={bucket === "90+" ? "bg-red-100 text-red-700" : bucket === "61-90" ? "bg-red-50 text-red-600" : bucket === "31-60" ? "bg-blue-100 text-blue-700" : "bg-blue-50 text-blue-600"}>
                    {bucket} days
                  </Badge>
                  <span className="text-sm text-muted-foreground">{aging[bucket].length} invoice(s) — {fmt(aging[bucket].reduce((s: number, i: any) => s + Number(i.amount), 0))}</span>
                </div>
                {aging[bucket].length > 0 && (
                  <div className="ml-4 space-y-1">
                    {aging[bucket].map((inv: any) => (
                      <div key={inv.id} className="flex justify-between text-sm p-2 rounded bg-muted/50">
                        <span className="text-foreground">{inv.invoice_number}</span>
                        <span className="font-medium">{fmt(Number(inv.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FBReports;
