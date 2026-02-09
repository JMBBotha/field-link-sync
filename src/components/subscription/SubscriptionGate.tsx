import { ReactNode, useState, useEffect } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import UpgradeModal from "@/components/subscription/UpgradeModal";
import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SubscriptionGateProps {
  children: ReactNode;
  /** If true, blocks content entirely when expired (read-only mode) */
  blockOnExpiry?: boolean;
  /** If true, checks job limit before allowing action */
  checkJobLimit?: boolean;
}

/**
 * Wraps content that requires an active subscription.
 * Shows upgrade prompt when trial expired or job limit reached.
 */
const SubscriptionGate = ({ children, blockOnExpiry = false, checkJobLimit = false }: SubscriptionGateProps) => {
  const { isExpired, canCreateJobs, loading } = useSubscription();
  const [showUpgrade, setShowUpgrade] = useState(false);

  if (loading) return <>{children}</>;

  // Expired trial — read-only overlay
  if (blockOnExpiry && isExpired) {
    return (
      <div className="relative">
        <div className="opacity-50 pointer-events-none select-none">{children}</div>
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
          <div className="text-center space-y-3 p-6 max-w-sm">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
            <h3 className="font-semibold text-lg">Trial Expired</h3>
            <p className="text-sm text-muted-foreground">
              Your 14-day trial has ended. Upgrade to Pro to continue managing jobs.
            </p>
            <Button onClick={() => setShowUpgrade(true)} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Upgrade to Pro
            </Button>
          </div>
        </div>
        <UpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} reason="trial_expired" />
      </div>
    );
  }

  // Job limit banner
  if (checkJobLimit && !canCreateJobs && !isExpired) {
    return (
      <>
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Monthly job limit reached
            </p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Upgrade to Pro for unlimited jobs
            </p>
          </div>
          <Button size="sm" onClick={() => setShowUpgrade(true)} className="bg-amber-600 hover:bg-amber-700 text-white">
            Upgrade
          </Button>
        </div>
        {children}
        <UpgradeModal open={showUpgrade} onOpenChange={setShowUpgrade} reason="limit_reached" />
      </>
    );
  }

  return <>{children}</>;
};

export default SubscriptionGate;
