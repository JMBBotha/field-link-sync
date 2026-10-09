import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSalesRep } from "@/hooks/useSalesRep";

/** Where a salesperson lands instead of a technician /field screen (Johan 18:58: one clear experience per role). */
export function salesHomeFor(pathname: string, search = ""): string {
  if (pathname.startsWith("/field/quote-builder")) return `/admin/quote-builder${search}`;
  if (pathname.startsWith("/field/schedule")) return "/admin/my-appointments";
  return "/admin/visits";
}

/**
 * Sales reps (dispatcher + sales lane, not admin) use My visits and the admin layout, not /field.
 * Everything they used on /field is in the sales layout: Accept (My visits → Available),
 * Release / Call / Navigate (visit detail), Create quote (same unified builder).
 * Admins, office dispatchers and technicians are unaffected.
 */
export default function SalesRepFieldRedirect({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const { isSalesRep, loading } = useSalesRep();
  if (loading) return null;
  if (isSalesRep) return <Navigate to={salesHomeFor(pathname, search)} replace />;
  return <>{children}</>;
}
