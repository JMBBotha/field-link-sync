import { useCompany } from "@/providers/CompanyProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, FileText, AlertTriangle, TrendingUp, CreditCard, Plus, Clock, CalendarClock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const StatCard = ({ title, value, icon: Icon, color }: { title: string; value: string; icon: any; color: string }) => (
  <div className="bg-card rounded-lg shadow-sm border border-border p-6 border-l-4 border-l-amber-400">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold text-foreground mt-1">{value}</p>
      </div>
      <div className={`h-12 w-12 rounded-full ${color} flex items-center justify-center`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  </div>
);

const FBDashboard = () => {
  const { companyId } = useCompany();
  const navigate = useNavigate();

  const { data: invoices = [] } = useQuery({
    queryKey: ["fb-invoices-stats", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_invoices").select("id, amount, status, created_at, due_date, invoice_number, contact_id").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: expenses = [] } = useQuery({
    queryKey: ["fb-expenses-stats", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_expenses").select("id, amount, date, category").eq("company_id", companyId!);
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["fb-payments-stats", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("id, amount, date, invoice_id, method").eq("company_id", companyId!).order("date", { ascending: false }).limit(5);
      return data || [];
    },
    enabled: !!companyId,
  });

  const outstanding = invoices.filter(i => ["sent", "viewed", "overdue", "partial"].includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);
  const revenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

  const today = new Date().toISOString().split("T")[0];
  const overdueInvoices = invoices.filter(i => i.due_date && i.due_date < today && !["paid", "cancelled"].includes(i.status));

  // Upcoming due dates (next 5 unpaid)
  const upcomingDue = invoices
    .filter(i => i.due_date && !["paid", "cancelled"].includes(i.status))
    .sort((a, b) => (a.due_date! > b.due_date! ? 1 : -1))
    .slice(0, 5);

  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const month = d.toLocaleString("default", { month: "short" });
    const monthInvs = invoices.filter(inv => {
      const invDate = new Date(inv.created_at);
      return invDate.getMonth() === d.getMonth() && invDate.getFullYear() === d.getFullYear() && inv.status === "paid";
    });
    return { month, revenue: monthInvs.reduce((s, inv) => s + Number(inv.amount), 0) };
  });

  const isWithin7Days = (dateStr: string) => {
    const diff = (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button onClick={() => navigate("../invoices")} className="bg-amber-500 hover:bg-amber-600 text-white">
          <Plus className="h-4 w-4 mr-2" />New Invoice
        </Button>
        <Button onClick={() => navigate("../estimates")} className="bg-amber-500 hover:bg-amber-600 text-white">
          <Plus className="h-4 w-4 mr-2" />New Estimate
        </Button>
        <Button onClick={() => navigate("../time-tracking")} className="bg-amber-500 hover:bg-amber-600 text-white">
          <Clock className="h-4 w-4 mr-2" />Log Time
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Outstanding" value={fmt(outstanding)} icon={FileText} color="bg-amber-100 text-amber-600" />
        <StatCard title="Revenue" value={fmt(revenue)} icon={TrendingUp} color="bg-amber-100 text-amber-600" />
        <StatCard title="Overdue" value={String(overdueInvoices.length)} icon={AlertTriangle} color="bg-red-100 text-red-600" />
        <StatCard title="Expenses" value={fmt(totalExpenses)} icon={DollarSign} color="bg-amber-100 text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-foreground mb-4">Revenue (Last 6 Months)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="revenue" fill="#F59E0B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Overdue alerts */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" /> Overdue Invoices
          </h3>
          {overdueInvoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overdue invoices 🎉</p>
          ) : (
            <div className="space-y-3">
              {overdueInvoices.slice(0, 5).map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.invoice_number}</p>
                    <p className="text-xs text-red-600">Due: {inv.due_date}</p>
                  </div>
                  <span className="text-sm font-bold text-red-700">{fmt(Number(inv.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent payments */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-amber-500" /> Recent Payments
          </h3>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent payments</p>
          ) : (
            <div className="space-y-2">
              {payments.map((p: any) => (
                <div key={p.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                  <div>
                    <p className="text-sm text-muted-foreground">{p.date}</p>
                    <p className="text-xs text-muted-foreground capitalize">{p.method?.replace("_", " ")}</p>
                  </div>
                  <span className="text-sm font-bold text-green-600">{fmt(Number(p.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming due dates */}
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-amber-500" /> Upcoming Due Dates
          </h3>
          {upcomingDue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming invoices</p>
          ) : (
            <div className="space-y-2">
              {upcomingDue.map((inv: any) => (
                <div key={inv.id} className={`flex items-center justify-between p-3 rounded-lg border ${isWithin7Days(inv.due_date) ? "bg-amber-50 border-amber-200" : "bg-muted/50 border-transparent"}`}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.invoice_number}</p>
                    <p className={`text-xs ${isWithin7Days(inv.due_date) ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
                      Due: {inv.due_date} {isWithin7Days(inv.due_date) && "⚠️"}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-foreground">{fmt(Number(inv.amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FBDashboard;
