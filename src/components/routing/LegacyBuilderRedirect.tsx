import { Navigate, useLocation } from "react-router-dom";

/** One-builder rule: legacy proposal-builder URLs go to the orange builder, keeping the params it supports. */
export function legacyBuilderTarget(search: string): string {
  const src = new URLSearchParams(search);
  const out = new URLSearchParams();
  const quoteId = src.get("quoteId");
  const leadId = src.get("leadId") || src.get("fromLead");
  const customerId = src.get("customerId") || src.get("clientId");
  if (quoteId) out.set("quoteId", quoteId);
  if (leadId) out.set("leadId", leadId);
  if (customerId) out.set("customerId", customerId);
  const qs = out.toString();
  return qs ? `/admin/quote-builder?${qs}` : "/admin/quote-builder";
}

const LegacyBuilderRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={legacyBuilderTarget(search)} replace />;
};

export default LegacyBuilderRedirect;
