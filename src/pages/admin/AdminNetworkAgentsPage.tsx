import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, Clock, Loader2, Users } from "lucide-react";
import { format } from "date-fns";

const AdminNetworkAgentsPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
            Manage independent agent applications and approvals
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
                <TableHead>Applied</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell>
                    <div className="font-medium">{agent.full_name}</div>
                  </TableCell>
                  <TableCell>{typeBadge(agent.participant_type)}</TableCell>
                  <TableCell className="text-sm">{agent.phone || "—"}</TableCell>
                  <TableCell>{statusBadge(agent.network_status)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(agent.created_at), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex gap-1 justify-end">
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default AdminNetworkAgentsPage;
