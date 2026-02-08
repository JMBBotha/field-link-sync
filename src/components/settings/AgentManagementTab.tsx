import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, UserCheck, UserX } from "lucide-react";
import { format } from "date-fns";

const AgentManagementTab = () => {
  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["agents-with-roles"],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("user_id, role, created_at");
      if (error) throw error;

      const userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, phone, availability_status")
        .in("id", userIds);

      const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

      const grouped = new Map<string, { roles: string[]; created_at: string }>();
      for (const r of roles || []) {
        const existing = grouped.get(r.user_id);
        if (existing) {
          existing.roles.push(r.role);
        } else {
          grouped.set(r.user_id, { roles: [r.role], created_at: r.created_at || "" });
        }
      }

      return Array.from(grouped.entries()).map(([userId, info]) => {
        const profile = profileMap.get(userId);
        return {
          id: userId,
          full_name: profile?.full_name || "Unknown",
          phone: profile?.phone || "-",
          availability: profile?.availability_status || "offline",
          roles: info.roles,
          joined: info.created_at,
        };
      });
    },
  });

  if (isLoading) return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Team Members</h3>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((agent) => (
                <TableRow key={agent.id}>
                  <TableCell className="font-medium">{agent.full_name}</TableCell>
                  <TableCell>{agent.phone}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {agent.roles.map((r) => (
                        <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>{r}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {agent.availability === "available" ? (
                        <UserCheck className="h-4 w-4 text-green-500" />
                      ) : (
                        <UserX className="h-4 w-4 text-muted-foreground" />
                      )}
                      <span className="text-sm capitalize">{agent.availability}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {agent.joined ? format(new Date(agent.joined), "dd MMM yyyy") : "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default AgentManagementTab;
