import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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

  useEffect(() => {
    const check = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        navigate("/login", { replace: true });
        return;
      }

      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", session.user.id);

      const userRoles = (roles?.map((r) => r.role) || []) as AppRole[];
      const hasAccess = userRoles.some((r) => allowedRoles.includes(r));

      if (!hasAccess) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to view this page.",
          variant: "destructive",
        });
        // Smart redirect: field agents → /field, others → /login
        const fallback = redirectTo || (userRoles.includes("field_agent") ? "/field" : "/admin");
        navigate(fallback, { replace: true });
        return;
      }

      setAuthorized(true);
    };

    check();
  }, [allowedRoles, navigate, redirectTo, toast]);

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
