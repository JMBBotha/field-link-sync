import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";

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
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUserId(session?.user?.id || null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id || null);
    });

    return () => subscription.unsubscribe();
  }, []);

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
    staleTime: 5 * 60 * 1000,
  });

  const isAdmin = roles.includes("admin");
  const isFieldAgent = roles.includes("field_agent");
  const isDispatcher = roles.includes("dispatcher");
  const isViewer = roles.includes("viewer");

  // Primary role priority: admin > dispatcher > field_agent > viewer
  const role: AppRole | null = isAdmin
    ? "admin"
    : isDispatcher
    ? "dispatcher"
    : isFieldAgent
    ? "field_agent"
    : isViewer
    ? "viewer"
    : null;

  // Can access admin panel (admin + dispatcher + viewer)
  const canAccessAdmin = isAdmin || isDispatcher || isViewer;
  // Can write / modify data
  const canWrite = isAdmin || isDispatcher || isFieldAgent;

  return {
    role,
    roles,
    isAdmin,
    isFieldAgent,
    isDispatcher,
    isViewer,
    canAccessAdmin,
    canWrite,
    userId,
    loading: isLoading || userId === null,
  };
};
