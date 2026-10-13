import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useRole } from "@/hooks/useRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { CONTRACT_VERSION, contractTerms } from "@/lib/companyPlan";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

/**
 * Shown once, at signup, to NEW companies (plan_status = pending_contract) until an admin accepts.
 * Existing companies were grandfathered as active and never see it. Terms come from the database.
 */
export function ContractGate({ children }: { children: React.ReactNode }) {
  const { companyId } = useUserCompanyId();
  const { isAdmin } = useRole();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: co } = useQuery({
    queryKey: ["company-contract", companyId],
    enabled: !!companyId,
    staleTime: 5 * 60_000,
    queryFn: async () => (await db.from("companies").select("name, plan_status, contract_signed_at, plan_base_price_zar, plan_included_users, plan_extra_user_price_zar, plan_contract_months").eq("id", companyId).maybeSingle()).data,
  });
  if (!co || co.contract_signed_at || co.plan_status !== "pending_contract") return <>{children}</>;
  const terms = contractTerms({ base: Number(co.plan_base_price_zar), included: Number(co.plan_included_users), extra: Number(co.plan_extra_user_price_zar), months: Number(co.plan_contract_months) });
  const accept = async () => {
    setBusy(true); setErr(null);
    const { error } = await db.rpc("accept_company_contract", { p_signer_name: name, p_version: CONTRACT_VERSION, p_user_agent: navigator.userAgent.slice(0, 300) });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await qc.invalidateQueries({ queryKey: ["company-contract", companyId] });
  };
  return (
    <div className="mx-auto max-w-xl p-4" data-testid="contract-gate">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><FileSignature className="h-5 w-5" /> Your Field Lynk agreement</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">{String(co.name || "").trim()} · agreement version {CONTRACT_VERSION}</p>
          <ul className="list-disc space-y-1.5 pl-5">{terms.map((t) => <li key={t}>{t}</li>)}</ul>
          {isAdmin ? (
            <>
              <label className="flex items-start gap-2"><Checkbox className="mt-0.5 shrink-0" checked={agree} onCheckedChange={(v) => setAgree(v === true)} /><span>I accept this {co.plan_contract_months}-month agreement on behalf of the company.</span></label>
              <Input placeholder="Type your full name to sign" value={name} onChange={(e) => setName(e.target.value)} />
              {err && <p className="text-destructive">{err}</p>}
              <Button className="w-full" disabled={!agree || name.trim().length < 3 || busy} onClick={accept}>{busy ? "Saving…" : "Accept and continue"}</Button>
            </>
          ) : (
            <p className="rounded-md bg-muted p-3">Your company's owner needs to accept the agreement before the app opens. Please ask them to sign in.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
