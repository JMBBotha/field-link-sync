import { forwardRef, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Navigation, Loader2, ImageIcon } from "lucide-react";
import LeadCardProgress from "@/components/LeadCardProgress";
import DepositPaymentChip, { type DepositInvoiceLike } from "@/components/shared/DepositPaymentChip";
import { useSingleLeadPhotoCount } from "@/hooks/useLeadPhotoCount";
import { cn } from "@/lib/utils";
import LeadCardV2 from "@/components/leads/LeadCardV2";

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
  scheduled_date?: string | null;
  scheduled_time?: string | null;
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
  /** Deposit invoice for install work on this lead — parent-side lookup. Chip renders only when an invoice row exists. */
  invoice?: DepositInvoiceLike | null;
  /** Linked quote/estimate URL for install jobs (parent-side lookup by lead id). */
  estimateUrl?: string | null;
}

const getPriorityColor = (priority: string | undefined): string | null => {
  if (priority === "urgent") return "bg-destructive";
  if (priority === "high") return "bg-warning";
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
      invoice,
      estimateUrl,
    },
    ref
  ) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const priorityColor = getPriorityColor(lead.priority);
    const { count: photoCount } = useSingleLeadPhotoCount(lead.id);

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
      <div
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
          "relative",
          isHighlighted && "ring-2 ring-primary ring-offset-2 rounded-xl",
          // Dimmed state
          isDimmed && "opacity-50 grayscale-[30%]"
        )}
        onClick={() => onCardClick(lead)}
      >
        {/* Priority indicator dot */}
        {priorityColor && (
          <div
            className={cn("absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-card z-10", priorityColor)}
          />
        )}

        {/* Highlight pulse animation */}
        {isHighlighted && (
          <div className="absolute inset-0 rounded-lg bg-primary/5 pointer-events-none" />
        )}

        <>
          {variant === "available" ? (
            <LeadCardV2 audience="tech" lead={lead} hideContact action={onAccept ? (
              <Button size="sm" className="h-8 rounded-full px-4 font-semibold" disabled={!!loadingAction}
                onClick={(e) => { e.stopPropagation(); onAccept(lead.id); }}>
                {loadingAction === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Accept Lead"}
              </Button>
            ) : <span />} extra={distance ? <span className="text-xs text-muted-foreground">{distance}km</span> : undefined} />
          ) : (
          <LeadCardV2 audience="tech" lead={lead} extra={<>
            {getStatusBadge(lead.status)}
            {invoice?.id && <DepositPaymentChip invoice={invoice} hideAmount accepted={["accepted", "in_progress", "completed"].includes(lead.status)} className="text-[10px]" />}
            {estimateUrl && <Link to={estimateUrl} onClick={(e) => e.stopPropagation()} className="text-[10px] font-medium text-primary hover:underline">Open job sheet</Link>}
            {photoCount > 0 && <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><ImageIcon className="h-3 w-3" />{photoCount}</span>}
            {distance && <span className="text-xs text-muted-foreground">{distance}km</span>}
            {lead.status === "in_progress" && lead.started_at && <LeadCardProgress startedAt={lead.started_at} estimatedDurationMinutes={lead.estimated_duration_minutes} estimatedEndTime={lead.estimated_end_time} compact />}
          </>} action={
          {/* Active lead - Action buttons */}
          {variant === "active" && (
            <div className="flex gap-1.5">
              {["claimed", "accepted"].includes(lead.status) && onStart && (
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs rounded-full font-semibold"
                 
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

          } />)}
        </>)}
        </>
      </div>
    );
  }
);

FieldAgentLeadCard.displayName = "FieldAgentLeadCard";

export default FieldAgentLeadCard;
export type { Lead as FieldAgentLead };
