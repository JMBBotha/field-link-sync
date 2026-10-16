import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle } from "lucide-react";
import { SIGNUP_ROLES } from "@/lib/signupRoles";

/**
 * Step 2 of the two-step sign-up rule: Massair CT admins approve sign-ups made through
 * the main system (new companies, company techs/salespeople, Massair CT dual-role staff).
 * Server-side check lives in approve_company_signup(); other users simply see nothing here.
 */
export default function CompanySignupsPanel() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [pick, setPick] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: ["company-signups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .not("signup_role" as any, "is", null)
        .eq("network_status", "pending")
        .order("created_at", { ascending: false });
      if (error) return [];
      return (data || []) as any[];
    },
  });
  const companies = useQuery({
    queryKey: ["signup-companies"],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("id, name").order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const decide = useMutation({
    mutationFn: async (v: { id: string; approve: boolean; company?: string }) => {
      const { data, error } = await (supabase.rpc as any)("approve_company_signup", {
        p_user: v.id, p_approve: v.approve, p_company: v.company ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (r) => {
      toast({ title: r === "approved" ? "Sign-up approved" : "Sign-up rejected" });
      ["company-signups", "team-members", "pending-applicants"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: any) => toast({ title: "Couldn't update", description: e.message, variant: "destructive" }),
  });

  const rows = q.data || [];
  if (!rows.length) return null;
  const title = (r: string) => SIGNUP_ROLES.find((x) => x.id === r)?.title ?? r;

  return (
    <div className="mb-6 rounded-lg border p-4" data-testid="company-signups">
      <h3 className="font-semibold mb-1">Company sign-ups waiting for approval</h3>
      <p className="text-xs text-muted-foreground mb-3">
        New companies can finish setting up once approved. Techs and salespeople join the company you pick; Massair CT staff join Massair CT as sales + technician.
      </p>
      <div className="space-y-2">
        {rows.map((p) => {
          const needsCo = p.signup_role === "company_tech" || p.signup_role === "company_sales";
          return (
            <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
              <div className="flex-1 min-w-[180px]">
                <div className="font-medium">{p.full_name}</div>
                <div className="text-xs text-muted-foreground">
                  <Badge variant="outline" className="mr-1">{title(p.signup_role)}</Badge>
                  {p.signup_company || ""}{p.phone ? ` · ${p.phone}` : ""}
                </div>
              </div>
              {needsCo && (
                <Select value={pick[p.id]} onValueChange={(v) => setPick((s) => ({ ...s, [p.id]: v }))}>
                  <SelectTrigger className="w-[200px] h-8"><SelectValue placeholder="Add to company…" /></SelectTrigger>
                  <SelectContent>
                    {(companies.data || []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Button size="sm" disabled={decide.isPending || (needsCo && !pick[p.id])}
                onClick={() => decide.mutate({ id: p.id, approve: true, company: pick[p.id] })}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Approve
              </Button>
              <Button size="sm" variant="outline" disabled={decide.isPending}
                onClick={() => decide.mutate({ id: p.id, approve: false })}>
                <XCircle className="h-4 w-4 mr-1" />Reject
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
