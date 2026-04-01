import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Clock,
  UserPlus,
  Play,
  CheckCircle,
  XCircle,
  MessageSquare,
  PlusCircle,
  ArrowRightLeft,
  Send,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface ActivityEntry {
  id: string;
  job_id: string;
  user_id: string | null;
  action: string;
  details: Record<string, any> | null;
  created_at: string;
  profiles?: { full_name: string | null } | null;
}

const ACTION_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  created: { icon: PlusCircle, label: "Job Created", color: "text-primary" },
  status_changed: { icon: ArrowRightLeft, label: "Status Changed", color: "text-amber-600 dark:text-amber-400" },
  assigned: { icon: UserPlus, label: "Agent Assigned", color: "text-blue-600 dark:text-blue-400" },
  assignment_status_changed: { icon: Play, label: "Assignment Updated", color: "text-green-600 dark:text-green-400" },
  note_added: { icon: MessageSquare, label: "Note Added", color: "text-muted-foreground" },
};

function getActionIcon(action: string) {
  const config = ACTION_CONFIG[action] || ACTION_CONFIG.note_added;
  const Icon = config.icon;
  return <Icon className={`h-4 w-4 ${config.color}`} />;
}

function formatDetails(action: string, details: Record<string, any> | null): string {
  if (!details) return "";
  switch (action) {
    case "created":
      return `Created with status "${details.status}" and priority "${details.priority}"`;
    case "status_changed":
      return `Status changed from "${details.old_status}" to "${details.new_status}"`;
    case "assigned":
      return `${details.agent_name} assigned as ${details.assignment_type || "technician"}`;
    case "assignment_status_changed":
      return `${details.agent_name}: ${details.old_status} → ${details.new_status}`;
    case "note_added":
      return details.note || "";
    default:
      return JSON.stringify(details);
  }
}

interface Props {
  jobId: string;
}

const JobActivityTimeline = ({ jobId }: Props) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [noteText, setNoteText] = useState("");

  const { data: entries = [], isLoading } = useQuery<ActivityEntry[]>({
    queryKey: ["job-activity", jobId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_activity_log")
        .select("*, profiles(full_name)")
        .eq("job_id", jobId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!jobId,
  });

  const addNoteMutation = useMutation({
    mutationFn: async (note: string) => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) throw new Error("Not authenticated");
      const { error } = await supabase.from("job_activity_log").insert({
        job_id: jobId,
        user_id: session.session.user.id,
        action: "note_added",
        details: { note },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNoteText("");
      toast({ title: "Note added" });
      queryClient.invalidateQueries({ queryKey: ["job-activity", jobId] });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to add note", description: err.message, variant: "destructive" }),
  });

  const handleSubmitNote = () => {
    const trimmed = noteText.trim();
    if (!trimmed) return;
    addNoteMutation.mutate(trimmed);
  };

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-sm flex items-center gap-1.5">
        <Clock className="h-4 w-4 text-muted-foreground" /> Activity Timeline
      </h4>

      <ScrollArea className="max-h-60">
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No activity yet</p>
        ) : (
          <div className="relative pl-5 space-y-0">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

            {entries.map((entry) => {
              const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.note_added;
              return (
                <div key={entry.id} className="relative pb-4 last:pb-0">
                  {/* Dot */}
                  <div className="absolute -left-5 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                    <div className={`h-1.5 w-1.5 rounded-full ${
                      entry.action === "created" ? "bg-primary" :
                      entry.action === "note_added" ? "bg-muted-foreground" :
                      "bg-accent-foreground"
                    }`} />
                  </div>

                  <div className="flex items-start gap-2">
                    {getActionIcon(entry.action)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium text-foreground">
                          {entry.profiles?.full_name || "System"}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {formatDetails(entry.action, entry.details as Record<string, any>)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <Separator />

      {/* Add note input */}
      <div className="flex gap-2">
        <Textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Add a note…"
          className="min-h-[36px] h-9 text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmitNote();
            }
          }}
        />
        <Button
          size="sm"
          className="h-9 gap-1"
          disabled={!noteText.trim() || addNoteMutation.isPending}
          onClick={handleSubmitNote}
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default JobActivityTimeline;