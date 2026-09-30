import { ReactNode, useEffect } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useRole, type AppRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { Shield } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RequireRoleProps {
  /** Roles that are allowed to view this route */
  allowedRoles: AppRole[];
  /** Where to redirect if the user lacks the required role */
  redirectTo?: string;
  /** When true, denied users are redirected instead of seeing the Access Denied screen */
  redirectOnDeny?: boolean;
  /** When true, sales reps are treated as having no access */
  denySalesRep?: boolean;
  children: ReactNode;
}

/**
 * Route-level role guard. Wraps a page component and redirects
 * unauthenticated users to /login and unauthorized users to a fallback route.
 *
 * Consumes role from useRole() (which uses useAuth internally) so there is
 * a single source of truth for both session and role data.
 */
const RequireRole = ({ allowedRoles, redirectTo, redirectOnDeny, denySalesRep, children }: RequireRoleProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { session, loading: authLoading } = useAuth();
  const { roles, loading: roleLoading } = useRole();

  const salesRep = useSalesRep();

  const loading = authLoading || roleLoading || (!!denySalesRep && salesRep.loading);
  const hasAccess =
    roles.some((r) => allowedRoles.includes(r)) && !(denySalesRep && salesRep.isSalesRep);

  useEffect(() => {
    // Only fire redirect logic after both auth and role loading are settled.
    if (loading) return;

    if (!session) {
      const isFieldContext =
        typeof window !== "undefined" && window.location.pathname.startsWith("/field");
      navigate(isFieldContext ? "/field" : "/login", { replace: true });
      return;
    }

    if (!hasAccess && !redirectOnDeny) {
      toast({
        title: "Access Denied",
        description: "You don't have permission to view this page.",
        variant: "destructive",
      });
    }
  }, [loading, session, hasAccess, redirectOnDeny, navigate, toast]);

  // Prevent UI flash before auth/role resolution
  if (loading) return null;

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="h-10 w-10 rounded-full bg-primary/40 animate-pulse" />
      </div>
    );
  }

  if (!hasAccess) {
    const fallback = redirectTo || (roles.includes("field_agent") ? "/field" : "/admin");
    if (redirectOnDeny) return <Navigate to={fallback} replace />;
    return (
      <div className="flex min-h-screen items-center justify-center p-8 bg-background">
        <div className="text-center space-y-5 max-w-md">
          <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-destructive" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Access Denied</h2>
            <p className="text-sm text-muted-foreground mt-2">
              You don't have permission to view this page. Contact your administrator if you believe this is an error.
            </p>
            <code className="mt-3 inline-block text-xs bg-muted px-2 py-1 rounded text-muted-foreground">
              {location.pathname}
            </code>
          </div>
          <div className="flex gap-3 justify-center">
            <Button variant="outline" onClick={() => navigate(-1)}>
              Go Back
            </Button>
            <Button onClick={() => navigate(fallback, { replace: true })}>
              Go to Dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default RequireRole;
