import { useEffect, useState, useRef, useCallback } from "react";
import { hasValidCoords } from "@/lib/leadCoords";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, MapPin, Clock, Trash2, MoreHorizontal, Navigation, ChevronDown, ChevronUp, RefreshCw, ArrowUp, Pencil, Timer, ImageIcon, CalendarDays, FileText, Users } from "lucide-react";
import BookingBadge from "./BookingBadge";
import ClientInfoPopover from "./ClientInfoPopover";
import LeadCardProgress from "./LeadCardProgress";
import CustomerJobHistory from "./CustomerJobHistory";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile, useIsTabletOrBelow } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useLeadPhotoCount } from "@/hooks/useLeadPhotoCount";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import EditLeadDialog from "./EditLeadDialog";
import LeadTimeEditDialog from "./LeadTimeEditDialog";
import JobPipelinePanel from "./leads/JobPipelinePanel";

interface Lead {
  id: string;
  customer_name: string;
  customer_id?: string | null;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  created_at: string;
  latitude: number;
  longitude: number;
  notes?: string | null;
  priority?: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  profiles?: { full_name: string };
  started_at?: string | null;
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  order_status?: string | null;
  parts_status?: string | null;
  technician_name?: string | null;
  technician_eta?: string | null;
}

interface LeadsListProps {
  onLeadClick?: (lat: number, lng: number, leadId: string) => void;
  onPanelClose?: () => void;
  /** Optional content rendered above the "Recent Leads" heading (e.g. business search). */
  headerSlot?: React.ReactNode;
}

