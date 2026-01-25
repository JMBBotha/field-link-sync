import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Phone, MapPin, Clock, Navigation, Crosshair, ChevronDown, RefreshCw, ArrowUp, CheckCircle2, Calendar, X } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface Lead {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  service_type: string;
  status: string;
  created_at: string;
  completed_at?: string | null;
  latitude: number;
  longitude: number;
  notes?: string | null;
  priority?: string;
  profiles?: { full_name: string };
}

interface CompletedLeadsPanelProps {
  onLeadClick?: (lat: number, lng: number, leadId: string) => void;
  onPanelClose?: () => void;
  isVisible: boolean;
}

const CompletedLeadsPanel = ({ onLeadClick, onPanelClose, isVisible }: CompletedLeadsPanelProps) => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const PULL_THRESHOLD = 80;

  useEffect(() => {
    if (isVisible) {
      fetchCompletedLeads();
      const cleanup = subscribeToLeads();
      return cleanup;
    }
  }, [isVisible]);

  const fetchCompletedLeads = async (showToast = false) => {
    const { data } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "completed")
      .order("completed_at", { ascending: false });

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
      setLeads(leadsWithProfiles as Lead[]);
      if (showToast) {
        toast({
          title: "Refreshed",
          description: "Completed leads updated",
        });
      }
    }
  };

  const subscribeToLeads = () => {
    const channel = supabase
      .channel("completed-leads-list")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
        },
        () => fetchCompletedLeads()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  };

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
    const resistedDistance = Math.min(distance * 0.5, PULL_THRESHOLD * 1.5);
    setPullDistance(resistedDistance);
  }, [isMobile, isRefreshing]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || !isMobile) return;
    
    isPulling.current = false;
    
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      await fetchCompletedLeads(true);
      setIsRefreshing(false);
    }
    
    setPullDistance(0);
  }, [isMobile, pullDistance, isRefreshing]);

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

  const openNavigation = (address: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const encodedAddress = encodeURIComponent(address);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodedAddress}`, '_blank', 'noopener,noreferrer');
  };

  const handleLocateOnMap = (lead: Lead, e: React.MouseEvent) => {
    e.stopPropagation();
    onLeadClick?.(lead.latitude, lead.longitude, lead.id);
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

  const renderCompactHeader = (lead: Lead) => (
    <div className="flex items-center w-full py-2.5 px-3 gap-2 min-w-0">
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-medium text-sm truncate min-w-0 flex-1">{lead.customer_name}</span>
          <Badge className="bg-black dark:bg-white text-white dark:text-black flex-shrink-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        </div>
        <div className="flex items-center gap-2 mt-1 min-w-0">
          <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">{lead.service_type}</span>
          {lead.completed_at && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span className="truncate max-w-[80px]">{format(new Date(lead.completed_at), 'MMM d, yyyy')}</span>
            </span>
          )}
        </div>
      </div>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform",
        expandedCards.has(lead.id) && "rotate-180"
      )} />
    </div>
  );

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
      <div className="flex items-center gap-2 min-w-0">
        <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <a href={`tel:${lead.customer_phone}`} className="text-xs text-primary hover:underline truncate min-w-0" onClick={(e) => e.stopPropagation()}>{lead.customer_phone}</a>
      </div>
      {lead.profiles && (
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-xs truncate max-w-full">
            Completed by: {lead.profiles.full_name}
          </Badge>
        </div>
      )}
      {lead.completed_at && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>Completed: {format(new Date(lead.completed_at), 'MMM d, yyyy h:mm a')}</span>
        </div>
      )}
      <div className="flex items-center justify-between pt-1 gap-2 min-w-0">
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0 flex-1">
          <Clock className="h-3 w-3 flex-shrink-0" />
          <span className="truncate">Created {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}</span>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          className="h-7 px-2 gap-1 text-xs flex-shrink-0"
          onClick={(e) => handleLocateOnMap(lead, e)}
        >
          <Crosshair className="h-3 w-3" />
          Locate
        </Button>
      </div>
    </CardContent>
  );

  const renderDesktopCard = (lead: Lead) => (
    <Card 
      key={lead.id} 
      className="bg-gradient-to-r from-blue-100 to-slate-50 backdrop-blur-sm border-border/50 hover:from-blue-50 hover:to-white transition-all shadow-md"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base">{lead.customer_name}</CardTitle>
            <CardDescription className="text-xs">
              {lead.service_type}
            </CardDescription>
          </div>
          <Badge className="bg-black dark:bg-white text-white dark:text-black">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        </div>
      </CardHeader>
      {renderFullContent(lead)}
    </Card>
  );

  const renderMobileCard = (lead: Lead) => (
    <Collapsible
      key={lead.id}
      open={expandedCards.has(lead.id)}
      onOpenChange={() => toggleCardExpansion(lead.id)}
    >
      <Card className="bg-gradient-to-r from-blue-100 to-slate-50 backdrop-blur-sm border-border/50 hover:from-blue-50 hover:to-white transition-all shadow-md overflow-hidden w-full max-w-full">
        <CollapsibleTrigger asChild>
          <div className="cursor-pointer w-full">
            {renderCompactHeader(lead)}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t pt-3 overflow-hidden">
            {renderFullContent(lead)}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <div className={cn(
      "h-full flex flex-col overflow-hidden transition-all duration-300 ease-out",
      "max-h-[calc(100vh-120px)] md:max-h-[calc(100vh-80px)] lg:max-h-none"
    )}>
      {/* Fixed header */}
      <div className="p-4 border-b border-white/10 flex-shrink-0 sticky top-0 z-10 bg-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-foreground" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Completed Jobs</h2>
              <p className="text-sm text-muted-foreground">
                {leads.length} completed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isMobile && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => fetchCompletedLeads(true)}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            )}
            {onPanelClose && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={onPanelClose}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
        {isMobile && (
          <p className="text-xs text-muted-foreground mt-1">Pull down to refresh</p>
        )}
      </div>

      {/* Scrollable leads container */}
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
              className={cn("h-5 w-5 text-primary", isRefreshing && "animate-spin")}
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
            <Card className="bg-gradient-to-r from-blue-100 to-slate-50 border-border/50 shadow-md">
              <CardContent className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                No completed jobs yet
              </CardContent>
            </Card>
          ) : (
            leads.map((lead) => (
              isMobile ? renderMobileCard(lead) : renderDesktopCard(lead)
            ))
          )}
        </div>

        {/* Scroll-to-top floating button */}
        {showScrollTop && (
          <Button
            variant="secondary"
            size="icon"
            className="fixed bottom-20 left-4 z-20 h-10 w-10 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-300 animate-in fade-in slide-in-from-bottom-2"
            onClick={scrollToTop}
            aria-label="Scroll to top"
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default CompletedLeadsPanel;
