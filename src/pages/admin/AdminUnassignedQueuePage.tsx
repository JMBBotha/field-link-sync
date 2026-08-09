import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, MapPin, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface QueueRow {
  id: string;
  lead_id: string;
  reason: string;
  priority: string;
  escalate_at: string;
  escalated: boolean;
  created_at: string;
  leads?: {
    customer_name: string | null;
    customer_phone: string | null;
    customer_address: string | null;
    service_type: string | null;
  } | null;
}

const priorityTone: Record<string, string> = {
  emergency: "bg-destructive/15 text-destructive border-destructive/30",
  same_day: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  standard: "bg-muted text-muted-foreground border-border",
};

function dueLabel(iso: string) {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "Escalation overdue";
  const mins = Math.round(diff / 60000);
  return mins < 60 ? `Escalates in ${mins} min` : `Escalates in ${Math.round(mins / 60)} h`;
}

export default function AdminUnassignedQueuePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["unassigned-queue"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unassigned_queue")
        .select(
          "id, lead_id, reason, priority, escalate_at, escalated, created_at, leads(customer_name, customer_phone, customer_address, service_type)",
        )
        .eq("resolved", false)
        .order("escalate_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as QueueRow[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("unassigned-queue-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "unassigned_queue" },
        () => qc.invalidateQueries({ queryKey: ["unassigned-queue"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const resolve = async (id: string) => {
    const { error } = await supabase
      .from("unassigned_queue")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Removed from queue");
      qc.invalidateQueries({ queryKey: ["unassigned-queue"] });
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Unassigned Queue
        </h1>
        <p className="text-sm text-muted-foreground">
          Leads that could not be auto-dispatched and need manual assignment.
        </p>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Loading queue…</p>}
      {!isLoading && data.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nothing waiting — every lead has been dispatched.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {data.map((row) => (
          <Card key={row.id} className="bg-card">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-base text-foreground">
                  {row.leads?.customer_name ?? "Unknown customer"}
                </CardTitle>
                <Badge variant="outline" className={priorityTone[row.priority] ?? priorityTone.standard}>
                  {row.priority.replace("_", " ")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">{row.leads?.service_type ?? "Service request"}</p>
              {row.leads?.customer_address && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  {row.leads.customer_address}
                </p>
              )}
              <p className="text-foreground">{row.reason}</p>
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {row.escalated ? "Escalated to ops" : dueLabel(row.escalate_at)}
              </p>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={() => navigate(`/admin/map?lead=${row.lead_id}`)}>
                  Open lead
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolve(row.id)}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Resolve
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
