import { ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useRole, type AppRole } from "@/hooks/useRole";

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
 *
 * Consumes role from useRole() (which uses useAuth internally) so there is
 * a single source of truth for both session and role data.
 */
const RequireRole = ({ allowedRoles, redirectTo, children }: RequireRoleProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const { roles, loading: roleLoading } = useRole();

  const loading = authLoading || roleLoading;
  const hasAccess = roles.some((r) => allowedRoles.includes(r));

  useEffect(() => {
    // Only fire redirect logic after both auth and role loading are settled.
    if (loading) return;

    if (!session) {
      const isFieldContext =
        typeof window !== "undefined" && window.location.pathname.startsWith("/field");
      navigate(isFieldContext ? "/field" : "/login", { replace: true });
      return;
    }

    if (!hasAccess) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to view this page.",
        variant: "destructive",
      });
      const fallback =
        redirectTo || (roles.includes("field_agent") ? "/field" : "/admin");
      navigate(fallback, { replace: true });
    }
  }, [loading, session, hasAccess, roles, allowedRoles, navigate, redirectTo, toast]);

  // Prevent UI flash before auth/role resolution
  if (loading) return null;
  if (!session || !hasAccess) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="h-10 w-10 rounded-full bg-primary/40 animate-pulse" />
      </div>
    );
  }

  return <>{children}</>;
};

export default RequireRole;
