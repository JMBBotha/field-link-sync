import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";
import {
  Phone,
  Mail,
  MessageSquare,
  StickyNote,
  MapPin,
  Plus,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface CommunicationEntry {
  id: string;
  type: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  agent_id: string;
}

interface CommunicationTimelineProps {
  leadId?: string;
  customerId?: string;
}

const typeConfig: Record<
  string,
  { icon: typeof Phone; label: string; color: string }
> = {
  call: { icon: Phone, label: "Call", color: "bg-blue-500" },
  email: { icon: Mail, label: "Email", color: "bg-purple-500" },
  whatsapp: { icon: MessageSquare, label: "WhatsApp", color: "bg-green-500" },
  note: { icon: StickyNote, label: "Note", color: "bg-yellow-500" },
  site_visit: { icon: MapPin, label: "Site Visit", color: "bg-orange-500" },
};

const CommunicationTimeline = ({
  leadId,
  customerId,
}: CommunicationTimelineProps) => {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addType, setAddType] = useState<string>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["communication-log", leadId, customerId],
    queryFn: async () => {
      let query = supabase
        .from("communication_log")
        .select("*")
        .order("created_at", { ascending: false });

      if (leadId) query = query.eq("lead_id", leadId);
      if (customerId) query = query.eq("customer_id", customerId);

      const { data, error } = await query;
      if (error) throw error;
      return data as CommunicationEntry[];
    },
    enabled: !!(leadId || customerId),
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase.from("communication_log").insert({
        lead_id: leadId || null,
        customer_id: customerId || null,
        type: addType,
        subject: subject || null,
        body: body || null,
        agent_id: user.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["communication-log", leadId, customerId],
      });
      toast({ title: "Entry added" });
      setShowAddDialog(false);
      setSubject("");
      setBody("");
    },
    onError: (err: Error) => {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const openAdd = (type: string) => {
    setAddType(type);
    setShowAddDialog(true);
  };

  return (
    <div className="space-y-3">
      {/* Quick-add buttons */}
      <div className="flex gap-1.5 flex-wrap">
        {Object.entries(typeConfig).map(([key, config]) => {
          const Icon = config.icon;
          return (
            <Button
              key={key}
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => openAdd(key)}
            >
              <Icon className="h-3 w-3" />
              {config.label}
            </Button>
          );
        })}
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No communication logged yet
        </p>
      ) : (
        <div className="relative space-y-0">
          {/* Vertical line */}
          <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-border" />

          {entries.map((entry) => {
            const config = typeConfig[entry.type] || typeConfig.note;
            const Icon = config.icon;
            return (
              <div key={entry.id} className="relative flex gap-3 pb-4">
                <div
                  className={`h-8 w-8 rounded-full ${config.color} flex items-center justify-center shrink-0 z-10`}
                >
                  <Icon className="h-3.5 w-3.5 text-white" />
                </div>
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] h-5">
                      {config.label}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(entry.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {entry.subject && (
                    <p className="text-sm font-medium mt-0.5">{entry.subject}</p>
                  )}
                  {entry.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-3">
                      {entry.body}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Log {typeConfig[addType]?.label || "Entry"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Input
                placeholder="Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <Textarea
                placeholder="Details..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowAddDialog(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={() => addMutation.mutate()}
                disabled={addMutation.isPending}
              >
                {addMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CommunicationTimeline;
