import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

type AppRole = "admin" | "field_agent" | "dispatcher" | "viewer";

interface RequireRoleProps {
  /** Roles that are allowed to view this route */
  allowedRoles: AppRole[];
  /** Where to redirect if the user lacks the required role */
  redirectTo?: string;
  children: ReactNode;
}

/**
 * Route-level role guard. Wraps a page component and redirects
 * unauthenticated users to /login and unauthorized users to a fallback route.
 */
const RequireRole = ({ allowedRoles, redirectTo, children }: RequireRoleProps) => {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    if (!session) {
      const isFieldContext =
        typeof window !== "undefined" && window.location.pathname.startsWith("/field");
      navigate(isFieldContext ? "/field" : "/login", { replace: true });
      return;
    }

    (async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);
      if (cancelled) return;

      const userRoles = (roles?.map((r) => r.role) || []) as AppRole[];
      const hasAccess = userRoles.some((r) => allowedRoles.includes(r));

      if (!hasAccess) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to view this page.",
          variant: "destructive",
        });
        const fallback =
          redirectTo || (userRoles.includes("field_agent") ? "/field" : "/admin");
        navigate(fallback, { replace: true });
        return;
      }

      setAuthorized(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [allowedRoles, navigate, redirectTo, toast, session, authLoading]);

  if (authorized === null) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="h-10 w-10 rounded-full bg-primary/40 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
};

export default RequireRole;
