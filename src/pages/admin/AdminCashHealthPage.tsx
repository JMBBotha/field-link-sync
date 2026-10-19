import { Navigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCashflowAccess } from "@/hooks/useCashflow";
import { useCashHealth, useCashHealthEnabled } from "@/hooks/useCashHealth";
import CashHealthView, { type CashTab } from "@/components/cashhealth/CashHealthView";

/** Cash-flow health (phase 1). Owner/management only (_cf_ok, same as /admin/cashflow) and hidden until cf_settings.enabled is switched on. */
export default function AdminCashHealthPage() {
  const { toast } = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as CashTab) || "overview";
  const access = useCashflowAccess();
  const flag = useCashHealthEnabled();
  const ok = !!access.allowed && flag.enabled;
  const q = useCashHealth(access.companyId, ok);
  if (access.loading || flag.loading) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!ok) return <Navigate to="/admin/cashflow" replace />;
  if (q.isError) return <div className="p-6 text-sm text-red-600">Cash-flow health couldn't load: {(q.error as Error)?.message}</div>;
  if (!q.data) return <div className="p-6"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  return <CashHealthView tab={tab} onTab={(t) => setSp(t === "overview" ? {} : { tab: t }, { replace: true })} data={q.data} actions={q.actions} notify={(msg, error) => toast({ title: msg, variant: error ? "destructive" : undefined })} />;
}
