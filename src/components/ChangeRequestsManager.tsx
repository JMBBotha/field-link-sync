import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Clock,
  Calendar,
  Timer,
  CheckCircle2,
  Check,
  X,
  Loader2,
  RefreshCw,
  User,
  MessageSquare,
} from "lucide-react";

interface ChangeRequest {
  id: string;
  lead_id: string;
  requested_by: string;
  request_type: string;
  current_value: string | null;
  requested_value: string;
  reason: string | null;
  status: string;
  review_notes: string | null;
  created_at: string;
  // Joined data
  lead?: {
    customer_name: string;
    service_type: string;
  };
  requester?: {
    full_name: string;
  };
}

const REQUEST_TYPE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  adjust_start_time: { icon: <Clock className="h-4 w-4" />, label: "Start Time" },
  adjust_scheduled_date: { icon: <Calendar className="h-4 w-4" />, label: "Scheduled Date" },
  adjust_completed_time: { icon: <CheckCircle2 className="h-4 w-4" />, label: "Completion Time" },
  adjust_duration: { icon: <Timer className="h-4 w-4" />, label: "Duration" },
  adjust_job_times: { icon: <Clock className="h-4 w-4" />, label: "Job Times" },
};

interface ChangeRequestsManagerProps {
  leadId?: string; // Optional - filter by lead
  showAll?: boolean; // Show all requests or just pending
}

