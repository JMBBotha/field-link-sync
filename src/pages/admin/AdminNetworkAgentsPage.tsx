import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Clock, Loader2, Users, Link2, Unlink } from "lucide-react";
import { format } from "date-fns";

const AdminNetworkAgentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { companyId } = useUserCompanyId();
  const [affiliateDialogAgent, setAffiliateDialogAgent] = useState<any>(null);
  const [affiliationType, setAffiliationType] = useState("technical");

  // All independent agents
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["network-agents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, phone, participant_type, network_status, created_at")
        .in("participant_type", ["independent_sales", "independent_tech"] as any)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Existing affiliations for this company
  const { data: affiliations = [] } = useQuery({
    queryKey: ["company-affiliations", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data, error } = await supabase
        .from("agent_affiliations")
        .select("id, profile_id, affiliation_type, status")
        .eq("company_id", companyId);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ network_status: status } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["network-agents"] });
      toast({ title: `Agent ${vars.status === "approved" ? "approved" : "rejected"}` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Create affiliation
  const affiliateMutation = useMutation({
    mutationFn: async ({ agentId, type }: { agentId: string; type: string }) => {
      const { data: session } = await supabase.auth.getSession();
      const { error } = await supabase.from("agent_affiliations").insert({
        profile_id: agentId,
        company_id: companyId!,
        affiliation_type: type,
        status: "active",
        approved_at: new Date().toISOString(),
        approved_by: session.session?.user.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Agent affiliated with your company" });
      queryClient.invalidateQueries({ queryKey: ["company-affiliations"] });
      setAffiliateDialogAgent(null);
    },
    onError: (err: any) => {
      toast({ title: "Affiliation failed", description: err.message, variant: "destructive" });
    },
  });

  // Remove affiliation
  const removeAffiliationMutation = useMutation({
    mutationFn: async (affiliationId: string) => {
      const { error } = await supabase
        .from("agent_affiliations")
        .update({ status: "inactive" })
        .eq("id", affiliationId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Affiliation removed" });
      queryClient.invalidateQueries({ queryKey: ["company-affiliations"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getAffiliation = (agentId: string) =>
    affiliations.find((a: any) => a.profile_id === agentId && a.status === "active");

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "approved":
        return <Badge className="bg-green-600/20 text-green-400 border-green-600/30">Approved</Badge>;
      case "rejected":
        return <Badge variant="destructive">Rejected</Badge>;
      case "suspended":
        return <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30">Suspended</Badge>;
      default:
        return <Badge className="bg-blue-600/20 text-blue-400 border-blue-600/30">Pending</Badge>;
    }
  };

  const typeBadge = (type: string) => {
    return type === "independent_sales" ? (
      <Badge variant="outline" className="text-xs">Sales</Badge>
    ) : (
      <Badge variant="outline" className="text-xs">Technician</Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Network Agents</h1>
          <p className="text-sm text-muted-foreground">
            Manage independent agent applications, approvals, and company affiliations
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : agents.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No independent agent applications yet.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Affiliated</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => {
                const affil = getAffiliation(agent.id);
                return (
                  <TableRow key={agent.id}>
                    <TableCell>
                      <div className="font-medium">{agent.full_name}</div>
                    </TableCell>
                    <TableCell>{typeBadge(agent.participant_type)}</TableCell>
                    <TableCell className="text-sm">{agent.phone || "—"}</TableCell>
                    <TableCell>{statusBadge(agent.network_status)}</TableCell>
                    <TableCell>
                      {affil ? (
                        <Badge className="bg-primary/20 text-primary border-primary/30 text-xs">
                          {affil.affiliation_type}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {format(new Date(agent.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        {agent.network_status !== "approved" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-green-500 hover:text-green-400 hover:bg-green-500/10"
                            onClick={() => updateStatus.mutate({ id: agent.id, status: "approved" })}
                            disabled={updateStatus.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                            Approve
                          </Button>
                        )}
                        {agent.network_status !== "rejected" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => updateStatus.mutate({ id: agent.id, status: "rejected" })}
                            disabled={updateStatus.isPending}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        )}
                        {agent.network_status === "approved" && !affil && companyId && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-primary hover:bg-primary/10"
                            onClick={() => {
                              setAffiliateDialogAgent(agent);
                              setAffiliationType(
                                agent.participant_type === "independent_sales" ? "sales" : "technical"
                              );
                            }}
                          >
                            <Link2 className="h-4 w-4 mr-1" />
                            Affiliate
                          </Button>
                        )}
                        {affil && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => removeAffiliationMutation.mutate(affil.id)}
                            disabled={removeAffiliationMutation.isPending}
                          >
                            <Unlink className="h-4 w-4 mr-1" />
                            Remove
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Affiliate Dialog */}
      <Dialog open={!!affiliateDialogAgent} onOpenChange={(open) => { if (!open) setAffiliateDialogAgent(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Affiliate Agent</DialogTitle>
            <DialogDescription>
              Link {affiliateDialogAgent?.full_name} to your company as an affiliated agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Affiliation Type</Label>
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
            <Button
              onClick={() =>
                affiliateDialogAgent &&
                affiliateMutation.mutate({ agentId: affiliateDialogAgent.id, type: affiliationType })
              }
              disabled={affiliateMutation.isPending}
            >
              {affiliateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Affiliation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminNetworkAgentsPage;
