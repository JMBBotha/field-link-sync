import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Status = "pending" | "approved" | "rejected" | "removed";
const STATUSES: Status[] = ["pending", "approved", "rejected", "removed"];

/** Master admins only: which companies may read the shared catalogue. */
export default function NetworkMembersCard() {
  const { user } = useAuth();
  const { canWrite } = useCanWriteMasterCatalog();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pick, setPick] = useState<string>("");

  const { data } = useQuery({
    queryKey: ["network-members"],
    enabled: canWrite,
    queryFn: async () => {
      const [c, m] = await Promise.all([
        // names only via the server (other companies' rows aren't readable directly any more)
        (supabase.rpc as any)("network_company_names").then((r: any) => (r.error ? (supabase.from("companies") as any).select("id, name, is_master").order("name") : r)),
        (supabase.from("company_network_members") as any).select("id, master_company_id, member_company_id, status, decided_at"),
      ]);
      if (c.error) throw c.error;
      if (m.error) throw m.error;
      return { companies: (c.data || []) as { id: string; name: string; is_master: boolean }[], members: (m.data || []) as any[] };
    },
  });
  if (!canWrite || !data) return null;
  const master = data.companies.find((c) => c.is_master);
  if (!master) return null;
  const nameOf = (id: string) => data.companies.find((c) => c.id === id)?.name ?? id;
  const memberIds = new Set(data.members.map((m) => m.member_company_id));
  const candidates = data.companies.filter((c) => !c.is_master && !memberIds.has(c.id));
  const refresh = () => qc.invalidateQueries({ queryKey: ["network-members"] });
  const fail = (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" });

  const setStatus = async (id: string, status: Status) => {
    const { error } = await (supabase.from("company_network_members") as any)
      .update({ status, decided_at: new Date().toISOString(), decided_by: user?.id }).eq("id", id);
    if (error) return fail(error);
    refresh();
  };
  const add = async () => {
    if (!pick) return;
    const { error } = await (supabase.from("company_network_members") as any).insert({
      master_company_id: master.id, member_company_id: pick, status: "approved",
      decided_at: new Date().toISOString(), decided_by: user?.id,
    });
    if (error) return fail(error);
    setPick(""); refresh();
  };

  return (
    <Card>
      <CardHeader><CardTitle>Catalogue network</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Approved companies can quote from {master.name}'s price lists. They can't change them.</p>
        {data.members.length === 0 && <p className="text-muted-foreground">No companies in the network yet.</p>}
        {data.members.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="truncate">{nameOf(m.member_company_id)}</span>
            <Select value={m.status} onValueChange={(v) => void setStatus(m.id, v as Status)}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
        {candidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Select value={pick} onValueChange={setPick}>
              <SelectTrigger className="h-8 w-56"><SelectValue placeholder="Add company…" /></SelectTrigger>
              <SelectContent>{candidates.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" onClick={add} disabled={!pick}>Add company</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
