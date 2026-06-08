import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

export type SubscriptionStatus = "trial" | "active" | "expired" | "canceled";
export type SubscriptionPlan = "free" | "pro" | "enterprise";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  plan: SubscriptionPlan;
  trialEndsAt: Date | null;
  trialDaysLeft: number;
  jobsLimit: number;
  stripeCustomerId: string | null;
  isTrialActive: boolean;
  isProActive: boolean;
  isExpired: boolean;
  canCreateJobs: boolean;
  loading: boolean;
}

export const useSubscription = (): SubscriptionInfo => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const { data: profile, isLoading } = useQuery({
    queryKey: ["subscription", userId],
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("subscription_status, subscription_plan, trial_ends_at, jobs_limit, stripe_customer_id")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  const { data: jobCount = 0 } = useQuery({
    queryKey: ["job-count", userId],
    queryFn: async () => {
      if (!userId) return 0;
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { count, error } = await supabase
        .from("leads")
        .select("*", { count: "exact", head: true })
        .eq("assigned_agent_id", userId)
        .gte("created_at", startOfMonth.toISOString());
      if (error) throw error;
      return count || 0;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  return useMemo(() => {
    const status = (profile?.subscription_status || "trial") as SubscriptionStatus;
    const plan = (profile?.subscription_plan || "free") as SubscriptionPlan;
    const trialEndsAt = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
    const jobsLimit = profile?.jobs_limit ?? 50;
    const stripeCustomerId = profile?.stripe_customer_id || null;

    const now = new Date();
    const trialDaysLeft = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    const isTrialActive = status === "trial" && trialDaysLeft > 0;
    const isProActive = status === "active" && (plan === "pro" || plan === "enterprise");
    const isExpired = status === "expired" || (status === "trial" && trialDaysLeft <= 0);
    const canCreateJobs = isProActive || (isTrialActive && jobCount < jobsLimit);

    return {
      status,
      plan,
      trialEndsAt,
      trialDaysLeft,
      jobsLimit,
      stripeCustomerId,
      isTrialActive,
      isProActive,
      isExpired,
      canCreateJobs,
      loading: authLoading || isLoading,
    };
  }, [profile, isLoading, authLoading, jobCount]);
};
