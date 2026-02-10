import { useState } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreditCard, CheckCircle2, AlertTriangle, Receipt, Crown, Shield, Zap, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";

const AdminBillingPage = () => {
  const { toast } = useToast();
  const sub = useSubscription();
  const [upgrading, setUpgrading] = useState(false);

  // Fetch payment history from invoices table
  const { data: recentPayments = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ["billing-payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, grand_total, status, paid_date, created_at")
        .eq("status", "paid")
        .order("paid_date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const handleUpgrade = async () => {
    setUpgrading(true);
    try {
      toast({
        title: "Upgrade Requested",
        description: "Contact support to upgrade your plan. Stripe checkout coming soon.",
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUpgrading(false);
    }
  };

  const statusConfig: Record<string, { color: string; icon: React.ElementType; label: string }> = {
    trial: { color: "bg-amber-500/20 text-amber-400 border-amber-500/30", icon: Zap, label: "Trial" },
    active: { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", icon: CheckCircle2, label: "Active" },
    expired: { color: "bg-red-500/20 text-red-400 border-red-500/30", icon: AlertTriangle, label: "Expired" },
    canceled: { color: "bg-muted text-muted-foreground border-muted", icon: AlertTriangle, label: "Canceled" },
  };

  const currentStatus = statusConfig[sub.status] || statusConfig.trial;
  const StatusIcon = currentStatus.icon;

  if (sub.loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Billing & Subscription</h2>
        <p className="text-sm text-muted-foreground">Manage your plan, view invoices, and billing details.</p>
      </div>

      {/* Plan Overview */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Current Plan
              </CardTitle>
              <Badge variant="outline" className={currentStatus.color}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {currentStatus.label}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-3xl font-bold capitalize">{sub.plan}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {sub.isTrialActive
                  ? `Trial ends in ${sub.trialDaysLeft} day${sub.trialDaysLeft !== 1 ? "s" : ""}`
                  : sub.isProActive
                  ? "Full access to all features"
                  : "Limited access"}
              </p>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Jobs limit</span>
                <span className="font-medium">{sub.jobsLimit >= 999999 ? "Unlimited" : sub.jobsLimit}</span>
              </div>
              {sub.trialEndsAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Trial ends</span>
                  <span className="font-medium">{format(sub.trialEndsAt, "dd MMM yyyy")}</span>
                </div>
              )}
              {sub.stripeCustomerId && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer ID</span>
                  <span className="font-mono text-xs">{sub.stripeCustomerId.slice(0, 18)}…</span>
                </div>
              )}
            </div>

            {!sub.isProActive && (
              <Button onClick={handleUpgrade} disabled={upgrading} className="w-full mt-2">
                <ArrowUpRight className="h-4 w-4 mr-2" />
                {upgrading ? "Processing…" : "Upgrade to Pro"}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5 text-muted-foreground" />
              Plan Features
            </CardTitle>
            <CardDescription>What's included in your plan</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm">
              {[
                { label: "Job Management", included: true },
                { label: "Customer Portal", included: true },
                { label: "WhatsApp Notifications", included: sub.isProActive || sub.isTrialActive },
                { label: "Advanced Reports", included: sub.isProActive || sub.isTrialActive },
                { label: "Unlimited Jobs", included: sub.isProActive },
                { label: "Priority Support", included: sub.isProActive },
                { label: "API Access", included: sub.isProActive },
                { label: "Custom Branding", included: sub.isProActive },
              ].map((f) => (
                <li key={f.label} className="flex items-center gap-2">
                  <CheckCircle2
                    className={`h-4 w-4 shrink-0 ${f.included ? "text-emerald-500" : "text-muted-foreground/40"}`}
                  />
                  <span className={f.included ? "" : "text-muted-foreground/60"}>{f.label}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Recent Payments */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            Recent Payments
          </CardTitle>
          <CardDescription>Your latest paid invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentPayments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CreditCard className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No payments recorded yet</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentPayments.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{inv.invoice_number}</p>
                    <p className="text-xs text-muted-foreground">
                      {inv.paid_date ? format(new Date(inv.paid_date), "dd MMM yyyy") : "—"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">R {inv.grand_total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}</p>
                    <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      Paid
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminBillingPage;
