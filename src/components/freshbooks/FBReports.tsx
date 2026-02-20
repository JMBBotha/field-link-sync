import { useCompany } from "@/providers/CompanyProvider";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

const COLORS = ["hsl(211,100%,43%)", "hsl(125,49%,34%)", "hsl(45,100%,50%)", "hsl(0,80%,50%)", "hsl(270,60%,50%)"];

const FBReports = () => {
  const { companyId } = useCompany();

  const { data: invoices = [] } = useQuery({
    queryKey: ["fb-reports-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_invoices").select("*").eq("company_id", companyId!);
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

  // Invoice status breakdown
  const statusData = ["draft", "sent", "paid", "overdue"].map(s => ({
    name: s.charAt(0).toUpperCase() + s.slice(1),
    value: invoices.filter((i: any) => i.status === s).length,
  })).filter(d => d.value > 0);

  // Expense by category
  const categoryMap = new Map<string, number>();
  expenses.forEach((e: any) => categoryMap.set(e.category, (categoryMap.get(e.category) || 0) + Number(e.amount)));
  const expenseData = Array.from(categoryMap.entries()).map(([name, value]) => ({ name, value }));

  // Revenue vs Expenses monthly
  const monthlyComparison = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setMonth(d.getMonth() - (5 - i));
    const m = d.getMonth(), y = d.getFullYear();
    const rev = invoices.filter((inv: any) => { const id = new Date(inv.created_at); return id.getMonth() === m && id.getFullYear() === y && inv.status === "paid"; }).reduce((s: number, inv: any) => s + Number(inv.amount), 0);
    const exp = expenses.filter((e: any) => { const ed = new Date(e.date); return ed.getMonth() === m && ed.getFullYear() === y; }).reduce((s: number, e: any) => s + Number(e.amount), 0);
    return { month: d.toLocaleString("default", { month: "short" }), revenue: rev, expenses: exp };
  });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Reports</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6">
          <h3 className="font-semibold text-[hsl(0,0%,29%)] mb-4">Invoice Status Breakdown</h3>
          {statusData.length === 0 ? <p className="text-[hsl(0,0%,53%)] text-sm">No data</p> : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart><Pie data={statusData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6">
          <h3 className="font-semibold text-[hsl(0,0%,29%)] mb-4">Expenses by Category</h3>
          {expenseData.length === 0 ? <p className="text-[hsl(0,0%,53%)] text-sm">No data</p> : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart><Pie data={expenseData} cx="50%" cy="50%" outerRadius={100} dataKey="value" label={({ name }) => name}>
                {expenseData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie><Tooltip /></PieChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] p-6 lg:col-span-2">
          <h3 className="font-semibold text-[hsl(0,0%,29%)] mb-4">Revenue vs Expenses</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyComparison}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0,0%,90%)" />
              <XAxis dataKey="month" tick={{ fill: "hsl(0,0%,53%)", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(0,0%,53%)", fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="revenue" fill="hsl(211,100%,43%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="expenses" fill="hsl(0,80%,50%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default FBReports;