const LeadsList = ({ onLeadClick, onPanelClose, headerSlot }: LeadsListProps) => {
  const navigate = useNavigate();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<string | null>(null);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editingTimesLead, setEditingTimesLead] = useState<Lead | null>(null);
  const [clickedCardId, setClickedCardId] = useState<string | null>(null);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const isTabletOrBelow = useIsTabletOrBelow();
  // Compact mode: mobile OR tablet — reduces card height & lets the map show through.
  const useCompact = isMobile || isTabletOrBelow;
  
  // Get photo counts for all leads
  const leadIds = leads.map(l => l.id);
  const { photoCounts } = useLeadPhotoCount(leadIds);
  
  // Pull-to-refresh refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const PULL_THRESHOLD = 80;

  useEffect(() => {
    fetchLeads();
    const cleanup = subscribeToLeads();
    return cleanup;
  }, []);

  const fetchLeads = async (showToast = false) => {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false });

    if (data) {
      const leadsWithProfiles = await Promise.all(
        data.map(async (lead) => {
          if (lead.assigned_agent_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", lead.assigned_agent_id)
              .maybeSingle();
            return { ...lead, profiles: profile };
          }
          return lead;
        })
      );
      setLeads(leadsWithProfiles as any);
      if (showToast) {
        toast({
          title: "Refreshed",
          description: "Leads list updated",
        });
      }
    }
  };

  // Pull-to-refresh handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return;
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    if (scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [isMobile]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || !isMobile || isRefreshing) return;
    
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    if (scrollTop > 0) {
      isPulling.current = false;
      setPullDistance(0);
      return;
    }

    const currentY = e.touches[0].clientY;
    const distance = Math.max(0, currentY - touchStartY.current);
    // Apply resistance to pull
    const resistedDistance = Math.min(distance * 0.5, PULL_THRESHOLD * 1.5);
    setPullDistance(resistedDistance);
  }, [isMobile, isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || !isMobile) return;
    
    isPulling.current = false;
    
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      await fetchLeads(true);
      setIsRefreshing(false);
    }
    
    setPullDistance(0);
  }, [isMobile, pullDistance, isRefreshing]);

  // Scroll position tracking for scroll-to-top button
  const handleScroll = useCallback(() => {
    const scrollTop = scrollContainerRef.current?.scrollTop || 0;
    setShowScrollTop(scrollTop > 150);
  }, []);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }, []);

  const subscribeToLeads = () => {
    const channel = supabase
      .channel("leads-list")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        () => fetchLeads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

  const handleStatusChange = async (leadId: string, newStatus: string) => {
    const updates: Record<string, any> = { status: newStatus };
    
    if (newStatus === "completed") {
      updates.completed_at = new Date().toISOString();
    }
    if (newStatus === "pending") {
      updates.assigned_agent_id = null;
      updates.accepted_at = null;
    }

    const { error } = await supabase
      .from("leads")
      .update(updates)
      .eq("id", leadId);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to update lead status",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Status Updated",
      description: `Lead marked as ${newStatus.replace("_", " ")}`,
    });
  };

  const handleDeleteLead = async () => {
    if (!leadToDelete) return;

    const { error } = await supabase
      .from("leads")
      .delete()
      .eq("id", leadToDelete);

    if (error) {
      toast({
        title: "Error",
        description: "Failed to delete lead",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Lead Deleted",
        description: "The lead has been removed",
      });
    }

    setLeadToDelete(null);
    setDeleteDialogOpen(false);
  };

  const confirmDelete = (leadId: string) => {
    setLeadToDelete(leadId);
    setDeleteDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "bg-warning",
      accepted: "bg-onsite",
      in_progress: "bg-enroute",
      completed: "bg-available",
      cancelled: "bg-destructive",
    };

    return (
      <Badge className={colors[status] || "bg-muted"}>
        {status.replace("_", " ")}
      </Badge>
    );
  };

  const statusOptions = ["pending", "accepted", "in_progress", "completed", "cancelled"];

  const openNavigation = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank', 'noopener,noreferrer');
  };

  const handleLocateOnMap = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[LeadsList] handleLocateOnMap called:', { 
      leadId: lead.id, 
      lat: lead.latitude, 
      lng: lead.longitude,
      hasOnLeadClick: !!onLeadClick 
    });
    triggerCardClick(lead);
    onPanelClose?.();
  };

  const triggerCardClick = (lead: Lead) => {
    setClickedCardId(lead.id);
    onLeadClick?.(lead.latitude, lead.longitude, lead.id);
    // Remove highlight after animation completes
    setTimeout(() => setClickedCardId(null), 600);
  };

  const toggleCardExpansion = (leadId: string) => {
    setExpandedCards(prev => {
      const newSet = new Set(prev);
      if (newSet.has(leadId)) {
        newSet.delete(leadId);
      } else {
        newSet.add(leadId);
      }
      return newSet;
    });
  };

  const isCardExpanded = (leadId: string) => {
    // On desktop, always expanded. On tablet/mobile, check state (default collapsed)
    return !useCompact || expandedCards.has(leadId);
  };

  // Render compact card header for mobile (2-line layout)
  const renderCompactHeader = (lead: Lead) => (
    <div className="flex flex-col w-full py-2.5 px-3 gap-1 min-w-0">
      {/* Booking banner */}
      <BookingBadge scheduledDate={lead.scheduled_date} scheduledTime={lead.scheduled_time} status={lead.status} className="self-start" />
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Line 1: Customer name + Status badge */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-medium text-sm truncate min-w-0 flex-1 text-foreground">{lead.customer_name}</span>
          {photoCounts[lead.id] > 0 && (
            <span className="flex items-center gap-0.5 text-xs text-muted-foreground flex-shrink-0">
              <ImageIcon className="h-3 w-3" />
              {photoCounts[lead.id]}
            </span>
          )}
          <div className="flex-shrink-0">{getStatusBadge(lead.status)}</div>
        </div>
          {/* Line 2: Service type (truncated) + Scheduled date or Time */}
          <div className="flex items-center gap-2 mt-1 min-w-0">
            <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">{lead.service_type}</span>
            {!lead.scheduled_date && (
              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                <Clock className="h-3 w-3 flex-shrink-0" />
                <span className="truncate max-w-[80px]">{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
              </span>
            )}
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${expandedCards.has(lead.id) ? 'rotate-180' : ''}`} />
      </div>
    </div>
  );

  // Render full card content (expanded view)
  const renderFullContent = (lead: Lead) => (
    <CardContent className="space-y-2 text-sm pt-0 pb-3 px-3 overflow-hidden">
      <button
        onClick={(e) => openNavigation(lead.customer_address, e)}
        className="flex items-start gap-2 w-full text-left hover:bg-accent/50 p-1 -m-1 rounded transition-colors group min-w-0"
      >
        <MapPin className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <span className="text-xs text-primary underline group-hover:no-underline flex-1 min-w-0 break-words">{lead.customer_address}</span>
        <Navigation className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
      </button>
      {!hasValidCoords(lead.latitude, lead.longitude) && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <MapPin className="h-3 w-3" />
          Location not confirmed
        </div>
      )}

      <div className="flex items-center gap-2 min-w-0">
        <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <a href={`tel:${lead.customer_phone}`} className="text-xs text-primary hover:underline truncate min-w-0" onClick={(e) => e.stopPropagation()}>{lead.customer_phone}</a>
      </div>
      {/* Service type + Priority */}
      <div className="flex items-center flex-wrap gap-1.5 min-w-0">
        <Badge variant="secondary" className="text-[10px] font-medium">
          {lead.service_type}
        </Badge>
        {lead.priority && lead.priority !== 'normal' && (
          <Badge
            variant="outline"
            className={`text-[10px] font-medium ${
              lead.priority === 'urgent' || lead.priority === 'high'
                ? 'border-destructive text-destructive'
                : lead.priority === 'low'
                ? 'border-muted-foreground text-muted-foreground'
                : ''
            }`}
          >
            {lead.priority} priority
          </Badge>
        )}
      </div>
      {/* Issue description / notes preview */}
      {lead.notes && (
        <div className="p-2 rounded-md bg-muted/40 border border-border/40">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">Issue description</p>
          <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3">{lead.notes}</p>
        </div>
      )}
      {lead.profiles && (
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-xs truncate max-w-full">
            {lead.profiles.full_name}
          </Badge>
        </div>
      )}
      <div className="flex items-center pt-1 gap-2 min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-1">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">{formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
        </div>
        {lead.scheduled_date && (
          <div className="flex items-center gap-1 text-xs text-primary font-medium flex-shrink-0">
            <CalendarDays className="h-3 w-3" />
            <span>{format(new Date(lead.scheduled_date), "d MMM yyyy")}{lead.scheduled_time ? ` @ ${lead.scheduled_time.slice(0, 5)}` : ''}</span>
          </div>
        )}
      </div>
      {/* Job Progress Bar for in_progress leads */}
      {lead.status === "in_progress" && lead.started_at && (
        <LeadCardProgress
          startedAt={lead.started_at}
          estimatedDurationMinutes={lead.estimated_duration_minutes}
          estimatedEndTime={lead.estimated_end_time}
        />
      )}
      {/* Job pipeline tracking (order/parts/technician) */}
      <JobPipelinePanel
        leadId={lead.id}
        initial={{
          order_status: lead.order_status,
          parts_status: lead.parts_status,
          technician_name: lead.technician_name,
          technician_eta: lead.technician_eta,
        }}
      />
      {/* Expandable Job History */}
      <div onClick={(e) => e.stopPropagation()}>
        <CustomerJobHistory
          customerId={lead.customer_id}
          customerPhone={lead.customer_phone}
          currentLeadId={lead.id}
        />
      </div>
    </CardContent>
  );

  // Desktop full card view
  const renderDesktopCard = (lead: Lead) => (
    <Card 
      key={lead.id} 
      className={`glass-card transition-all duration-200 shadow-md cursor-pointer hover:scale-[1.02] hover:shadow-lg ${
clickedCardId === lead.id ? 'ring-2 ring-primary ring-offset-2' : ''
      }`}
      onClick={() => {
        console.log('[LeadsList] Desktop card clicked:', { leadId: lead.id, lat: lead.latitude, lng: lead.longitude });
        triggerCardClick(lead);
      }}
    >
      {/* Booking banner */}
      {lead.scheduled_date && (
        <div className="px-4 pt-3 pb-0">
          <BookingBadge scheduledDate={lead.scheduled_date} scheduledTime={lead.scheduled_time} status={lead.status} />
        </div>
      )}
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
             <CardTitle className="text-base text-foreground">
               <ClientInfoPopover customerId={lead.customer_id || null}>
                 <span className="cursor-pointer hover:underline">{lead.customer_name}</span>
               </ClientInfoPopover>
             </CardTitle>
            <CardDescription className="text-xs flex items-center gap-2">
              <span>{lead.service_type}</span>
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {photoCounts[lead.id] > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <ImageIcon className="h-3 w-3" />
                {photoCounts[lead.id]}
              </span>
            )}
            {getStatusBadge(lead.status)}
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/admin/quotes?fromLead=${lead.id}`);
              }}
              title="Start a draft quote pre-filled with this lead's details"
            >
              <FileText className="h-3 w-3" /> Draft Quote
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditingLead(lead)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Lead
                </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => setEditingTimesLead(lead)}>
                   <Timer className="h-4 w-4 mr-2" />
                   Edit Times
                 </DropdownMenuItem>
                 <DropdownMenuItem onClick={() => navigate(`/admin/quotes?leadId=${lead.id}`)}>
                   <FileText className="h-4 w-4 mr-2" />
                   Create Quote
                 </DropdownMenuItem>
                 {lead.customer_id ? (
                   <DropdownMenuItem onClick={() => navigate(`/admin/customers/${lead.customer_id}`)}>
                     <Users className="h-4 w-4 mr-2" />
                     View Customer
                   </DropdownMenuItem>
                 ) : (
                   <DropdownMenuItem
                     onClick={async () => {
                       const { data, error } = await supabase.rpc("convert_lead_to_customer", { p_lead_id: lead.id });
                       if (error) {
                         toast({ title: "Conversion failed", description: error.message, variant: "destructive" });
                       } else {
                         toast({ title: "Lead converted to Customer", description: "Opening customer page…" });
                         if (data) navigate(`/admin/customers/${data}`);
                       }
                     }}
                   >
                     <Users className="h-4 w-4 mr-2" />
                     Convert to Customer
                   </DropdownMenuItem>
                 )}
                <DropdownMenuSeparator />
                {statusOptions.map((status) => (
                  <DropdownMenuItem
                    key={status}
                    onClick={() => handleStatusChange(lead.id, status)}
                    disabled={lead.status === status}
                  >
                    Mark as {status.replace("_", " ")}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => confirmDelete(lead.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Lead
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </CardHeader>
      {renderFullContent(lead)}
    </Card>
  );

  // Mobile collapsible card view
  const renderMobileCard = (lead: Lead) => (
    <Collapsible
      key={lead.id}
      open={expandedCards.has(lead.id)}
      onOpenChange={() => toggleCardExpansion(lead.id)}
    >
      <Card 
        className={`glass-card transition-all duration-200 shadow-sm overflow-hidden w-full max-w-full cursor-pointer hover:scale-[1.01] hover:shadow-md ${
          clickedCardId === lead.id ? 'ring-2 ring-primary ring-offset-2' : ''
        }`}
        onClick={() => {
          console.log('[LeadsList] Mobile card clicked:', { leadId: lead.id, lat: lead.latitude, lng: lead.longitude });
          triggerCardClick(lead);
        }}
      >
        <CollapsibleTrigger asChild>
          <div className="cursor-pointer w-full">
            {renderCompactHeader(lead)}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t pt-3 overflow-hidden">
            <div className="flex items-center justify-between mb-2 px-3 min-w-0 gap-2">
              <CardTitle className="text-sm truncate min-w-0 flex-1">{lead.customer_name}</CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover text-popover-foreground z-50">
                  <DropdownMenuItem onClick={() => setEditingLead(lead)}>
                    <Pencil className="h-4 w-4 mr-2" />
                    Edit Lead
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setEditingTimesLead(lead)}>
                    <Timer className="h-4 w-4 mr-2" />
                    Edit Times
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate(`/admin/quotes?leadId=${lead.id}`)}>
                    <FileText className="h-4 w-4 mr-2" />
                    Create Quote
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {statusOptions.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      onClick={() => handleStatusChange(lead.id, status)}
                      disabled={lead.status === status}
                    >
                      Mark as {status.replace("_", " ")}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => confirmDelete(lead.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Lead
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {renderFullContent(lead)}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <div className="h-full flex flex-col overflow-hidden max-h-[calc(100vh-120px)] md:max-h-[calc(100vh-80px)] lg:max-h-none">
      {/* Fixed header */}
      <div className="p-4 border-b border-border/40 flex-shrink-0 sticky top-0 z-10 glass-header">
        {headerSlot && <div className="mb-4">{headerSlot}</div>}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Recent Leads</h2>
            <p className="text-sm text-muted-foreground">
              {leads.length} total leads
            </p>
          </div>
          {/* Manual refresh button for desktop */}
          {!isMobile && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8"
              onClick={() => fetchLeads(true)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
        {/* Pull-to-refresh hint for mobile */}
        {isMobile && (
          <p className="text-xs text-muted-foreground mt-1">Pull down to refresh</p>
        )}
      </div>

      {/* Scrollable leads container with pull-to-refresh */}
      <div 
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto overscroll-contain relative"
        style={{ 
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'thin'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onScroll={handleScroll}
      >
        {/* Pull-to-refresh indicator */}
        {isMobile && (pullDistance > 0 || isRefreshing) && (
          <div 
            className="flex items-center justify-center py-2 transition-all duration-200"
            style={{ 
              height: isRefreshing ? PULL_THRESHOLD : pullDistance,
              opacity: Math.min(pullDistance / PULL_THRESHOLD, 1)
            }}
          >
            <RefreshCw 
              className={`h-5 w-5 text-primary ${isRefreshing ? 'animate-spin' : ''}`}
              style={{
                transform: `rotate(${(pullDistance / PULL_THRESHOLD) * 180}deg)`,
                transition: isRefreshing ? 'none' : 'transform 0.1s ease-out'
              }}
            />
            <span className="ml-2 text-sm text-muted-foreground">
              {isRefreshing ? 'Refreshing...' : pullDistance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}
            </span>
          </div>
        )}
        
        <div className="p-3 space-y-2 w-full max-w-full">
          {leads.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-8 text-center text-muted-foreground">
                No leads yet
              </CardContent>
            </Card>
          ) : (
            leads.map((lead) => (
              useCompact ? renderMobileCard(lead) : renderDesktopCard(lead)
            ))
          )}
        </div>

        {/* Scroll-to-top floating button */}
        {showScrollTop && (
          <Button
            variant="secondary"
            size="icon"
            className="fixed bottom-20 right-4 z-20 h-10 w-10 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
            onClick={scrollToTop}
            aria-label="Scroll to top"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The lead will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLead} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Lead Dialog */}
      <EditLeadDialog
        lead={editingLead}
        open={!!editingLead}
        onOpenChange={(open) => !open && setEditingLead(null)}
        onSuccess={() => fetchLeads()}
      />

      {/* Edit Times Dialog (Admin) */}
      {editingTimesLead && (
        <LeadTimeEditDialog
          lead={editingTimesLead}
          open={!!editingTimesLead}
          onOpenChange={(open) => !open && setEditingTimesLead(null)}
          onSaved={() => fetchLeads()}
        />
      )}
    </div>
  );
};

export default LeadsList;