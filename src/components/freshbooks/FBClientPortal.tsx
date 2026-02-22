import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/providers/CompanyProvider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, FileBarChart, CreditCard } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const FBClientPortal = () => {
  const { companyId } = useCompany();

  const { data: invoices = [] } = useQuery({
    queryKey: ["company-portal-invoices", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("company_invoices" as any).select("*, fb_contacts(name)").eq("company_id", companyId!).neq("status", "Archived").order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: estimates = [] } = useQuery({
    queryKey: ["fb-portal-estimates", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_estimates").select("*, fb_contacts(name)").eq("company_id", companyId!).neq("status", "archived").order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: payments = [] } = useQuery({
    queryKey: ["fb-portal-payments", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_payments").select("*, company_invoices:company_invoice_id(invoice_number)").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      draft: "bg-gray-100 text-gray-700", sent: "bg-blue-100 text-blue-700", paid: "bg-green-100 text-green-700",
      overdue: "bg-red-100 text-red-700", accepted: "bg-green-100 text-green-700", declined: "bg-red-100 text-red-700",
      partial: "bg-blue-50 text-blue-600", viewed: "bg-purple-100 text-purple-700",
    };
    return <Badge variant="secondary" className={colors[status] || ""}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-foreground">Client Portal</h2>
      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices"><FileText className="h-4 w-4 mr-1.5" />Invoices ({invoices.length})</TabsTrigger>
          <TabsTrigger value="estimates"><FileBarChart className="h-4 w-4 mr-1.5" />Estimates ({estimates.length})</TabsTrigger>
          <TabsTrigger value="payments"><CreditCard className="h-4 w-4 mr-1.5" />Payments ({payments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice #</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Due Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {invoices.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No invoices</td></tr>
                : invoices.map((inv: any) => (
                  <tr key={inv.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-blue-600">{inv.invoice_number}</td>
                    <td className="px-4 py-3">{inv.fb_contacts?.name || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(Number(inv.total_amount))}</td>
                    <td className="px-4 py-3 text-muted-foreground">{inv.due_date || "—"}</td>
                    <td className="px-4 py-3">{statusBadge(inv.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="estimates">
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estimate #</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Client</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr></thead>
              <tbody>
                {estimates.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No estimates</td></tr>
                : estimates.map((e: any) => (
                  <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium text-blue-600">{e.estimate_number}</td>
                    <td className="px-4 py-3">{e.fb_contacts?.name || "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">{fmt(Number(e.amount))}</td>
                    <td className="px-4 py-3">{statusBadge(e.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Invoice</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Method</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Amount</th>
              </tr></thead>
              <tbody>
                {payments.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No payments</td></tr>
                : payments.map((p: any) => (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="px-4 py-3">{p.date}</td>
                    <td className="px-4 py-3 text-blue-600">{p.company_invoices?.invoice_number || "—"}</td>
                    <td className="px-4 py-3 capitalize">{p.method?.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-right font-medium text-green-600">{fmt(Number(p.amount))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default FBClientPortal;
