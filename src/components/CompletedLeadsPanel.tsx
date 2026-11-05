import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, MapPin, Navigation, Crosshair, ChevronDown, RefreshCw, ArrowUp, CheckCircle2, Calendar, X, FilePlus } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import CreateInvoiceDialog from "@/components/invoicing/CreateInvoiceDialog";
import type { CompletedMapCard } from "@/lib/completedMapJobs";

interface CompletedLeadsPanelProps {
  cards: CompletedMapCard[];
  onOpenJob: (jobId: string) => void;
  onLeadClick?: (lat: number, lng: number, leadId: string) => void;
  onPanelClose?: () => void;
  onRefresh?: () => void;
  isVisible: boolean;
  error?: string | null;
}

interface InvoiceInfo {
  id: string;
  invoice_number: string;
  status: string;
  grand_total: number;
}

const CompletedLeadsPanel = ({ cards, onOpenJob, onLeadClick, onPanelClose, onRefresh, isVisible, error }: CompletedLeadsPanelProps) => {
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [invoiceMap, setInvoiceMap] = useState<Map<string, InvoiceInfo>>(new Map());
  const [invoiceDialogLead, setInvoiceDialogLead] = useState<CompletedMapCard | null>(null);
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);
  const isPulling = useRef(false);
  const PULL_THRESHOLD = 80;

  const leadKey = cards.map((c) => c.leadId).filter(Boolean).join(",");
  useEffect(() => {
    if (!isVisible) return;
    const leadIds = leadKey ? leadKey.split(",") : [];
    if (!leadIds.length) { setInvoiceMap(new Map()); return; }
    let cancelled = false;
    supabase.from("lead_invoice_status")
      .select("lead_id, invoice_id, invoice_number, invoice_status, invoice_total, invoice_state")
      .in("lead_id", leadIds)
      .not("invoice_id", "is", null)
      .then(({ data }) => {
        if (cancelled || !data) return;
        const map = new Map<string, InvoiceInfo>();
        data.forEach((inv) => {
          map.set(inv.lead_id, {
            id: inv.invoice_id,
            invoice_number: inv.invoice_number,
            status: inv.invoice_state === "deposit_only" ? "deposit" : inv.invoice_status,
            grand_total: Number(inv.invoice_total),
          });
        });
        setInvoiceMap(map);
      }, () => {});
    return () => { cancelled = true; };
  }, [isVisible, leadKey]);

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
      await onRefresh?.();
      toast({ title: "Refreshed", description: "Completed jobs updated" });
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

  const handleLocateOnMap = (card: CompletedMapCard, e: React.MouseEvent) => {
    e.stopPropagation();
    if (card.lat == null || card.lng == null || !card.leadId) return;
    onLeadClick?.(card.lat, card.lng, card.leadId);
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

  const handleCreateInvoice = (card: CompletedMapCard, e: React.MouseEvent) => {
    e.stopPropagation();
    setInvoiceDialogLead(card);
  };

  const renderInvoiceBadge = (card: CompletedMapCard) => {
    if (!card.leadId) return null;
    const inv = invoiceMap.get(card.leadId);
    if (!inv || inv.status === "deposit") {
      return (
        <Button
          variant="default"
          size="sm"
          className="h-6 px-2 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          onClick={(e) => handleCreateInvoice(card, e)}
        >
          <FilePlus className="h-3 w-3" />
          {inv ? "Invoice balance" : "Create Invoice"}
        </Button>
      );
    }
    if (inv.status === "paid") {
      return (
        <Badge className="text-xs px-1.5 py-0 border-0 bg-emerald-500/15 text-emerald-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Paid – R {inv.grand_total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
        </Badge>
      );
    }
    return (
      <Badge className="text-xs px-1.5 py-0 border-0 bg-orange-500/15 text-orange-600">
        Invoiced – {inv.invoice_number} R {inv.grand_total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
      </Badge>
    );
  };

  const openJob = (card: CompletedMapCard, e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenJob(card.jobId);
  };

  const renderCompactHeader = (card: CompletedMapCard) => (
    <div className="flex items-center w-full py-2.5 px-3 gap-2 min-w-0">
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" data-open-job={card.jobId} onClick={(e) => openJob(card, e)} className="min-w-0 flex-1 truncate text-left text-sm font-medium text-primary underline-offset-2 hover:underline">{card.name}</button>
          <Badge className="bg-black dark:bg-white text-white dark:text-black flex-shrink-0">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        </div>
        <div className="flex items-center gap-1.5 mt-1 min-w-0 flex-wrap">
          <span className="text-xs text-muted-foreground truncate min-w-0 flex-1">{card.service}</span>
          {renderInvoiceBadge(card)}
          {card.completedAt && (
            <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 flex items-center gap-1">
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span className="truncate max-w-[80px]">{format(new Date(card.completedAt), "MMM d, yyyy")}</span>
            </span>
          )}
        </div>
      </div>
      <ChevronDown className={cn(
        "h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform",
        expandedCards.has(card.jobId) && "rotate-180"
      )} />
    </div>
  );

  const renderFullContent = (card: CompletedMapCard) => (
    <CardContent className="space-y-2 text-sm pt-0 pb-3 px-3 overflow-hidden">
      {card.address && (
        <button
          onClick={(e) => openNavigation(card.address || "", e)}
          className="flex items-start gap-2 w-full text-left hover:bg-accent/50 p-1 -m-1 rounded transition-colors group min-w-0"
        >
          <MapPin className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
          <span className="text-xs text-primary underline group-hover:no-underline flex-1 min-w-0 break-words">{card.address}</span>
          <Navigation className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
        </button>
      )}
      {card.phone && (
        <div className="flex items-center gap-2 min-w-0">
          <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <a href={`tel:${card.phone}`} className="text-xs text-primary hover:underline truncate min-w-0" onClick={(e) => e.stopPropagation()}>{card.phone}</a>
        </div>
      )}
      {card.completedBy && (
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="outline" className="text-xs truncate max-w-full" data-completed-by={card.jobId}>
            Completed by: {card.completedBy}
          </Badge>
        </div>
      )}
      {card.completedAt && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3 flex-shrink-0" />
          <span>Completed: {format(new Date(card.completedAt), "MMM d, yyyy HH:mm")}</span>
        </div>
      )}
      <div className="flex items-center justify-end pt-1 gap-2 min-w-0">
        {card.lat != null && card.lng != null && card.leadId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 gap-1 text-xs flex-shrink-0"
            onClick={(e) => handleLocateOnMap(card, e)}
          >
            <Crosshair className="h-3 w-3" />
            Locate
          </Button>
        )}
      </div>
    </CardContent>
  );

  const renderDesktopCard = (card: CompletedMapCard) => (
    <Card
      key={card.jobId}
      data-completed-job={card.jobId}
      className="glass-card transition-all"
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">
              <button type="button" data-open-job={card.jobId} onClick={(e) => openJob(card, e)} className="truncate text-left text-primary underline-offset-2 hover:underline">{card.name}</button>
            </CardTitle>
            <CardDescription className="text-xs">{card.service}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge className="bg-black dark:bg-white text-white dark:text-black">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              Completed
            </Badge>
            {renderInvoiceBadge(card)}
          </div>
        </div>
      </CardHeader>
      {renderFullContent(card)}
    </Card>
  );

  const renderMobileCard = (card: CompletedMapCard) => (
    <Collapsible
      key={card.jobId}
      open={expandedCards.has(card.jobId)}
      onOpenChange={() => toggleCardExpansion(card.jobId)}
    >
      <Card data-completed-job={card.jobId} className="glass-card transition-all overflow-hidden w-full max-w-full">
        <CollapsibleTrigger asChild>
          <div className="cursor-pointer w-full">
            {renderCompactHeader(card)}
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t pt-3 overflow-hidden">
            {renderFullContent(card)}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );

  return (
    <>
    <div className={cn(
      "h-full flex flex-col overflow-hidden transition-all duration-300 ease-out",
      "max-h-[calc(100vh-120px)] md:max-h-[calc(100vh-80px)] lg:max-h-none"
    )}>
      {/* Fixed header */}
      <div className="p-4 border-b border-white/10 flex-shrink-0 sticky top-0 z-10 glass-header">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-foreground" />
            <div>
              <h2 className="text-lg font-semibold text-foreground">Completed Jobs</h2>
              <p className="text-sm text-muted-foreground">
                {cards.length} completed
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isMobile && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => onRefresh?.()}
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
        data-bounce
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
          {error ? (
            <Card className="glass-card">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">{error}</CardContent>
            </Card>
          ) : cards.length === 0 ? (
            <Card className="glass-card">
              <CardContent className="py-8 text-center text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                No completed jobs yet
              </CardContent>
            </Card>
          ) : (
            cards.map((card) => (
              isMobile ? renderMobileCard(card) : renderDesktopCard(card)
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

    {/* Invoice creation dialog */}
    {invoiceDialogLead?.leadId && currentUserId && (
      <CreateInvoiceDialog
        open={!!invoiceDialogLead}
        onClose={() => {
          setInvoiceDialogLead(null);
          onRefresh?.();
        }}
        agentId={currentUserId}
        prefillLead={{
          id: invoiceDialogLead.leadId || invoiceDialogLead.jobId,
          customer_name: invoiceDialogLead.name,
          customer_phone: invoiceDialogLead.phone || "",
          customer_address: invoiceDialogLead.address || "",
        }}
      />
    )}
    </>
  );
};

export default CompletedLeadsPanel;
