import { forwardRef, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Navigation, AlertCircle, Loader2 } from "lucide-react";
import LeadCardProgress from "@/components/LeadCardProgress";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  created_at?: string | null;
  assigned_agent_id?: string | null;
  started_at?: string | null;
  priority?: string;
  customer_id?: string | null;
  equipment_id?: string | null;
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
}

interface FieldAgentLeadCardProps {
  lead: Lead;
  distance?: string | null;
  isHighlighted?: boolean;
  isDimmed?: boolean;
  variant: "available" | "active";
  onCardClick: (lead: Lead) => void;
  onAccept?: (leadId: string) => void;
  onStart?: (lead: Lead) => void;
  onComplete?: (leadId: string) => void;
  onRelease?: (leadId: string) => void;
  loadingAction?: string | null;
  scrollIntoView?: boolean;
}

const formatTimeAgo = (createdAt: string): string => {
  const now = new Date();
  const created = new Date(createdAt);
  const diffMs = now.getTime() - created.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
};

const getPriorityColor = (priority: string | undefined): string | null => {
  if (priority === "urgent") return "#ef4444";
  if (priority === "high") return "#f97316";
  return null;
};

const getStatusBadge = (status: string) => {
  const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
    pending: { bg: "bg-red-500", text: "text-white", label: "Available" },
    open: { bg: "bg-red-500", text: "text-white", label: "Open" },
    released: { bg: "bg-orange-500", text: "text-white", label: "Released" },
    claimed: { bg: "bg-yellow-500", text: "text-black", label: "Claimed" },
    accepted: { bg: "bg-yellow-500", text: "text-black", label: "Accepted" },
    in_progress: { bg: "bg-green-500", text: "text-white", label: "In Progress" },
    completed: { bg: "bg-black", text: "text-white", label: "Completed" },
  };

  const config = statusConfig[status] || { bg: "bg-gray-500", text: "text-white", label: status };

  return (
    <Badge className={`${config.bg} ${config.text} text-xs`}>
      {config.label}
    </Badge>
  );
};

const FieldAgentLeadCard = forwardRef<HTMLDivElement, FieldAgentLeadCardProps>(
  (
    {
      lead,
      distance,
      isHighlighted = false,
      isDimmed = false,
      variant,
      onCardClick,
      onAccept,
      onStart,
      onComplete,
      onRelease,
      loadingAction,
      scrollIntoView = false,
    },
    ref
  ) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const priorityColor = getPriorityColor(lead.priority);

    // Auto-scroll into view when highlighted
    useEffect(() => {
      if (scrollIntoView && isHighlighted && cardRef.current) {
        cardRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }, [isHighlighted, scrollIntoView]);

    const handleNavigate = (e: React.MouseEvent) => {
      e.stopPropagation();
      window.open(
        `https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`,
        "_blank",
        "noopener,noreferrer"
      );
    };

    return (
      <Card
        ref={(el) => {
          // Handle both forwardRef and internal ref
          (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          if (typeof ref === "function") {
            ref(el);
          } else if (ref) {
            ref.current = el;
          }
        }}
        data-lead-id={lead.id}
        className={cn(
          "cursor-pointer transition-all duration-300 relative shadow-md border-border/50",
          // Default gradient
          "bg-gradient-to-r from-blue-100 to-slate-50",
          // Hover state
          "hover:from-blue-50 hover:to-white",
          // Highlighted state - ring animation
          isHighlighted && [
            "ring-2 ring-primary ring-offset-2",
            "from-blue-200 to-blue-50",
            "shadow-lg shadow-primary/20",
            "scale-[1.02]",
          ],
          // Dimmed state
          isDimmed && "opacity-50 grayscale-[30%]"
        )}
        onClick={() => onCardClick(lead)}
      >
        {/* Priority indicator dot */}
        {priorityColor && (
          <div
            className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-card z-10"
            style={{ backgroundColor: priorityColor }}
          />
        )}

        {/* Highlight pulse animation */}
        {isHighlighted && (
          <div className="absolute inset-0 rounded-lg bg-primary/10 animate-pulse pointer-events-none" />
        )}

        <CardContent className="p-3 space-y-2">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="font-medium text-sm truncate">{lead.customer_name}</p>
                {lead.priority === "urgent" && (
                  <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">{lead.service_type}</p>
            </div>
            <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
              {getStatusBadge(lead.status)}
              {distance && (
                <span className="text-xs text-muted-foreground">{distance}km</span>
              )}
            </div>
          </div>

          {lead.created_at && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3 flex-shrink-0" />
              {formatTimeAgo(lead.created_at)}
            </p>
          )}

          {/* Available lead - Accept button */}
          {variant === "available" && onAccept && (
            <Button
              size="sm"
              className="w-full h-9 rounded-full font-semibold"
              style={{ backgroundColor: "#0077B6", color: "#FFFFFF" }}
              onClick={(e) => {
                e.stopPropagation();
                onAccept(lead.id);
              }}
              disabled={!!loadingAction}
            >
              {loadingAction === "accept" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Accept Lead"
              )}
            </Button>
          )}

          {/* Active lead - Action buttons */}
          {variant === "active" && (
            <div className="flex gap-1.5">
              {["claimed", "accepted"].includes(lead.status) && onStart && (
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs rounded-full font-semibold"
                  style={{ backgroundColor: "#0077B6", color: "#FFFFFF" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStart(lead);
                  }}
                >
                  Start Job
                </Button>
              )}
              {lead.status === "in_progress" && onComplete && (
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs rounded-full font-semibold bg-green-600 hover:bg-green-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    onComplete(lead.id);
                  }}
                  disabled={!!loadingAction}
                >
                  {loadingAction === "complete" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Complete"
                  )}
                </Button>
              )}
              {onRelease && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 rounded-full"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRelease(lead.id);
                  }}
                  disabled={!!loadingAction}
                >
                  Release
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2"
                onClick={handleNavigate}
              >
                <Navigation className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Job Progress Bar for in_progress leads */}
          {lead.status === "in_progress" && lead.started_at && (
            <LeadCardProgress
              startedAt={lead.started_at}
              estimatedDurationMinutes={lead.estimated_duration_minutes}
              estimatedEndTime={lead.estimated_end_time}
              compact
            />
          )}
        </CardContent>
      </Card>
    );
  }
);

FieldAgentLeadCard.displayName = "FieldAgentLeadCard";

export default FieldAgentLeadCard;
export type { Lead as FieldAgentLead };