const ChangeRequestsManager = ({ leadId, showAll = false }: ChangeRequestsManagerProps) => {
  const { toast } = useToast();
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const fetchRequests = useCallback(async () => {
    try {
      let query = supabase
        .from("lead_change_requests")
        .select(`
          *,
          lead:leads(customer_name, service_type)
        `)
        .order("created_at", { ascending: false });

      if (leadId) {
        query = query.eq("lead_id", leadId);
      }

      if (!showAll) {
        query = query.eq("status", "pending");
      }

      const { data, error } = await query.limit(50);

      if (error) throw error;

      // Fetch requester profiles separately
      const requestorIds = [...new Set((data || []).map(r => r.requested_by))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", requestorIds);

      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);

      // Type assertion for joined data
      const mapped = (data || []).map((r) => ({
        ...r,
        lead: r.lead as { customer_name: string; service_type: string } | undefined,
        requester: profileMap.get(r.requested_by) as { full_name: string } | undefined,
      }));

      setRequests(mapped);
    } catch (error) {
      console.error("Error fetching change requests:", error);
    } finally {
      setLoading(false);
    }
  }, [leadId, showAll]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleApprove = async (request: ChangeRequest) => {
    setProcessing(request.id);
    try {
      // First, apply the change to the lead
      const updates = getLeadUpdates(request);

      if (Object.keys(updates).length > 0) {
        const { error: leadError } = await supabase
          .from("leads")
          .update(updates)
          .eq("id", request.lead_id);

        if (leadError) throw leadError;
      }

      // Then update the request status
      const { error } = await supabase
        .from("lead_change_requests")
        .update({
          status: "approved",
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes[request.id] || null,
        })
        .eq("id", request.id);

      if (error) throw error;

      toast({
        title: "Approved ✓",
        description: "Change has been applied to the lead",
      });

      fetchRequests();
    } catch (error: unknown) {
      console.error("Error approving request:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to approve",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const handleReject = async (request: ChangeRequest) => {
    setProcessing(request.id);
    try {
      const { error } = await supabase
        .from("lead_change_requests")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
          review_notes: reviewNotes[request.id] || null,
        })
        .eq("id", request.id);

      if (error) throw error;

      toast({
        title: "Rejected",
        description: "Change request has been rejected",
      });

      fetchRequests();
    } catch (error: unknown) {
      console.error("Error rejecting request:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reject",
        variant: "destructive",
      });
    } finally {
      setProcessing(null);
    }
  };

  const getLeadUpdates = (request: ChangeRequest): Record<string, unknown> => {
    const updates: Record<string, unknown> = {};
    const value = request.requested_value;

    switch (request.request_type) {
      case "adjust_start_time":
        // Value is ISO string
        updates.actual_start_time = value;
        updates.started_at = value;
        break;
      case "adjust_scheduled_date":
        // Value is yyyy-MM-dd
        updates.scheduled_date = value;
        break;
      case "adjust_completed_time":
        // Value is ISO string
        updates.completed_at = value;
        break;
      case "adjust_duration":
        // Value is "X minutes"
        const mins = parseInt(value.replace(" minutes", ""), 10);
        if (!isNaN(mins)) {
          updates.estimated_duration_minutes = mins;
        }
        break;
      case "adjust_job_times":
        // Parse ISO times from the reason field (after ---)
        try {
          const reasonParts = request.reason?.split("\n---\n");
          if (reasonParts && reasonParts.length > 1) {
            const timeData = JSON.parse(reasonParts[reasonParts.length - 1]);
            if (timeData.startTime) {
              updates.actual_start_time = timeData.startTime;
              updates.started_at = timeData.startTime;
            }
            if (timeData.endTime) {
              updates.completed_at = timeData.endTime;
            }
            // Calculate duration
            if (timeData.startTime && timeData.endTime) {
              const start = new Date(timeData.startTime);
              const end = new Date(timeData.endTime);
              updates.estimated_duration_minutes = Math.round((end.getTime() - start.getTime()) / 60000);
            }
          }
        } catch (e) {
          console.error("Error parsing job times:", e);
        }
        break;
    }

    return updates;
  };

  // Helper to get display reason (without the JSON data)
  const getDisplayReason = (request: ChangeRequest): string | null => {
    if (!request.reason) return null;
    if (request.request_type === "adjust_job_times") {
      const parts = request.reason.split("\n---\n");
      return parts[0] || null;
    }
    return request.reason;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge className="bg-yellow-500">Pending</Badge>;
      case "approved":
        return <Badge className="bg-green-500">Approved</Badge>;
      case "rejected":
        return <Badge className="bg-red-500">Rejected</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No change requests {showAll ? "" : "pending"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          Change Requests
          {!showAll && requests.length > 0 && (
            <Badge variant="secondary">{requests.length}</Badge>
          )}
        </h3>
        <Button size="sm" variant="outline" onClick={fetchRequests}>
          <RefreshCw className="h-3 w-3 mr-1" />
          Refresh
        </Button>
      </div>

      <div className="space-y-3">
        {requests.map((request) => {
          const typeConfig = REQUEST_TYPE_CONFIG[request.request_type] || {
            icon: <Clock className="h-4 w-4" />,
            label: request.request_type,
          };

          return (
            <Card key={request.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                      {typeConfig.icon}
                    </div>
                    <div>
                      <CardTitle className="text-sm">{typeConfig.label}</CardTitle>
                      {request.lead && (
                        <CardDescription className="text-xs">
                          {request.lead.customer_name} • {request.lead.service_type}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                  {getStatusBadge(request.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Requester info */}
                {request.requester && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <User className="h-3 w-3" />
                    <span>{request.requester.full_name}</span>
                    <span>•</span>
                    <span>{format(new Date(request.created_at), "MMM d, h:mm a")}</span>
                  </div>
                )}

                {/* Current vs Requested */}
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="p-2 rounded bg-muted/50">
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="font-medium">{request.current_value || "Not set"}</p>
                  </div>
                  <div className="p-2 rounded bg-primary/10">
                    <p className="text-xs text-muted-foreground">Requested</p>
                    <p className="font-medium text-primary">{request.requested_value}</p>
                  </div>
                </div>

                {/* Reason */}
                {getDisplayReason(request) && (
                  <div className="text-sm">
                    <p className="text-xs text-muted-foreground">Reason</p>
                    <p>{getDisplayReason(request)}</p>
                  </div>
                )}

                {/* Action buttons for pending requests */}
                {request.status === "pending" && (
                  <div className="space-y-2 pt-2 border-t">
                    <Textarea
                      placeholder="Add review notes (optional)"
                      value={reviewNotes[request.id] || ""}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({
                          ...prev,
                          [request.id]: e.target.value,
                        }))
                      }
                      rows={2}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => handleApprove(request)}
                        disabled={processing === request.id}
                      >
                        {processing === request.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-3 w-3 mr-1" />
                            Approve
                          </>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => handleReject(request)}
                        disabled={processing === request.id}
                      >
                        <X className="h-3 w-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  </div>
                )}

                {/* Review notes for processed requests */}
                {request.status !== "pending" && request.review_notes && (
                  <div className="text-sm pt-2 border-t">
                    <p className="text-xs text-muted-foreground">Review Notes</p>
                    <p>{request.review_notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ChangeRequestsManager;
