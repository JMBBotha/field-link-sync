import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useRole } from "@/hooks/useRole";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Loader2, Link2, Unlink, Phone, Mail } from "lucide-react";
import { format } from "date-fns";
import { applicationsOf, freelancersOf, activeAffiliation } from "@/lib/teamGroups";

const INVALIDATE = ["network-agents", "pending-applicants", "company-affiliations", "team-members", "dispatch-techs"];

/** Shared data for the Freelancers and Applications tabs. */
function useTeamNetwork() {
  const { companyId } = useUserCompanyId();
  const agentsQ = useQuery({
    queryKey: ["network-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, skills, participant_type, network_status, created_at, archived_at")
        .in("participant_type", ["independent_sales", "independent_tech"] as any)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const affQ = useQuery({
    queryKey: ["company-affiliations", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_affiliations")
        .select("id, profile_id, affiliation_type, status, listed_as_staff")
        .eq("company_id", companyId!);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  return { companyId, agents: agentsQ.data ?? [], affiliations: affQ.data ?? [], isLoading: agentsQ.isLoading };
}

const typeBadge = (type: string) => (
  <Badge variant="outline" className="text-xs">{type === "independent_sales" ? "Sales" : "Technician"}</Badge>
);

const statusBadge = (status: string | null) => {
  switch (status) {
    case "approved": return <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Approved</Badge>;
    case "rejected": return <Badge variant="destructive">Rejected</Badge>;
    case "suspended": return <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30">Suspended</Badge>;
    default: return <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30">Pending</Badge>;
  }
};

export function TeamFreelancersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useRole();
  const { agents, affiliations, isLoading } = useTeamNetwork();
  const list = freelancersOf(agents, affiliations);

  const remove = useMutation({
    mutationFn: async (affiliationId: string) => {
      const { error } = await supabase.from("agent_affiliations").update({ status: "inactive" }).eq("id", affiliationId);
      if (error) throw error;
    },
    onSuccess: () => {
      INVALIDATE.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      toast({ title: "Connection removed" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  if (list.length === 0) return <div className="text-center py-12 text-muted-foreground">No freelancers connected yet.</div>;
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Connection</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((a) => {
            const affil: any = activeAffiliation(a.id, affiliations);
            return (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.full_name}</TableCell>
                <TableCell className="text-sm">{a.phone || "—"}</TableCell>
                <TableCell>{typeBadge(a.participant_type)}</TableCell>
                <TableCell><Badge className="bg-primary/20 text-primary border-primary/30 text-xs">{affil?.affiliation_type}</Badge></TableCell>
                <TableCell className="text-right">
                  {isAdmin && affil && (
                    <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                      disabled={remove.isPending}
                      onClick={() => confirm(`Remove connection with ${a.full_name}?`) && remove.mutate(affil.id)}>
                      <Unlink className="h-4 w-4 mr-1" />Remove connection
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export default function TeamApplicationsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { companyId, agents, affiliations, isLoading } = useTeamNetwork();
  const [affiliateDialogAgent, setAffiliateDialogAgent] = useState<any>(null);
  const [affiliationType, setAffiliationType] = useState("technical");
  const [detail, setDetail] = useState<any>(null);
  const { data: detailEmail } = useQuery({
    queryKey: ["applicant-email", detail?.id],
    queryFn: async () => {
      const { data } = await supabase.rpc("get_applicant_email" as any, { _id: detail.id });
      return (data as string) || null;
    },
    enabled: !!detail?.id,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, type }: { id: string; status: string; type?: string }) => {
      const { data, error } = await supabase.from("profiles").update({ network_status: status } as any).eq("id", id).select("id");
      if (error || !data?.length) throw error || new Error("Not allowed to update this applicant");
      if (!companyId) return;
      if (status === "approved") {
        const { error: e2 } = await supabase.from("agent_affiliations").upsert({
          profile_id: id, company_id: companyId, affiliation_type: type === "independent_sales" ? "sales" : "technical",
          status: "active", approved_at: new Date().toISOString(), approved_by: user?.id || null,
        }, { onConflict: "company_id,profile_id" });
        if (e2) throw e2;
      } else {
        await supabase.from("agent_affiliations").update({ status: "inactive" }).eq("company_id", companyId).eq("profile_id", id);
      }
    },
    onSuccess: (_, vars) => {
      INVALIDATE.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      setDetail(null);
      toast({ title: vars.status === "approved" ? "Approved, now listed under Freelancers" : "Applicant rejected" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const affiliateMutation = useMutation({
    mutationFn: async ({ agentId, type }: { agentId: string; type: string }) => {
      const { error } = await supabase.from("agent_affiliations").upsert({
        profile_id: agentId, company_id: companyId!, affiliation_type: type, status: "active",
        approved_at: new Date().toISOString(), approved_by: user?.id || null,
      }, { onConflict: "company_id,profile_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Connected, now listed under Freelancers" });
      INVALIDATE.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      setAffiliateDialogAgent(null);
    },
    onError: (err: any) => toast({ title: "Connect failed", description: err.message, variant: "destructive" }),
  });

  const list = applicationsOf(agents, affiliations);

  return (
    <div className="space-y-4">
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No applications waiting for review.</div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((agent) => (
                <TableRow key={agent.id} className="cursor-pointer" onClick={() => setDetail(agent)}>
                  <TableCell>
                    <div className="font-medium text-primary hover:underline">{agent.full_name}</div>
                    {agent.skills?.[0] && <div className="text-xs text-muted-foreground line-clamp-2 max-w-xs">{agent.skills[0]}</div>}
                  </TableCell>
                  <TableCell>{typeBadge(agent.participant_type)}</TableCell>
                  <TableCell className="text-sm">{agent.phone || "—"}</TableCell>
                  <TableCell>{statusBadge(agent.network_status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{format(new Date(agent.created_at), "dd MMM yyyy")}</TableCell>
                  <TableCell className="text-right">
                    {isAdmin && (
                      <div className="flex gap-1 justify-end flex-wrap" onClick={(e) => e.stopPropagation()}>
                        {agent.network_status !== "approved" && (
                          <Button size="sm" variant="ghost" className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
                            onClick={() => updateStatus.mutate({ id: agent.id, status: "approved", type: agent.participant_type })}
                            disabled={updateStatus.isPending}>
                            <CheckCircle2 className="h-4 w-4 mr-1" />Approve
                          </Button>
                        )}
                        {agent.network_status !== "rejected" && (
                          <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => confirm(`Reject ${agent.full_name}?`) && updateStatus.mutate({ id: agent.id, status: "rejected" })}
                            disabled={updateStatus.isPending}>
                            <XCircle className="h-4 w-4 mr-1" />Reject
                          </Button>
                        )}
                        {agent.network_status === "approved" && companyId && (
                          <Button size="sm" variant="ghost" className="text-primary hover:bg-primary/10"
                            onClick={() => {
                              setAffiliateDialogAgent(agent);
                              setAffiliationType(agent.participant_type === "independent_sales" ? "sales" : "technical");
                            }}>
                            <Link2 className="h-4 w-4 mr-1" />Connect
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{detail?.full_name}</DialogTitle>
            <DialogDescription>
              Applied as {detail?.participant_type === "independent_sales" ? "Sales agent" : "Technician"}
              {detail && ` · ${format(new Date(detail.created_at), "dd MMM yyyy, HH:mm")}`}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">{statusBadge(detail.network_status)}</div>
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4 text-muted-foreground" />
                {detail.phone ? <a href={`tel:${detail.phone}`} className="text-primary hover:underline">{detail.phone}</a> : <span className="text-muted-foreground">No phone given</span>}
              </div>
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                {detailEmail ? <a href={`mailto:${detailEmail}`} className="text-primary hover:underline">{detailEmail}</a> : <span className="text-muted-foreground">No email</span>}
              </div>
              <div>
                <p className="font-medium mb-1">Skills & experience</p>
                {detail.skills?.length ? (
                  <ul className="list-disc pl-5 space-y-1">{detail.skills.map((sk: string, i: number) => <li key={i} className="whitespace-pre-wrap">{sk}</li>)}</ul>
                ) : <p className="text-muted-foreground">None given</p>}
              </div>
            </div>
          )}
          {isAdmin && (
            <DialogFooter className="gap-2">
              {detail && detail.network_status !== "rejected" && (
                <Button variant="outline" className="text-red-500" disabled={updateStatus.isPending}
                  onClick={() => confirm(`Reject ${detail.full_name}?`) && updateStatus.mutate({ id: detail.id, status: "rejected" })}>
                  <XCircle className="h-4 w-4 mr-1" />Reject
                </Button>
              )}
              {detail && detail.network_status !== "approved" && (
                <Button disabled={updateStatus.isPending || !companyId}
                  onClick={() => updateStatus.mutate({ id: detail.id, status: "approved", type: detail.participant_type })}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />Approve
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!affiliateDialogAgent} onOpenChange={(open) => { if (!open) setAffiliateDialogAgent(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect freelancer</DialogTitle>
            <DialogDescription>Connect {affiliateDialogAgent?.full_name} to your company.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Connection type</Label>
              <Select value={affiliationType} onValueChange={setAffiliationType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales">Sales</SelectItem>
                  <SelectItem value="technical">Technical</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAffiliateDialogAgent(null)}>Cancel</Button>
            <Button disabled={affiliateMutation.isPending}
              onClick={() => affiliateDialogAgent && affiliateMutation.mutate({ agentId: affiliateDialogAgent.id, type: affiliationType })}>
              {affiliateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
