import { useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useAssistantContextStore, type AssistantUiContext } from "@/stores/assistantContextStore";

/** Map a route path to a short, speakable page name. */
export function pageNameFromPath(pathname: string): string {
  const p = pathname.replace(/^\/admin\/?/, "").split("?")[0];
  if (!p) return "dashboard";
  const seg = p.split("/");
  const map: Record<string, string> = {
    "": "dashboard",
    map: "map",
    "jobs-map": "jobs map",
    dispatch: "dispatch",
    "unassigned-queue": "unassigned queue",
    leads: "leads",
    jobs: "jobs",
    "my-jobs": "my jobs",
    schedule: "schedule",
    quotes: "quotes",
    estimates: "quotes",
    invoices: "invoices",
    customers: "customers",
    catalog: "catalog",
    inventory: "inventory",
    maintenance: "maintenance",
    reports: "reports",
    analytics: "analytics",
    "change-requests": "change requests",
    settings: "settings",
  };
  return map[seg[0]] ?? seg[0].replace(/-/g, " ");
}

/**
 * Keeps the assistant's live UI context in sync with navigation and the
 * signed-in user. Mounted once inside the admin shell.
 */
export function useAssistantContextTracker() {
  const location = useLocation();
  const params = useParams();
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const setContext = useAssistantContextStore((s) => s.setContext);
  const clearKeys = useAssistantContextStore((s) => s.clearKeys);

  useEffect(() => {
    const name =
      (user?.user_metadata?.full_name as string | undefined) ||
      (user?.email ? user.email.split("@")[0] : undefined);
    setContext({
      user_id: user?.id,
      user_name: name,
      company_id: companyId ?? undefined,
    });
  }, [user?.id, user?.email, user?.user_metadata, companyId, setContext]);

  useEffect(() => {
    const page = pageNameFromPath(location.pathname);
    const patch: Partial<AssistantUiContext> = {
      current_page: page,
      route: location.pathname,
    };
    setContext(patch);

    // Anything opened on a previous screen is no longer on screen.
    const stale: (keyof AssistantUiContext)[] = [];
    if (!location.pathname.includes("/estimates/") && !location.pathname.includes("/quotes/")) {
      stale.push("open_quote_id", "open_quote_number", "open_quote_status");
    }
    if (!location.pathname.includes("/customers/")) {
      stale.push("selected_customer_id", "selected_customer_name");
    }
    if (!location.pathname.includes("/jobs/")) stale.push("open_job_id");
    if (!location.pathname.includes("/invoices/")) stale.push("open_invoice_id");
    if (stale.length) clearKeys(stale);
  }, [location.pathname, setContext, clearKeys, params]);
}

/**
 * Page-level helper: register the record currently open on screen and clear it
 * again on unmount. Safe to call with partially-loaded data.
 */
export function useRegisterAssistantContext(patch: Partial<AssistantUiContext>) {
  const setContext = useAssistantContextStore((s) => s.setContext);
  const clearKeys = useAssistantContextStore((s) => s.clearKeys);
  const serialized = JSON.stringify(patch);

  useEffect(() => {
    const parsed = JSON.parse(serialized) as Partial<AssistantUiContext>;
    setContext(parsed);
    return () => clearKeys(Object.keys(parsed) as (keyof AssistantUiContext)[]);
  }, [serialized, setContext, clearKeys]);
}
