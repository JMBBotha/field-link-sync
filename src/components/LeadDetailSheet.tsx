import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { X, Phone, MapPin, Clock, Navigation, Loader2, AlertCircle, Pencil, Camera, ClockIcon, Images, Plus, FileText, Timer, GitBranch, CloudOff } from "lucide-react";
import BookingBadge from "@/components/BookingBadge";
import CustomerJobHistory from "@/components/CustomerJobHistory";
import CreateInvoiceDialog from "@/components/invoicing/CreateInvoiceDialog";
import HelpTip from "@/components/help/HelpTip";
import { useJobPhotos, PhotoType } from "@/hooks/useJobPhotos";
import { useOfflineContext } from "@/contexts/OfflineContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import InvoiceForm from "./InvoiceForm";
import JobCompletionFlow from "./JobCompletionFlow";
import CustomerProfile from "./CustomerProfile";
import EntityDetailsForm from "@/components/entity/EntityDetailsForm";
import JobDurationPicker from "./JobDurationPicker";
import JobProgressSection from "./JobProgressSection";
import { PhotoGallery } from "./PhotoGallery";
import { ExpandedPhotoGallery } from "./ExpandedPhotoGallery";
import AgentChangeRequestDialog from "./AgentChangeRequestDialog";
import LeadTimeEditDialog from "./LeadTimeEditDialog";
import { JobScheduleDisplay } from "./JobScheduleDisplay";
import TimeTracker from "./TimeTracker";
import TimeEntryList from "./TimeEntryList";
import JobTimeline from "./JobTimeline";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSingleLeadPhotoCount } from "@/hooks/useLeadPhotoCount";
import CommunicationTimeline from "./communication/CommunicationTimeline";
import CallHistoryPanel from "./calls/CallHistoryPanel";
import UsedPartsSection from "./UsedPartsSection";
import JobCompletionSheet from "./jobs/JobCompletionSheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, DollarSign } from "lucide-react";
import QuickTemplateDialog from "./quoting/QuickTemplateDialog";
import AcceptLeadDialog from "./leads/AcceptLeadDialog";
import LeadClassificationPanel from "./leads/LeadClassificationPanel";


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
  // Duration tracking fields
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
  // Schedule fields
  scheduled_date?: string | null;
  completed_at?: string | null;
}

interface LeadDetailSheetProps {
  lead: Lead | null;
  open: boolean;
  onClose: () => void;
  onAccept: (leadId: string) => Promise<void>;
  onStart: (leadId: string, durationMinutes: number) => Promise<void>;
  onComplete: (leadId: string, equipmentId?: string | null) => Promise<void>;
  onRelease: (leadId: string) => void | Promise<void>;
  currentUserId?: string;
  loadingAction: string | null;
  onLeadUpdated?: () => void;
  queueOperation?: (
    operationType: any,
    tableName: string,
    recordId: string,
    data: any
  ) => Promise<string | void>;
}

// Format relative time
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

const getPriorityIndicator = (priority: string | undefined) => {
  if (!priority || priority === "normal" || priority === "low") return null;
  
  const config: Record<string, { color: string; label: string }> = {
    urgent: { color: "bg-red-500", label: "Urgent" },
    high: { color: "bg-orange-500", label: "High Priority" },
  };
  
  const p = config[priority];
  if (!p) return null;
  
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <AlertCircle className="h-3.5 w-3.5" style={{ color: priority === "urgent" ? "#ef4444" : "#f97316" }} />
      <span className="font-medium" style={{ color: priority === "urgent" ? "#ef4444" : "#f97316" }}>
        {p.label}
      </span>
    </div>
  );
};

