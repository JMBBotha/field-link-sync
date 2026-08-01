import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

const SyncConflictsSection = () => {
  const { data: conflicts, isLoading } = useQuery({
    queryKey: ["sync-conflicts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sync_conflicts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000,
  });

  const resolutionColor: Record<string, string> = {
    pending: "bg-amber-500",
    keep_local: "bg-blue-500",
    use_server: "bg-green-500",
    auto_lww: "bg-muted-foreground",
  };

  const resolutionLabel: Record<string, string> = {
    pending: "Pending",
    keep_local: "Agent Kept",
    use_server: "Used Server",
    auto_lww: "Auto (LWW)",
  };

  if (isLoading) {
    return (
      <Card className="surface-card-solid">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Sync Conflicts</CardTitle></CardHeader>
        <CardContent>
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full mb-2" />)}
        </CardContent>
      </Card>
    );
  }

  if (!conflicts || conflicts.length === 0) {
    return (
      <Card className="surface-card-solid">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-500" />Sync Conflicts</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">No sync conflicts recorded</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="surface-card-solid">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          Sync Conflicts
          <Badge variant="secondary" className="ml-auto text-xs">
            {conflicts.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-80 overflow-y-auto">
        {conflicts.map((c: any) => {
          const localStatus = c.local_data?.status;
          const serverStatus = c.server_data?.status;
          return (
            <div key={c.id} className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 border border-border/50">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">
                    Lead {(c.lead_id as string).slice(0, 8)}…
                  </p>
                  <Badge className={`${resolutionColor[c.resolution] || "bg-muted"} text-white text-[10px] h-4`}>
                    {resolutionLabel[c.resolution] || c.resolution}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {c.conflict_type} · Agent: {(c.agent_id as string).slice(0, 8)}…
                </p>
                {localStatus && serverStatus && localStatus !== serverStatus && (
                  <p className="text-xs text-muted-foreground">
                    Local: <span className="font-medium">{localStatus}</span> → Server: <span className="font-medium">{serverStatus}</span>
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {format(new Date(c.created_at), "dd MMM HH:mm")}
                  {c.resolved_at && ` · Resolved ${format(new Date(c.resolved_at), "HH:mm")}`}
                </p>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

export default SyncConflictsSection;
