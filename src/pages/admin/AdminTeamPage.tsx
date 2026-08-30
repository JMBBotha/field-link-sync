import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  UserPlus, Users, Shield, Eye, Wrench, LayoutGrid,
  ChevronDown, ChevronRight, Loader2, Trash2, Clock, Activity,
} from "lucide-react";
import { format } from "date-fns";
import type { AppRole } from "@/hooks/useRole";
import AgentAvailabilityEditor from "@/components/scheduling/AgentAvailabilityEditor";

const ROLE_META: Record<string, { label: string; color: string; icon: React.ElementType; description: string }> = {
  admin: { label: "Admin", color: "bg-purple-600 text-purple-50", icon: Shield, description: "Full access to all features" },
  dispatcher: { label: "Dispatcher", color: "bg-blue-600 text-blue-50", icon: LayoutGrid, description: "Dashboard, dispatch, reports" },
  field_agent: { label: "Technician", color: "bg-emerald-600 text-emerald-50", icon: Wrench, description: "Field view only" },
  viewer: { label: "Viewer", color: "bg-gray-600 text-gray-50", icon: Eye, description: "Read-only access" },
};

const AdminTeamPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("field_agent");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [availabilityUser, setAvailabilityUser] = useState<string | null>(null);

  // Fetch team members
  const { data: members = [], isLoading } = useQuery({
    queryKey: ["team-members"],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("user_roles")
        .select("user_id, role, created_at");
      if (error) throw error;

      const userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name, phone, avatar_url, availability_status, updated_at, dispatch_role, participant_type")
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
          phone: profile?.phone || "",
          avatar_url: profile?.avatar_url,
          availability: profile?.availability_status || "offline",
          dispatch_role: (profile as any)?.dispatch_role || null,
          participant_type: (profile as any)?.participant_type || null,
          last_active: profile?.updated_at || "",
          roles: info.roles,
          joined: info.created_at,
        };
      });
    },
  });

  // Fetch activity log for expanded user
  const { data: activityLog = [], isLoading: activityLoading } = useQuery({
    queryKey: ["user-activity", expandedUser],
    queryFn: async () => {
      if (!expandedUser) return [];
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, table_name, record_id, created_at")
        .eq("user_id", expandedUser)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!expandedUser,
  });

  // Change role mutation
  const changeRoleMutation = useMutation({
    mutationFn: async ({ userId, oldRole, newRole }: { userId: string; oldRole: string; newRole: string }) => {
      // Delete old role
      const { error: delErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", oldRole as AppRole);
      if (delErr) throw delErr;
      // Insert new role
      const { error: insErr } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role: newRole as AppRole });
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      toast({ title: "Role updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
    },
  });

  // Dispatch lane (sales vs technician) mutation
  const changeLaneMutation = useMutation({
    mutationFn: async ({ userId, dispatchRole }: { userId: string; dispatchRole: string | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ dispatch_role: dispatchRole })
        .eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["lane-staff"] });
      toast({ title: "Dispatch lane updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update lane", description: err.message, variant: "destructive" });
    },
  });

  // Remove user role mutation
  const removeRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", role as AppRole);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      toast({ title: "Role removed" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to remove role", description: err.message, variant: "destructive" });
    },
  });

  // Invite user mutation
  const inviteMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      // Sign up user with a random password (they'll use magic link / reset)
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password: crypto.randomUUID(), // temp password, user resets
      });
      if (signUpErr) throw signUpErr;
      if (!signUpData.user) throw new Error("Failed to create user");

      // Assign role
      const { error: roleErr } = await supabase
        .from("user_roles")
        .insert({ user_id: signUpData.user.id, role: role as AppRole });
      if (roleErr) throw roleErr;

      return signUpData.user;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("field_agent");
      toast({ title: "Invitation sent", description: "User will receive an email to set up their account." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to invite user", description: err.message, variant: "destructive" });
    },
  });

  const roleStats = useMemo(() => {
    const stats: Record<string, number> = {};
    members.forEach((m) => m.roles.forEach((r) => { stats[r] = (stats[r] || 0) + 1; }));
    return stats;
  }, [members]);

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Team Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{members.length} team member{members.length !== 1 ? "s" : ""}</p>
        </div>

        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="h-4 w-4" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  placeholder="team@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_META).map(([key, meta]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <meta.icon className="h-3.5 w-3.5" />
                          <span>{meta.label}</span>
                          <span className="text-xs text-muted-foreground">— {meta.description}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full"
                onClick={() => inviteMutation.mutate({ email: inviteEmail, role: inviteRole })}
                disabled={!inviteEmail || inviteMutation.isPending}
              >
                {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                Send Invitation
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Role Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(ROLE_META).map(([key, meta]) => (
          <Card key={key} className="border-border/50">
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`p-2 rounded-lg ${meta.color}`}>
                <meta.icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{roleStats[key] || 0}</p>
                <p className="text-xs text-muted-foreground">{meta.label}s</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Team Table */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">All Members</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50">
                  <TableHead className="w-8"></TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Dispatch Lane</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-border/30">
                {members.map((member) => {
                  const isExpanded = expandedUser === member.id;
                  return (
                    <Collapsible key={member.id} open={isExpanded} onOpenChange={(open) => setExpandedUser(open ? member.id : null)} asChild>
                      <>
                        <TableRow className="hover:bg-muted/30 border-border/30">
                          <TableCell className="py-3">
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6">
                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </Button>
                            </CollapsibleTrigger>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{member.full_name}</TableCell>
                          <TableCell className="text-muted-foreground">{member.phone || "—"}</TableCell>
                          <TableCell>
                            <div className="flex gap-1.5 flex-wrap">
                              {member.roles.map((r) => {
                                const meta = ROLE_META[r];
                                return (
                                  <span key={r} className={`${meta?.color || "bg-muted text-muted-foreground"} text-xs px-2 py-0.5 rounded-full font-medium`}>
                                    {meta?.label || r}
                                  </span>
                                );
                              })}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${member.availability === "available" ? "bg-emerald-500" : member.availability === "busy" ? "bg-amber-500" : "bg-muted-foreground/40"}`} />
                              <span className="text-sm capitalize text-muted-foreground">{member.availability}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {member.last_active ? format(new Date(member.last_active), "dd MMM, HH:mm") : "—"}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={member.roles[0]}
                              onValueChange={(newRole) => {
                                if (newRole !== member.roles[0]) {
                                  changeRoleMutation.mutate({ userId: member.id, oldRole: member.roles[0], newRole });
                                }
                              }}
                            >
                              <SelectTrigger className="h-7 w-[120px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(ROLE_META).map(([key, meta]) => (
                                  <SelectItem key={key} value={key} className="text-xs">
                                    {meta.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                        <CollapsibleContent asChild>
                          <tr>
                            <td colSpan={7} className="p-0">
                              <div className="bg-muted/20 border-t border-border/30 p-4">
                                <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                                  <Activity className="h-4 w-4 text-primary" />
                                  Recent Activity
                                </h4>
                                {activityLoading ? (
                                  <div className="space-y-2">
                                    {[1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}
                                  </div>
                                ) : activityLog.length === 0 ? (
                                  <p className="text-sm text-muted-foreground">No recent activity recorded.</p>
                                ) : (
                                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                    {activityLog.map((log) => (
                                      <div key={log.id} className="flex items-center gap-3 text-sm py-1.5 px-2 rounded hover:bg-muted/30">
                                        <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground w-32 shrink-0">
                                          {format(new Date(log.created_at), "dd MMM HH:mm")}
                                        </span>
                                        <Badge variant="outline" className="text-[10px] shrink-0">{log.action}</Badge>
                                        <span className="text-foreground truncate">
                                          {log.table_name}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="mt-4 pt-3 border-t border-border/30 flex gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-xs"
                                    onClick={() => setAvailabilityUser(member.id)}
                                  >
                                    <Clock className="h-3 w-3 mr-1" /> Set Availability
                                  </Button>
                                  {member.roles.map((r) => (
                                    <Button
                                      key={r}
                                      variant="outline"
                                      size="sm"
                                      className="text-destructive border-destructive/30 hover:bg-destructive/10 text-xs"
                                      onClick={() => {
                                        if (confirm(`Remove ${ROLE_META[r]?.label || r} role from ${member.full_name}?`)) {
                                          removeRoleMutation.mutate({ userId: member.id, role: r });
                                        }
                                      }}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" />
                                      Remove {ROLE_META[r]?.label || r}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Availability Editor Dialog */}
      {availabilityUser && (
        <Dialog open={!!availabilityUser} onOpenChange={(open) => { if (!open) setAvailabilityUser(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Set Weekly Availability</DialogTitle>
            </DialogHeader>
            <AgentAvailabilityEditor agentId={availabilityUser} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default AdminTeamPage;
