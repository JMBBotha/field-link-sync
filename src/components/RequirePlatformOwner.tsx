import { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** Server-checked Massair-only flag (public.is_platform_owner()). Partner-company admins get false. */
export function usePlatformOwner() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["is-platform-owner", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("is_platform_owner");
      if (error) return false; // fail closed
      return data === true;
    },
  });
  return { isPlatformOwner: data === true, loading: !!user?.id && isLoading };
}

/** Massair-only route gate (AUDIT_v7 R1): /admin/companies, /admin/audit, /admin/import, /admin/reports/advanced, /client/:companyId/*. */
export default function RequirePlatformOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { isPlatformOwner, loading } = usePlatformOwner();
  if (!user?.id || loading) return null;
  if (!isPlatformOwner) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center" data-testid="platform-access-denied">
        <Shield className="h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Access Denied</h2>
        <p className="max-w-sm text-sm text-muted-foreground">This page is only available to the Massair CT (Pty) Ltd platform team.</p>
      </div>
    );
  }
  return <>{children}</>;
}
