import { useCompany } from "@/providers/CompanyProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DollarSign, FileText, AlertTriangle, TrendingUp, Clock, CreditCard } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";

const StatCard = ({ title, value, icon: Icon, color }: { title: string; value: string; icon: any; color: string }) => (
  <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium text-[hsl(0,0%,53%)]">{title}</p>
        <p className="text-2xl font-bold text-[hsl(0,0%,29%)] mt-1">{value}</p>
      </div>
      <div className={`h-12 w-12 rounded-full ${color} flex items-center justify-center`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  </div>
);

const FBDashboard = () => {
  const { companyId } = useCompany();

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
      const { data } = await supabase.from("fb_payments").select("id, amount, date, invoice_id").eq("company_id", companyId!).order("date", { ascending: false }).limit(5);
      return data || [];
    },
    enabled: !!companyId,
  });

  const outstanding = invoices.filter(i => ["sent", "viewed", "overdue"].includes(i.status)).reduce((s, i) => s + Number(i.amount), 0);
  const revenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + Number(i.amount), 0);
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);

  // Overdue invoices
  const today = new Date().toISOString().split("T")[0];
  const overdueInvoices = invoices.filter(i => i.due_date && i.due_date < today && !["paid", "cancelled"].includes(i.status));

  // Monthly revenue chart data
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

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Dashboard</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Outstanding" value={`R ${outstanding.toLocaleString()}`} icon={FileText} color="bg-[hsl(211,100%,43%)]/10 text-[hsl(211,100%,43%)]" />
        <StatCard title="Revenue" value={`R ${revenue.toLocaleString()}`} icon={TrendingUp} color="bg-[hsl(125,49%,34%)]/10 text-[hsl(125,49%,34%)]" />
        <StatCard title="Overdue" value={String(overdueInvoices.length)} icon={AlertTriangle} color="bg-red-100 text-red-600" />
        <StatCard title="Expenses" value={`R ${totalExpenses.toLocaleString()}`} icon={DollarSign} color="bg-amber-100 text-amber-700" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue chart */}
        <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-[hsl(0,0%,29%)] mb-4">Revenue (Last 6 Months)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,90%)" />
              <XAxis dataKey="month" tick={{ fill: "hsl(0,0%,53%)", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(0,0%,53%)", fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="revenue" fill="hsl(211,100%,43%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Overdue alerts */}
        <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6">
          <h3 className="text-lg font-semibold text-[hsl(0,0%,29%)] mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" /> Overdue Invoices
          </h3>
          {overdueInvoices.length === 0 ? (
            <p className="text-sm text-[hsl(0,0%,53%)]">No overdue invoices 🎉</p>
          ) : (
            <div className="space-y-3">
              {overdueInvoices.slice(0, 5).map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-100">
                  <div>
                    <p className="text-sm font-medium text-[hsl(0,0%,29%)]">{inv.invoice_number}</p>
                    <p className="text-xs text-red-600">Due: {inv.due_date}</p>
                  </div>
                  <span className="text-sm font-bold text-red-700">R {Number(inv.amount).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent payments */}
      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6">
        <h3 className="text-lg font-semibold text-[hsl(0,0%,29%)] mb-4 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[hsl(211,100%,43%)]" /> Recent Payments
        </h3>
        {payments.length === 0 ? (
          <p className="text-sm text-[hsl(0,0%,53%)]">No recent payments</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between p-3 bg-[hsl(0,0%,98%)] rounded-lg">
                <div>
                  <p className="text-sm text-[hsl(0,0%,53%)]">{p.date}</p>
                </div>
                <span className="text-sm font-bold text-[hsl(125,49%,34%)]">R {Number(p.amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FBDashboard;
