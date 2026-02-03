import { useState, useRef } from "react";
import { X, Phone, MapPin, Clock, Navigation, Loader2, AlertCircle, Pencil, Camera, ClockIcon, Images, Plus } from "lucide-react";
import { useJobPhotos, PhotoType } from "@/hooks/useJobPhotos";
import { useOffline } from "@/contexts/OfflineContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import InvoiceForm from "./InvoiceForm";
import JobCompletionFlow from "./JobCompletionFlow";
import CustomerProfile from "./CustomerProfile";
import EditLeadDialog from "./EditLeadDialog";
import JobDurationPicker from "./JobDurationPicker";
import JobProgressSection from "./JobProgressSection";
import { PhotoGallery } from "./PhotoGallery";
import { ExpandedPhotoGallery } from "./ExpandedPhotoGallery";
import AgentChangeRequestDialog from "./AgentChangeRequestDialog";
import LeadTimeEditDialog from "./LeadTimeEditDialog";
import { JobScheduleDisplay } from "./JobScheduleDisplay";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSingleLeadPhotoCount } from "@/hooks/useLeadPhotoCount";

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
  onRelease: (leadId: string) => Promise<void>;
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
  const [showCustomerProfile, setShowCustomerProfile] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showDurationPicker, setShowDurationPicker] = useState(false);
  const [showChangeRequestDialog, setShowChangeRequestDialog] = useState(false);
  const [showTimeEditDialog, setShowTimeEditDialog] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [showPhotoTypePicker, setShowPhotoTypePicker] = useState(false);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([]);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
  const [uploadingMultiple, setUploadingMultiple] = useState(false);
  const [showExpandedGallery, setShowExpandedGallery] = useState(false);
  const { toast } = useToast();
  const { isOnline, queueOperation: contextQueueOp } = useOffline();
  
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
    // If customer has equipment, show equipment flow first
    if (lead.customer_id) {
      setShowCompletionFlow(true);
    } else {
      // No customer linked, go straight to invoice
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
          className="max-h-[85vh] bg-card/80 backdrop-blur-lg flex flex-col p-0 border-border/50 shadow-2xl"
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

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-3 px-4 pb-4">
            {/* Job Progress Section for in-progress jobs */}
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

            {/* Notes */}
            {lead.notes && (
              <div className="p-2.5 rounded-xl bg-background/50">
                <p className="text-[10px] text-muted-foreground mb-0.5">Notes</p>
                <p className="text-xs">{lead.notes}</p>
              </div>
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

            {/* Photo Gallery - Prominent inline section */}
            <div className="p-2.5 rounded-xl bg-background/50 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Images className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">Photos</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 text-[10px] px-1.5 text-primary"
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

            {/* Time */}
            {lead.created_at && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>Created {formatTimeAgo(lead.created_at)}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
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
              <div className="grid grid-cols-3 gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-lg text-xs px-2"
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

                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg text-xs px-2"
                    onClick={() => setShowEditDialog(true)}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>
                )}

                {isOwner && (isClaimed || isInProgress || isCompleted) && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 rounded-lg text-xs px-2"
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
                  onClick={() => onAccept(lead.id)}
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
            </div>
            </div>
          </ScrollArea>
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

      {/* Edit Lead Dialog */}
      <EditLeadDialog
        lead={lead}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        onSuccess={onLeadUpdated}
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
    </>
  );
};

export default LeadDetailSheet;