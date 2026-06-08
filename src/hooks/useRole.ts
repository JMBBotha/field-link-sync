import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "field_agent" | "dispatcher" | "viewer";

interface UseRoleReturn {
  role: AppRole | null;
  roles: AppRole[];
  isAdmin: boolean;
  isFieldAgent: boolean;
  isDispatcher: boolean;
  isViewer: boolean;
  canAccessAdmin: boolean;
  canWrite: boolean;
  userId: string | null;
  loading: boolean;
}

export const useRole = (): UseRoleReturn => {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["user-roles", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);

      if (error) throw error;
      return (data?.map((r) => r.role) || []) as AppRole[];
    },
    enabled: !!userId,
  });

  const isAdmin = roles.includes("admin");
  const isFieldAgent = roles.includes("field_agent");
  const isDispatcher = roles.includes("dispatcher");
  const isViewer = roles.includes("viewer");

  return {
    role: roles[0] || null,
    roles,
    isAdmin,
    isFieldAgent,
    isDispatcher,
    isViewer,
    canAccessAdmin: isAdmin || isDispatcher,
    canWrite: isAdmin || isFieldAgent || isDispatcher,
    userId,
    loading: authLoading || isLoading,
  };
};
