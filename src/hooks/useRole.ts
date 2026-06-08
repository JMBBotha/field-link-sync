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
    let mounted = true;
    // Register auth listener first so getSession() (which may resolve later)
    // can't clobber a fresher session with a stale one.
    let authStateFired = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      authStateFired = true;
      setUserId(session?.user?.id ?? null);
    });

    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        if (!mounted || authStateFired) return;
        setUserId(session?.user?.id ?? null);
      })
      .catch((err) => {
        console.error("useRole getSession error:", err);
        if (mounted && !authStateFired) setUserId(null);
      });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
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
    loading: isLoading,
  };
};