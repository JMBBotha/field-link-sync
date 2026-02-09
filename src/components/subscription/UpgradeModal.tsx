import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle2, Zap, Lock } from "lucide-react";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reason?: "limit_reached" | "trial_expired" | "feature_locked";
}

const UpgradeModal = ({ open, onOpenChange, reason = "limit_reached" }: UpgradeModalProps) => {
  const { trialDaysLeft, jobsLimit, isExpired } = useSubscription();
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const titles: Record<string, string> = {
    limit_reached: "Job Limit Reached",
    trial_expired: "Trial Expired",
    feature_locked: "Pro Feature",
  };

  const descriptions: Record<string, string> = {
    limit_reached: `You've reached your limit of ${jobsLimit} jobs this month. Upgrade to Pro for unlimited jobs.`,
    trial_expired: "Your 14-day trial has ended. Upgrade to Pro to continue using all features.",
    feature_locked: "This feature requires a Pro subscription.",
  };

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("create-checkout-session", {
        body: { user_id: user.id, price_id: "pro_monthly" },
      });

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast({
          title: "Upgrade",
          description: "Please contact support to upgrade your plan.",
        });
      }
    } catch (err: any) {
      console.error("Upgrade error:", err);
      toast({
        title: "Error",
        description: "Could not start upgrade flow. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {isExpired ? <Lock className="h-5 w-5 text-destructive" /> : <Crown className="h-5 w-5 text-amber-500" />}
            {titles[reason]}
          </DialogTitle>
          <DialogDescription>{descriptions[reason]}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* Pro plan features */}
          <div className="rounded-lg border-2 border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
              <Crown className="h-4 w-4" />
              Pro Plan
            </div>
            <ul className="space-y-2 text-sm">
              {[
                "Unlimited jobs per month",
                "Priority support",
                "Advanced analytics & reports",
                "Custom branding on invoices",
                "Multi-agent management",
                "Service agreement automation",
              ].map((feature) => (
                <li key={feature} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </div>

          <Button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            size="lg"
          >
            {loading ? (
              "Loading..."
            ) : (
              <>
                <Zap className="h-4 w-4 mr-2" />
                Upgrade to Pro
              </>
            )}
          </Button>

          {!isExpired && (
            <p className="text-xs text-center text-muted-foreground">
              {trialDaysLeft > 0
                ? `${trialDaysLeft} days left in your trial`
                : "Your trial has ended"}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default UpgradeModal;
