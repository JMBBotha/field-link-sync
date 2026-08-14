import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FileText, AlertTriangle, TrendingUp, CreditCard, Plus, Clock, CalendarClock, Database, Receipt, Users } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useState } from "react";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

// BeCoolLogo is rendered in FBLayout sidebar

const StatCard = ({ title, value, icon: Icon, color }: { title: string; value: string; icon: any; color: string }) => (
  <div className="bg-card rounded-lg shadow-[2px_3px_6px_rgba(0,0,0,0.1)] border border-border p-6">
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [loadingDemo, setLoadingDemo] = useState(false);

  const loadDemoData = async () => {
    if (!companyId) {
      toast.error("No company found");
      return;
    }
    console.log("Using companyId:", companyId);
    setLoadingDemo(true);
    try {
      const today = new Date().toISOString().split("T")[0];
      const d = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().split("T")[0];

      // Clean up existing demo data (reverse dependency order)
      await supabase.from("fb_time_entries").delete().eq("company_id", companyId);
      await supabase.from("fb_payments").delete().eq("company_id", companyId);
      await supabase.from("fb_projects").delete().eq("company_id", companyId);
      await supabase.from("fb_expenses").delete().eq("company_id", companyId);
      await supabase.from("fb_estimates").delete().eq("company_id", companyId);
      await supabase.from("company_invoices" as any).delete().eq("company_id", companyId);
      await supabase.from("fb_contacts").delete().eq("company_id", companyId);

      // 3 contacts
      const { data: contacts, error: conErr } = await supabase.from("fb_contacts").insert([
        { company_id: companyId, name: "Sarah Johnson", email: "sarah@example.com", phone: "011-555-0100", company_name: "Johnson Corp" },
        { company_id: companyId, name: "Mike Peters", email: "mike@coolsystems.co.za", phone: "021-555-0200", company_name: "Cool Systems" },
        { company_id: companyId, name: "Lisa Naidoo", email: "lisa@greentech.co.za", phone: "031-555-0300", company_name: "GreenTech SA" },
      ]).select();
      if (conErr) console.error("Contact insert error:", conErr);

      const contactIds = contacts?.map(c => c.id) || [];

      // 5 invoices (company_invoices)
      const { data: invoicesInserted, error: invErr } = await (supabase.from("company_invoices" as any).insert([
        { company_id: companyId, invoice_number: "INV-DEMO-001", subtotal: 1200, vat_amount: 180, total_amount: 1380, tax: 180, status: "Draft", due_date: d(14), contact_id: contactIds[0] || null, items: [{ description: "AC Unit Service", qty: 1, rate: 1200 }] },
        { company_id: companyId, invoice_number: "INV-DEMO-002", subtotal: 3500, vat_amount: 525, total_amount: 4025, tax: 525, status: "Sent", due_date: d(7), contact_id: contactIds[1] || null, items: [{ description: "Split Unit Installation", qty: 1, rate: 3500 }] },
        { company_id: companyId, invoice_number: "INV-DEMO-003", subtotal: 2200, vat_amount: 330, total_amount: 2530, tax: 330, status: "Viewed", due_date: d(-3), contact_id: contactIds[2] || null, items: [{ description: "Duct Cleaning", qty: 2, rate: 1100 }] },
        { company_id: companyId, invoice_number: "INV-DEMO-004", subtotal: 4800, vat_amount: 720, total_amount: 5520, tax: 720, status: "Overdue", due_date: d(-10), contact_id: contactIds[0] || null, items: [{ description: "Central AC Repair", qty: 1, rate: 4800 }] },
        { company_id: companyId, invoice_number: "INV-DEMO-005", subtotal: 1500, vat_amount: 225, total_amount: 1725, tax: 225, status: "Paid", due_date: d(-20), contact_id: contactIds[1] || null, items: [{ description: "Refrigerant Refill", qty: 3, rate: 500 }] },
      ]).select() as any);
      if (invErr) console.error("Invoice insert error:", invErr);
      const invoiceIds = (invoicesInserted as any[])?.map((i: any) => i.id) || [];

      // 3 estimates
      const { error: estErr } = await supabase.from("fb_estimates").insert([
        { company_id: companyId, estimate_number: "EST-DEMO-001", amount: 8500, tax: 1275, status: "draft", contact_id: contactIds[0] || null, items: [{ description: "Full HVAC System", qty: 1, rate: 8500 }] },
        { company_id: companyId, estimate_number: "EST-DEMO-002", amount: 3200, tax: 480, status: "sent", due_date: d(21), contact_id: contactIds[1] || null, items: [{ description: "Compressor Replacement", qty: 1, rate: 3200 }] },
        { company_id: companyId, estimate_number: "EST-DEMO-003", amount: 6000, tax: 900, status: "accepted", contact_id: contactIds[2] || null, items: [{ description: "Multi-Zone Setup", qty: 1, rate: 6000 }] },
      ]);
      if (estErr) console.error("Estimate insert error:", estErr);

      // 4 expenses
      const { error: expErr } = await supabase.from("fb_expenses").insert([
        { company_id: companyId, amount: 850, category: "Travel", date: d(-5), vendor: "Engen Fuel", notes: "Site visit fuel" },
        { company_id: companyId, amount: 1200, category: "Supplies", date: d(-3), vendor: "Builder's Warehouse", notes: "Copper piping" },
        { company_id: companyId, amount: 2000, category: "Equipment", date: d(-8), vendor: "Makita SA", notes: "New flaring tool" },
        { company_id: companyId, amount: 500, category: "Fuel", date: today, vendor: "Shell", notes: "Weekly fuel" },
      ]);
      if (expErr) console.error("Expense insert error:", expErr);

      // 2 projects
      const { data: projects, error: projErr } = await supabase.from("fb_projects").insert([
        { company_id: companyId, name: "Office Block AC Install", status: "active", budget: 45000, client_id: contactIds[0] || null },
        { company_id: companyId, name: "Warehouse Ventilation", status: "archived", budget: 28000, client_id: contactIds[2] || null },
      ]).select();
      if (projErr) console.error("Project insert error:", projErr);

      // 3 payments linked to invoices
      const { error: payErr } = await supabase.from("fb_payments").insert([
        { company_id: companyId, amount: 1500, method: "bank_transfer", date: d(-18), invoice_id: invoiceIds[4] || null },
        { company_id: companyId, amount: 2400, method: "eft", date: d(-12), invoice_id: invoiceIds[3] || null },
        { company_id: companyId, amount: 800, method: "cash", date: d(-5), invoice_id: null },
      ]);
      if (payErr) console.error("Payment insert error:", payErr);

      // 5 time entries (need a user_id – use a placeholder UUID)
      const userId = user?.id || "00000000-0000-0000-0000-000000000001";
      const projectIds = projects?.map(p => p.id) || [];

      const { error: timeErr } = await supabase.from("fb_time_entries").insert([
        { company_id: companyId, user_id: userId, duration: "02:30:00", date: d(-1), billable: true, project_id: projectIds[0] || null, notes: "AC unit diagnostics" },
        { company_id: companyId, user_id: userId, duration: "04:00:00", date: d(-2), billable: true, project_id: projectIds[0] || null, notes: "Copper pipe installation" },
        { company_id: companyId, user_id: userId, duration: "01:15:00", date: d(-3), billable: false, project_id: null, notes: "Admin and quoting" },
        { company_id: companyId, user_id: userId, duration: "03:45:00", date: d(-4), billable: true, project_id: projectIds[1] || null, notes: "Duct layout planning" },
        { company_id: companyId, user_id: userId, duration: "05:00:00", date: today, billable: true, project_id: projectIds[0] || null, notes: "Split unit commissioning" },
      ]);
      if (timeErr) console.error("Time entry insert error:", timeErr);

      const hasErrors = invErr || estErr || expErr || conErr || projErr || payErr || timeErr;
      if (hasErrors) {
        toast.error("Some inserts failed – check console");
      } else {
        toast.success("Demo data loaded successfully!");
      }

      // Invalidate all query keys
      const keys = [
        "fb-dashboard-stats",
        "company-invoices", "fb-invoices-for-payment",
        "fb-estimates", "fb-expenses-stats", "fb-expenses",
        "fb-payments-stats", "fb-payments",
        "fb-contacts", "fb-projects", "fb-time-entries",
      ];
      keys.forEach(k => queryClient.invalidateQueries({ queryKey: [k] }));
    } catch (err) {
      console.error("loadDemoData exception:", err);
      toast.error("Failed to load demo data");
    } finally {
      setLoadingDemo(false);
    }
  };

  // Dedicated stats queries
  const { data: stats } = useQuery({
    queryKey: ["fb-dashboard-stats", companyId],
    queryFn: async () => {
      const [invRes, payRes, expRes] = await Promise.all([
        supabase.from("company_invoices" as any).select("id, total_amount, status, due_date, invoice_number, created_at, contact_id").eq("company_id", companyId!) as any,
        supabase.from("fb_payments").select("id, amount, date, company_invoice_id, method").eq("company_id", companyId!).order("date", { ascending: false }),
        supabase.from("fb_expenses").select("id, amount, date, category").eq("company_id", companyId!),
      ]);
      const invoices = invRes.data || [];
      const payments = payRes.data || [];
      const expenses = expRes.data || [];

      const todayStr = new Date().toISOString().split("T")[0];
      const outstanding = invoices
        .filter(i => !["Paid", "Archived"].includes(i.status))
        .reduce((s, i) => s + Number(i.total_amount), 0);
      const revenue = payments.reduce((s, p) => s + Number(p.amount), 0);
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0);
      const overdueInvoices = invoices.filter(i => i.due_date && i.due_date < todayStr && !["Paid", "Archived"].includes(i.status));

      return { invoices, payments, expenses, outstanding, revenue, totalExpenses, overdueInvoices, todayStr };
    },
    enabled: !!companyId,
  });

  const invoices = stats?.invoices || [];
  const payments = stats?.payments?.slice(0, 5) || [];
  const expenses = stats?.expenses || [];
  const outstanding = stats?.outstanding || 0;
  const revenue = stats?.revenue || 0;
  const totalExpenses = stats?.totalExpenses || 0;
  const overdueInvoices = stats?.overdueInvoices || [];

  const upcomingDue = invoices
    .filter(i => i.due_date && !["Paid", "Archived"].includes(i.status))
    .sort((a, b) => (a.due_date! > b.due_date! ? 1 : -1))
    .slice(0, 5);

  const allPayments = stats?.payments || [];
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const month = d.toLocaleString("default", { month: "short" });
    const monthRev = allPayments.filter((p: any) => {
      const pd = new Date(p.date);
      return pd.getMonth() === d.getMonth() && pd.getFullYear() === d.getFullYear();
    });
    return { month, revenue: monthRev.reduce((s: number, p: any) => s + Number(p.amount), 0) };
  });

  // Recent activity feed: union of invoices, payments, estimates
  const recentActivity = [
    ...invoices.slice(0, 5).map((i: any) => ({ type: "invoice" as const, label: `Invoice ${i.invoice_number}`, detail: `${fmt(Number(i.total_amount))} — ${i.status}`, date: i.created_at })),
    ...payments.map((p: any) => ({ type: "payment" as const, label: `Payment received`, detail: `${fmt(Number(p.amount))} via ${p.method?.replace("_", " ")}`, date: p.date })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 10);

  const activityIcon = (type: string) => {
    if (type === "invoice") return <FileText className="h-4 w-4 text-blue-500" />;
    if (type === "payment") return <CreditCard className="h-4 w-4 text-green-500" />;
    return <Receipt className="h-4 w-4 text-muted-foreground" />;
  };

  const isWithin7Days = (dateStr: string) => {
    const diff = (new Date(dateStr).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= 7;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>

      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => navigate("../invoices")} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <Plus className="h-4 w-4 mr-2" />New Invoice
        </Button>
        <Button onClick={() => navigate("../quote-builder")} className="bg-amber-500 hover:bg-amber-600 text-amber-950">
          <Plus className="h-4 w-4 mr-2" />New Estimate
        </Button>
        <Button onClick={() => navigate("../time-tracking")} className="bg-primary hover:bg-primary/90 text-primary-foreground">
          <Clock className="h-4 w-4 mr-2" />Log Time
        </Button>
        <Button onClick={loadDemoData} disabled={loadingDemo} className="bg-slate-500 hover:bg-slate-600 text-white">
          <Database className="h-4 w-4 mr-2" />{loadingDemo ? "Loading..." : "Load Demo Data"}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard title="Outstanding" value={fmt(outstanding)} icon={FileText} color="bg-blue-100 text-blue-600" />
        <StatCard title="Revenue" value={fmt(revenue)} icon={TrendingUp} color="bg-blue-100 text-blue-600" />
        <StatCard title="Overdue" value={String(overdueInvoices.length)} icon={AlertTriangle} color="bg-red-100 text-red-600" />
        <StatCard title="Expenses" value={fmt(totalExpenses)} icon={RandSign} color="bg-blue-100 text-blue-600" />
        <StatCard title="Revenue Today" value={fmt(allPayments.filter((p: any) => p.date === stats?.todayStr).reduce((s: number, p: any) => s + Number(p.amount), 0))} icon={CreditCard} color="bg-blue-100 text-blue-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold text-foreground mb-4">Revenue (Last 6 Months)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="revenue" fill="#2563EB" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

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
                  <span className="text-sm font-bold text-red-700">{fmt(Number(inv.total_amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-blue-500" /> Recent Payments
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

        <div className="bg-card rounded-lg shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-blue-500" /> Upcoming Due Dates
          </h3>
          {upcomingDue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming invoices</p>
          ) : (
            <div className="space-y-2">
              {upcomingDue.map((inv: any) => (
                <div key={inv.id} className={`flex items-center justify-between p-3 rounded-lg border ${isWithin7Days(inv.due_date) ? "bg-blue-50 border-blue-200" : "bg-muted/50 border-transparent"}`}>
                  <div>
                    <p className="text-sm font-medium text-foreground">{inv.invoice_number}</p>
                    <p className={`text-xs ${isWithin7Days(inv.due_date) ? "text-blue-600 font-medium" : "text-muted-foreground"}`}>
                      Due: {inv.due_date} {isWithin7Days(inv.due_date) && "⚠️"}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-foreground">{fmt(Number(inv.total_amount))}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-500" /> Recent Activity
        </h3>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent activity — load demo data to get started</p>
        ) : (
          <div className="space-y-3">
            {recentActivity.map((item, idx) => (
              <div key={idx} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
                <div className="mt-0.5">{activityIcon(item.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(item.date).toLocaleDateString("en-ZA")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default FBDashboard;
