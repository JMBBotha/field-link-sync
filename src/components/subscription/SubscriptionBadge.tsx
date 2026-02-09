import { Crown, Clock, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSubscription } from "@/hooks/useSubscription";

const SubscriptionBadge = () => {
  const { status, plan, trialDaysLeft, isProActive, isExpired, loading } = useSubscription();

  if (loading) return null;

  if (isProActive) {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold gap-1 px-2 py-0.5">
        <Crown className="h-3 w-3" />
        Pro — Active
      </Badge>
    );
  }

  if (isExpired) {
    return (
      <Badge variant="destructive" className="text-[10px] font-semibold gap-1 px-2 py-0.5">
        <Clock className="h-3 w-3" />
        Trial Expired
      </Badge>
    );
  }

  // Trial active
  return (
    <Badge className="bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-semibold gap-1 px-2 py-0.5">
      <Zap className="h-3 w-3" />
      Trial — {trialDaysLeft}d left
    </Badge>
  );
};

export default SubscriptionBadge;