const LeadDetailSheet = ({
  lead,
  open,
  onClose,
  onAccept,
  onStart,
  onComplete,
  onRelease,
  currentUserId,
  loadingAction,
  onLeadUpdated,
  queueOperation,
}: LeadDetailSheetProps) => {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [showCompletionFlow, setShowCompletionFlow] = useState(false);
  const [showSignOff, setShowSignOff] = useState(false);
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showChangeRequestDialog, setShowChangeRequestDialog] = useState(false);
  const [showAcceptDialog, setShowAcceptDialog] = useState(false);
  const [showTimeEditDialog, setShowTimeEditDialog] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [showPhotoTypePicker, setShowPhotoTypePicker] = useState(false);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([]);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const [uploadingMultiple, setUploadingMultiple] = useState(false);
  const [showExpandedGallery, setShowExpandedGallery] = useState(false);
  const [showInlineInvoice, setShowInlineInvoice] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateCustomerId, setTemplateCustomerId] = useState<string | null>(null);
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isOnline, queueOperation: contextQueueOp } = useOfflineContext();
  const [timeRefreshKey, setTimeRefreshKey] = useState(0);
  
  // Use provided queueOperation or fall back to context
  const queueOp = queueOperation || contextQueueOp;

  // Photo upload hook
  const { 
    uploading: photoUploading, 
    pendingCount: photoPendingCount, 
    uploadPhoto,
    deletePhoto,
    deleting: photoDeleting,
  } = useJobPhotos({
    leadId: lead?.id || '',
    agentId: currentUserId || '',
    isOnline,
    queueOperation: queueOp,
  });

  // Fetch invoice status for this lead
  const { data: leadInvoice } = useQuery({
    queryKey: ['lead-invoice', lead?.id],
    queryFn: async () => {
      if (!lead?.id) return null;
      const { data } = await supabase
        .from('invoices')
        .select('id, invoice_number, status, grand_total')
        .eq('lead_id', lead.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!lead?.id && lead?.status === 'completed',
  });

  if (!lead) return null;

  const isOwner = lead.assigned_agent_id === currentUserId;
  const isAvailable = ["pending", "open", "released"].includes(lead.status) && !lead.assigned_agent_id;
  const isClaimed = ["claimed", "accepted"].includes(lead.status) && isOwner;
  const isInProgress = lead.status === "in_progress" && isOwner;
  const isCompleted = lead.status === "completed";
  const canEdit = isOwner || isClaimed || isInProgress; // Field agent can edit their assigned leads

  const navigationUrl = `https://www.google.com/maps/dir/?api=1&destination=${lead.latitude},${lead.longitude}`;
  const addressSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.customer_address)}`;

  const handleCompleteClick = () => {
    // On-site sign-off first: photos/parts/time recap + customer signature
    setShowSignOff(true);
  };

  const handleSignedOff = () => {
    setShowSignOff(false);
    onLeadUpdated?.();
    // If customer has equipment, show equipment flow next
    if (lead.customer_id) {
      setShowCompletionFlow(true);
    } else {
      setShowInvoiceForm(true);
    }
  };

  const handleEquipmentSelected = (equipmentId: string | null) => {
    setSelectedEquipmentId(equipmentId);
    setShowCompletionFlow(false);
    setShowInvoiceForm(true);
  };

  const handleInvoiceSuccess = async () => {
    await onComplete(lead.id, selectedEquipmentId);
    setShowInvoiceForm(false);
    setSelectedEquipmentId(null);
  };

  // Handle start job with duration picker
  const handleStartJobClick = () => {
    setShowDurationPicker(true);
  };

  const handleDurationConfirm = async (durationMinutes: number) => {
    await onStart(lead.id, durationMinutes);
    setShowDurationPicker(false);
  };

  // Ensure lead has a linked customer; returns customer id or null on failure.
  const ensureLeadCustomerId = async (): Promise<string | null> => {
    let customerId = lead.customer_id || null;
    if (customerId) return customerId;

    const { findCustomerMatch } = await import("@/lib/customerMatch");
    const { getUserCompanyId } = await import("@/lib/tenantUtils");
    const companyId = await getUserCompanyId(currentUserId);
    if (!companyId) {
      toast({ title: "No company found", variant: "destructive" });
      return null;
    }
    const match = await findCustomerMatch(companyId, lead.customer_phone, null);
    if (match) {
      const ok = window.confirm(
        `Possible existing customer found: ${match.name || match.phone}.\n\nLink this lead to that customer? (Cancel = create a new customer)`
      );
      if (ok) {
        customerId = match.id;
      } else {
        const { data: newCust, error: cErr } = await supabase
          .from("customers")
          .insert({
            company_id: companyId,
            name: lead.customer_name,
            phone: lead.customer_phone,
            address: lead.customer_address,
          })
          .select("id")
          .single();
        if (cErr) {
          toast({ title: cErr.message, variant: "destructive" });
          return null;
        }
        customerId = newCust.id;
      }
    } else {
      const { data: newCust, error: cErr } = await supabase
        .from("customers")
        .insert({
          company_id: companyId,
          name: lead.customer_name,
          phone: lead.customer_phone,
          address: lead.customer_address,
        })
        .select("id")
        .single();
      if (cErr) {
        toast({ title: cErr.message, variant: "destructive" });
        return null;
      }
      customerId = newCust.id;
    }

    await supabase.from("leads").update({ customer_id: customerId }).eq("id", lead.id);
    const linkedId = customerId!;
    qc.getQueriesData<any[]>({ queryKey: ["leads"] }).forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      qc.setQueryData(
        k,
        list.map((l: any) => (l.id === lead.id ? { ...l, customer_id: linkedId } : l)),
      );
    });
    qc.setQueryData(["lead", lead.id], (prev: any) =>
      prev ? { ...prev, customer_id: linkedId } : prev,
    );
    qc.invalidateQueries({ queryKey: ["unified-clients"] });
    return customerId;
  };

  // Create Draft Quote from Lead - ensures a customer, then opens builder prefilled
  const handleCreateDraftQuote = async () => {
    try {
      const customerId = await ensureLeadCustomerId();
      if (!customerId) return;
      const params = new URLSearchParams({
        leadId: lead.id,
        customerId,
        quoteName: `${lead.service_type || "Quote"} - ${lead.customer_name}`,
      });
      onClose();
      navigate(`/admin/quote-builder?${params.toString()}`);
    } catch (err: any) {
      toast({ title: err.message || "Failed to create draft quote", variant: "destructive" });
    }
  };

  // Open Template picker → routes through classic Quote Builder with prefilled items/terms
  const handleQuoteFromTemplate = async () => {
    try {
      const customerId = await ensureLeadCustomerId();
      if (!customerId) return;
      setTemplateCustomerId(customerId);
      setShowTemplatePicker(true);
    } catch (err: any) {
      toast({ title: err.message || "Failed to open template picker", variant: "destructive" });
    }
  };

  // Handle extending job time
  const handleExtendTime = async (additionalMinutes: number) => {
    try {
      const currentEnd = lead.estimated_end_time 
        ? new Date(lead.estimated_end_time) 
        : new Date();
      const newEnd = new Date(currentEnd.getTime() + additionalMinutes * 60 * 1000);
      const newDuration = (lead.estimated_duration_minutes || 60) + additionalMinutes;

      await supabase
        .from("leads")
        .update({
          estimated_duration_minutes: newDuration,
          estimated_end_time: newEnd.toISOString(),
        })
        .eq("id", lead.id);

      onLeadUpdated?.();
      
      toast({
        title: "Time Extended ⏱️",
        description: `Added ${additionalMinutes >= 60 ? `${Math.floor(additionalMinutes / 60)}h ${additionalMinutes % 60}m` : `${additionalMinutes}m`}`,
      });
    } catch (error) {
      console.error("Error extending time:", error);
      toast({
        title: "Error",
        description: "Failed to extend time",
        variant: "destructive",
      });
    }
  };

  // Handle adjusting total job time
  const handleAdjustTime = async (newTotalMinutes: number) => {
    try {
      const startTime = lead.actual_start_time 
        ? new Date(lead.actual_start_time) 
        : new Date();
      const newEnd = new Date(startTime.getTime() + newTotalMinutes * 60 * 1000);

      await supabase
        .from("leads")
        .update({
          estimated_duration_minutes: newTotalMinutes,
          estimated_end_time: newEnd.toISOString(),
        })
        .eq("id", lead.id);

      onLeadUpdated?.();
      
      toast({
        title: "Time Updated ⏱️",
        description: `New estimate: ${newTotalMinutes >= 60 ? `${Math.floor(newTotalMinutes / 60)}h ${newTotalMinutes % 60}m` : `${newTotalMinutes}m`}`,
      });
    } catch (error) {
      console.error("Error adjusting time:", error);
      toast({
        title: "Error",
        description: "Failed to update time",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent 
          side="bottom" 
          className="max-h-[80vh] bg-card/80 backdrop-blur-lg flex flex-col p-0 border-border/50 shadow-2xl"
          hideCloseButton
        >
          {/* Swipe Handle */}
          <div className="flex justify-center pt-3 pb-2 shrink-0">
            <div className="w-10 h-1 bg-muted-foreground/40 rounded-full" />
          </div>

          <SheetHeader className="px-4 pb-3 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-lg font-bold text-left truncate">
                  {lead.customer_name}
                </SheetTitle>
                <p className="text-sm text-muted-foreground truncate">{lead.service_type}</p>
                <BookingBadge scheduledDate={lead.scheduled_date} scheduledTime={(lead as any).scheduled_time} status={lead.status} className="mt-1" />
                {getPriorityIndicator(lead.priority)}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {getStatusBadge(lead.status)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          {/* Offline mini-banner inside detail sheet */}
          {!isOnline && (
            <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-1.5 rounded-lg bg-orange-500/15 border border-orange-400/30 text-orange-500 text-xs font-medium">
              <CloudOff className="h-3.5 w-3.5 shrink-0" />
              <span>Offline — changes will sync when reconnected</span>
            </div>
          )}

          <ScrollArea className="flex-1 min-h-0 overflow-y-auto">
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="w-full grid grid-cols-4 mx-4 mb-2" style={{ width: 'calc(100% - 2rem)' }}>
                <TabsTrigger value="details" className="text-xs">Details</TabsTrigger>
                <TabsTrigger value="time" className="text-xs">Time</TabsTrigger>
                <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
                <TabsTrigger value="comms" className="text-xs">Comms</TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="mt-0">
            <div className="space-y-3 px-4 pb-4">
            {isInProgress && lead.actual_start_time && (
              <JobProgressSection
                startedAt={lead.actual_start_time}
                estimatedDurationMinutes={lead.estimated_duration_minutes || null}
                estimatedEndTime={lead.estimated_end_time || null}
                onExtendTime={handleExtendTime}
                onAdjustTime={handleAdjustTime}
              />
            )}

            {/* Phone & Address Row - Compact on same row when possible */}
            <div className="grid grid-cols-2 gap-2">
              {/* Phone */}
              <a
                href={`tel:${lead.customer_phone}`}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Phone className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">{lead.customer_phone}</p>
                  <p className="text-[10px] text-muted-foreground">Call</p>
                </div>
              </a>

              {/* Navigate */}
              <a
                href={navigationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2.5 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
              >
                <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                  <Navigation className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium truncate">Navigate</p>
                  <p className="text-[10px] text-muted-foreground">Directions</p>
                </div>
              </a>
            </div>

            {/* Address - Full width */}
            <a
              href={addressSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2.5 p-2.5 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
            >
              <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium line-clamp-2">{lead.customer_address}</p>
                <p className="text-[10px] text-muted-foreground">View on map</p>
              </div>
            </a>

            {/* Classification (rule/AI) with human override */}
            <LeadClassificationPanel leadId={lead.id} />

            {/* Lead Information — full summary of everything captured at intake */}

            <div className="rounded-xl border border-border/60 bg-background/60 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Lead Information</h3>
                {lead.created_at && (
                  <span className="text-[10px] text-muted-foreground">
                    Created {formatTimeAgo(lead.created_at)}
                  </span>
                )}
              </div>

              <EntityDetailsForm
                entityType="lead"
                entityId={lead.id}
                initialData={lead as any}
                readOnly={!canEdit}
                visibleFields={[
                  "customer_name",
                  "customer_phone",
                  "customer_email",
                  "customer_address",
                  "service_type",
                  "priority",
                  "status",
                  "assigned_agent_id",
                  "scheduled_date",
                  "scheduled_time",
                  "order_status",
                  "parts_status",
                  "notes",
                ]}
              />
            </div>


            {/* Customer Job History */}
            <CustomerJobHistory
              customerId={lead.customer_id}
              customerPhone={lead.customer_phone}
              currentLeadId={lead.id}
            />

            {/* Create Draft Quote - available before completion */}
            {lead?.status !== 'completed' && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    className="flex-1"
                    onClick={handleCreateDraftQuote}
                  >
                    <FileText className="mr-2 h-5 w-5" />
                    Blank Draft Quote
                  </Button>
                  <HelpTip title="Create Draft Quote" side="left">
                    Auto-links (or creates) the customer, then opens the Quote
                    Builder pre-filled with this lead's details.
                  </HelpTip>
                </div>
                <Button
                  size="lg"
                  className="w-full border-l-4 border-l-accent-yellow"
                  onClick={handleQuoteFromTemplate}
                >
                  <FileText className="mr-2 h-5 w-5" />
                  Quote from Template
                </Button>
              </div>
            )}

            {/* Create Invoice - Completed leads only */}
            {lead?.status === 'completed' && (
              leadInvoice ? (
                <div className={`w-full flex items-center justify-between p-3 rounded-lg border ${
                  leadInvoice.status === 'paid' 
                    ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' 
                    : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                }`}>
                  <div className="flex items-center gap-2">
                    {leadInvoice.status === 'paid' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <FileText className="h-5 w-5 text-amber-600" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {leadInvoice.status === 'paid' ? 'Paid' : 'Invoiced'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        #{leadInvoice.invoice_number} · R {Number(leadInvoice.grand_total).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                  <Badge className={leadInvoice.status === 'paid' ? 'bg-green-600 text-white' : 'bg-amber-500 text-white'}>
                    {leadInvoice.status === 'paid' ? 'Paid' : leadInvoice.status === 'sent' ? 'Sent' : 'Draft'}
                  </Badge>
                </div>
              ) : (
                <Button
                  variant="default"
                  size="lg"
                  className="w-full"
                  style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                  onClick={() => setShowInlineInvoice(true)}
                >
                  <FileText className="mr-2 h-5 w-5" />
                  Create Invoice
                </Button>
              )
            )}


            {/* Job Schedule Display - shows dates and times */}
            <JobScheduleDisplay
              scheduledDate={lead.scheduled_date}
              startedAt={lead.started_at}
              actualStartTime={lead.actual_start_time}
              completedAt={lead.completed_at}
              estimatedEndTime={lead.estimated_end_time}
              estimatedDurationMinutes={lead.estimated_duration_minutes}
              status={lead.status}
              onEditClick={() => setShowTimeEditDialog(true)}
              canEdit={canEdit || isCompleted}
            />

            {/* Used Parts / Materials */}
            {(isInProgress || isCompleted) && currentUserId && (
              <UsedPartsSection
                leadId={lead.id}
                agentId={currentUserId}
                isOnline={isOnline}
                queueOperation={queueOp}
              />
            )}

            {/* Photo Gallery - Prominent inline section */}
            <div className="p-2.5 rounded-xl bg-gradient-to-r from-gray-600 to-gray-400 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Images className="h-3.5 w-3.5 text-white" />
                  <span className="text-xs font-medium text-white">Photos</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 text-white hover:text-white/80 hover:bg-white/10"
                  onClick={() => setShowExpandedGallery(true)}
                >
                  View All
                </Button>
              </div>
              <PhotoGallery 
                leadId={lead.id} 
                isOnline={isOnline} 
                onDeletePhoto={deletePhoto}
                onAddPhotos={() => photoInputRef.current?.click()}
                onPhotoClick={() => setShowExpandedGallery(true)}
                deleting={photoDeleting}
                refreshKey={galleryRefreshKey}
                compact
              />
            </div>


            {/* Action Buttons */}
            <div className="space-y-2 pt-1 pb-8">
              {/* Photo upload - available for all lead stages */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    setPendingPhotoFiles(Array.from(files));
                    setShowPhotoTypePicker(true);
                    e.target.value = '';
                  }
                }}
              />
              
              {/* Secondary actions row - Photo, Edit, Time Change */}
              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-11 rounded-lg text-xs px-2"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                >
                  {photoUploading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <>
                      <Camera className="h-3.5 w-3.5 mr-1" />
                      Photo
                      {photoPendingCount > 0 && (
                        <span className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-600 px-1 rounded">
                          {photoPendingCount}
                        </span>
                      )}
                    </>
                  )}
                </Button>

                {isOwner && (isClaimed || isInProgress || isCompleted) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-11 rounded-lg text-xs px-2"
                    onClick={() => setShowChangeRequestDialog(true)}
                  >
                    <ClockIcon className="h-3.5 w-3.5 mr-1" />
                    Time
                  </Button>
                )}
              </div>

              {/* Available leads - show Accept button */}
              {isAvailable && (
                <Button
                  className="w-full h-11 rounded-lg text-sm font-semibold"
                  style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                  onClick={() => setShowAcceptDialog(true)}
                  disabled={!!loadingAction}
                >
                  {loadingAction === 'accept' ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    "Accept Lead"
                  )}
                </Button>
              )}

              {/* Claimed leads - show Start Job + Release buttons */}
              {isClaimed && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-11 rounded-lg text-sm font-semibold"
                    style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                    onClick={handleStartJobClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'start' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      "Start Job"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 px-4 rounded-lg"
                    onClick={() => onRelease(lead.id)}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'release' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Release"
                    )}
                  </Button>
                </div>
              )}

              {/* In Progress leads - show Complete + Release buttons */}
              {isInProgress && (
                <div className="flex gap-2">
                  <Button
                    className="flex-1 h-11 rounded-lg text-sm font-semibold bg-green-600 hover:bg-green-700"
                    onClick={handleCompleteClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'complete' ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      "Complete Job"
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 px-4 rounded-lg"
                    onClick={() => onRelease(lead.id)}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'release' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Release"
                    )}
                  </Button>
                </div>
              )}

              {isCompleted && (
                leadInvoice ? (
                  <div className={`w-full flex items-center justify-between p-3 rounded-lg border ${
                    leadInvoice.status === 'paid' 
                      ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800' 
                      : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      {leadInvoice.status === 'paid' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-600" />
                      ) : (
                        <FileText className="h-5 w-5 text-amber-600" />
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          {leadInvoice.status === 'paid' ? 'Paid' : 'Invoiced'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          #{leadInvoice.invoice_number} · R {Number(leadInvoice.grand_total).toLocaleString('en-ZA', { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    <Badge className={leadInvoice.status === 'paid' ? 'bg-green-600 text-white' : 'bg-amber-500 text-white'}>
                      {leadInvoice.status === 'paid' ? 'Paid' : leadInvoice.status === 'sent' ? 'Sent' : 'Draft'}
                    </Badge>
                  </div>
                ) : (
                  <Button
                    className="w-full h-11 rounded-lg text-sm font-semibold"
                    style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                    onClick={() => setShowInlineInvoice(true)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Create Invoice
                  </Button>
                )
              )}

              {/* Created timestamp at bottom */}
              {lead.created_at && (
                <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground pt-2">
                  <Clock className="h-3 w-3" />
                  <span>Created {formatTimeAgo(lead.created_at)}</span>
                </div>
              )}
            </div>
            </div>
              </TabsContent>

              <TabsContent value="time" className="mt-0 px-4 pb-4 space-y-4">
                {currentUserId && (
                  <TimeTracker
                    leadId={lead.id}
                    agentId={currentUserId}
                    onSaved={() => setTimeRefreshKey((k) => k + 1)}
                  />
                )}
                <TimeEntryList leadId={lead.id} refreshKey={timeRefreshKey} />
              </TabsContent>

              <TabsContent value="timeline" className="mt-0 px-4 pb-4">
                <JobTimeline leadId={lead.id} lead={lead} />
              </TabsContent>

              <TabsContent value="comms" className="mt-0 px-4 pb-4 space-y-4">
                <CommunicationTimeline leadId={lead.id} customerId={lead.customer_id || undefined} />
                <CallHistoryPanel leadId={lead.id} title="Voice assistant calls" />
                {lead.customer_id && (
                  <CallHistoryPanel customerId={lead.customer_id} title="All calls from this client" />
                )}
              </TabsContent>
            </Tabs>
          </ScrollArea>

          {/* Sticky bottom action bar — always visible, finger-friendly */}
          {(isAvailable || isClaimed || isInProgress) && (
            <div
              className="shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-md px-3 pt-3"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
            >
              <div className="flex items-stretch gap-2">
                <Button
                  variant="outline"
                  className="h-12 px-3 shrink-0"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  aria-label="Add photo"
                >
                  {photoUploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                </Button>


                {isAvailable && (
                  <Button
                    className="flex-1 h-12 text-base font-semibold"
                    style={{ backgroundColor: "#0077B6", color: "#FFFFFF" }}
                    onClick={() => setShowAcceptDialog(true)}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === "accept" ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Accepting…</>
                    ) : (
                      "Accept Lead"
                    )}
                  </Button>
                )}

                {isClaimed && (
                  <Button
                    className="flex-1 h-12 text-base font-semibold"
                    style={{ backgroundColor: "#0077B6", color: "#FFFFFF" }}
                    onClick={handleStartJobClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === "start" ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting…</>
                    ) : (
                      "Start Job"
                    )}
                  </Button>
                )}

                {isInProgress && (
                  <Button
                    className="flex-1 h-12 text-base font-semibold bg-green-600 hover:bg-green-700 text-white"
                    onClick={handleCompleteClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === "complete" ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Completing…</>
                    ) : (
                      "Complete Job"
                    )}
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>

      </Sheet>

      {/* Invoice Form */}
      {currentUserId && (
        <InvoiceForm
          lead={lead}
          open={showInvoiceForm}
          onClose={() => setShowInvoiceForm(false)}
          onSuccess={handleInvoiceSuccess}
          agentId={currentUserId}
        />
      )}

      {/* On-site sign-off: photos, parts, time, customer signature */}
      <JobCompletionSheet
        open={showSignOff}
        onOpenChange={setShowSignOff}
        leadId={lead.id}
        customerName={lead.customer_name}
        onCompleted={handleSignedOff}
      />

      {/* Job Completion Flow with Equipment Selection */}
      {lead.customer_id && (
        <JobCompletionFlow
          leadId={lead.id}
          customerId={lead.customer_id}
          open={showCompletionFlow}
          onClose={() => setShowCompletionFlow(false)}
          onComplete={handleEquipmentSelected}
        />
      )}

      {/* Customer Profile */}
      <CustomerProfile
        customerId={lead.customer_id || null}
        open={showCustomerProfile}
        onClose={() => setShowCustomerProfile(false)}
      />

      {/* Job Duration Picker */}
      <JobDurationPicker
        open={showDurationPicker}
        onClose={() => setShowDurationPicker(false)}
        onConfirm={handleDurationConfirm}
        isLoading={loadingAction === 'start'}
        mode="start"
      />

      {/* Agent Change Request Dialog */}
      {currentUserId && (
        <AgentChangeRequestDialog
          open={showChangeRequestDialog}
          onOpenChange={setShowChangeRequestDialog}
          lead={lead}
          agentId={currentUserId}
          onRequestSent={() => {
            toast({
              title: "Request submitted",
              description: "Admin will review your change request",
            });
          }}
        />
      )}

      {/* Photo Type Picker - supports multiple photos */}
      <Dialog open={showPhotoTypePicker} onOpenChange={(open) => {
        if (!open && !uploadingMultiple) {
          setPendingPhotoFiles([]);
        }
        setShowPhotoTypePicker(open);
      }}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">
              {pendingPhotoFiles.length > 1 
                ? `Add ${pendingPhotoFiles.length} Photos As` 
                : "Photo Type"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              variant="outline"
              className="h-14 text-base font-medium border-2 hover:border-blue-500 hover:bg-blue-50"
              onClick={async () => {
                if (pendingPhotoFiles.length > 0) {
                  setUploadingMultiple(true);
                  setShowPhotoTypePicker(false);
                  for (const file of pendingPhotoFiles) {
                    await uploadPhoto(file, 'before');
                  }
                  setPendingPhotoFiles([]);
                  setUploadingMultiple(false);
                  setGalleryRefreshKey(k => k + 1);
                }
              }}
              disabled={photoUploading || uploadingMultiple}
            >
              {uploadingMultiple ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <span className="text-blue-600 mr-2">📷</span>
              )}
              Before
            </Button>
            <Button
              variant="outline"
              className="h-14 text-base font-medium border-2 hover:border-green-500 hover:bg-green-50"
              onClick={async () => {
                if (pendingPhotoFiles.length > 0) {
                  setUploadingMultiple(true);
                  setShowPhotoTypePicker(false);
                  for (const file of pendingPhotoFiles) {
                    await uploadPhoto(file, 'after');
                  }
                  setPendingPhotoFiles([]);
                  setUploadingMultiple(false);
                  setGalleryRefreshKey(k => k + 1);
                }
              }}
              disabled={photoUploading || uploadingMultiple}
            >
              {uploadingMultiple ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <span className="text-green-600 mr-2">✅</span>
              )}
              After
            </Button>
          </div>
          {pendingPhotoFiles.length > 0 && (
            <p className="text-xs text-muted-foreground text-center mt-2">
              {pendingPhotoFiles.length} photo{pendingPhotoFiles.length > 1 ? 's' : ''} selected
            </p>
          )}
        </DialogContent>
      </Dialog>

      {/* Expanded Photo Gallery with delete support */}
      <ExpandedPhotoGallery
        leadId={lead.id}
        isOnline={isOnline}
        open={showExpandedGallery}
        onOpenChange={setShowExpandedGallery}
        onDeletePhoto={deletePhoto}
        refreshKey={galleryRefreshKey}
      />

      {/* Lead Time Edit Dialog */}
      <LeadTimeEditDialog
        open={showTimeEditDialog}
        onOpenChange={setShowTimeEditDialog}
        lead={lead}
        onSaved={() => onLeadUpdated?.()}
      />

      {/* Inline Invoice Creation Dialog */}
      {currentUserId && (
        <CreateInvoiceDialog
          open={showInlineInvoice}
          onClose={() => setShowInlineInvoice(false)}
          agentId={currentUserId}
          prefillLead={{
            id: lead.id,
            customer_name: lead.customer_name,
            customer_phone: lead.customer_phone,
            customer_address: lead.customer_address,
            customer_id: lead.customer_id,
            service_type: lead.service_type,
          }}
        />
      )}
      <QuickTemplateDialog
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        leadId={lead.id}
        customerId={templateCustomerId}
        quoteName={`${lead.service_type || "Quote"} - ${lead.customer_name}`}
      />
      <AcceptLeadDialog
        lead={lead ? {
          id: lead.id,
          customer_id: lead.customer_id,
          customer_name: lead.customer_name,
          customer_address: lead.customer_address,
          service_type: lead.service_type,
          latitude: lead.latitude,
          longitude: lead.longitude,
          priority: lead.priority,
          notes: lead.notes,
        } : null}
        open={showAcceptDialog}
        onOpenChange={setShowAcceptDialog}
        onDone={() => {
          onLeadUpdated?.();
          onClose();
        }}
      />
    </>
  );
};

export default LeadDetailSheet;