import { ReactNode } from "react";
import { useRole, AppRole } from "@/hooks/useRole";

interface RoleGateProps {
  allowedRoles: AppRole[];
  children: ReactNode;
  fallback?: ReactNode;
}

const RoleGate = ({ allowedRoles, children, fallback = null }: RoleGateProps) => {
  const { roles, loading } = useRole();

  if (loading) return null;

  const hasAccess = roles.some((r) => allowedRoles.includes(r));

  if (!hasAccess) return <>{fallback}</>;

  return <>{children}</>;
};

export default RoleGate;
