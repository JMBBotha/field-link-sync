import { useState, useRef } from "react";
import { X, Phone, MapPin, Clock, Navigation, Loader2, AlertCircle, Pencil, Camera, ImageIcon, ClockIcon } from "lucide-react";
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
import AgentChangeRequestDialog from "./AgentChangeRequestDialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

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
  // New duration tracking fields
  estimated_duration_minutes?: number | null;
  estimated_end_time?: string | null;
  actual_start_time?: string | null;
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
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<string | null>(null);
  const [showPhotoTypePicker, setShowPhotoTypePicker] = useState(false);
  const [pendingPhotoFile, setPendingPhotoFile] = useState<File | null>(null);
  const [galleryRefreshKey, setGalleryRefreshKey] = useState(0);
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
          className="h-[85vh] max-h-[85vh] rounded-t-2xl border-t bg-card/55 backdrop-blur-md flex flex-col p-0"
          hideCloseButton
        >
          {/* Swipe Handle */}
          <div className="flex justify-center pt-2 pb-3 shrink-0 px-6">
            <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
          </div>

          <SheetHeader className="px-6 pb-4 shrink-0">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <SheetTitle className="text-xl font-bold text-left">
                  {lead.customer_name}
                </SheetTitle>
                <p className="text-sm text-muted-foreground mt-0.5">{lead.service_type}</p>
                {getPriorityIndicator(lead.priority)}
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(lead.status)}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={onClose}
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-4 px-6 pb-6">
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

            {/* Phone */}
            <a
              href={`tel:${lead.customer_phone}`}
              className="flex items-center gap-3 p-3 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
            >
              <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                <Phone className="h-5 w-5 text-[#0077B6]" />
              </div>
              <div>
                <p className="text-sm font-medium">{lead.customer_phone}</p>
                <p className="text-xs text-muted-foreground">Tap to call</p>
              </div>
            </a>

            {/* Address */}
            <a
              href={addressSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 p-3 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
            >
              <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                <MapPin className="h-5 w-5 text-[#0077B6]" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium line-clamp-2">{lead.customer_address}</p>
                <p className="text-xs text-muted-foreground">Tap to view on map</p>
              </div>
            </a>

            {/* Notes */}
            {lead.notes && (
              <div className="p-3 rounded-xl bg-background/50">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{lead.notes}</p>
              </div>
            )}

            {/* Photo Gallery - show for all leads */}
            <div className="p-3 rounded-xl bg-background/50">
              <PhotoGallery 
                leadId={lead.id} 
                isOnline={isOnline} 
                onDeletePhoto={deletePhoto}
                deleting={photoDeleting}
                refreshKey={galleryRefreshKey}
              />
            </div>

            {/* Time */}
            {lead.created_at && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Created {formatTimeAgo(lead.created_at)}</span>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {/* Photo upload - available for all lead stages */}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setPendingPhotoFile(file);
                    setShowPhotoTypePicker(true);
                    e.target.value = '';
                  }
                }}
              />
              <Button
                variant="outline"
                className="w-full h-10 rounded-full"
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
              >
                {photoUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Compressing...
                  </>
                ) : (
                  <>
                    <Camera className="h-4 w-4 mr-2" />
                    Add Photo
                    {photoPendingCount > 0 && (
                      <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-600 px-2 py-0.5 rounded-full">
                        {photoPendingCount} queued
                      </span>
                    )}
                  </>
                )}
              </Button>

              {/* Edit button for assigned leads */}
              {canEdit && (
                <Button
                  variant="outline"
                  className="w-full h-10 rounded-full"
                  onClick={() => setShowEditDialog(true)}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit Details
                </Button>
              )}

              {/* Request Time Change button for field agents on accepted/in_progress/completed leads */}
              {isOwner && (isClaimed || isInProgress || isCompleted) && (
                <Button
                  variant="outline"
                  className="w-full h-10 rounded-full"
                  onClick={() => setShowChangeRequestDialog(true)}
                >
                  <ClockIcon className="h-4 w-4 mr-2" />
                  Request Time Change
                </Button>
              )}

              {/* Available leads - show Accept button */}
              {isAvailable && (
                <Button
                  className="w-full h-12 rounded-full text-base font-semibold"
                  style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                  onClick={() => onAccept(lead.id)}
                  disabled={!!loadingAction}
                >
                  {loadingAction === 'accept' ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Accepting...
                    </>
                  ) : (
                    "Accept Lead"
                  )}
                </Button>
              )}

              {/* Claimed leads - show Start Job + Release buttons */}
              {isClaimed && (
                <>
                  <Button
                    className="w-full h-12 rounded-full text-base font-semibold"
                    style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
                    onClick={handleStartJobClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'start' ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      "Start Job"
                    )}
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 h-10 rounded-full"
                      onClick={() => onRelease(lead.id)}
                      disabled={!!loadingAction}
                    >
                      {loadingAction === 'release' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Releasing...
                        </>
                      ) : (
                        "Release Lead"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 px-4 rounded-full"
                      onClick={() => window.open(navigationUrl, '_blank', 'noopener,noreferrer')}
                    >
                      <Navigation className="h-4 w-4 mr-2" />
                      Navigate
                    </Button>
                  </div>
                </>
              )}

              {/* In Progress leads - show Complete + Release buttons */}
              {isInProgress && (
                <>
                  <Button
                    className="w-full h-12 rounded-full text-base font-semibold bg-green-600 hover:bg-green-700"
                    onClick={handleCompleteClick}
                    disabled={!!loadingAction}
                  >
                    {loadingAction === 'complete' ? (
                      <>
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                        Completing...
                      </>
                    ) : (
                      "Complete Job"
                    )}
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1 h-10 rounded-full"
                      onClick={() => onRelease(lead.id)}
                      disabled={!!loadingAction}
                    >
                      {loadingAction === 'release' ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Releasing...
                        </>
                      ) : (
                        "Release Lead"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 px-4 rounded-full"
                      onClick={() => window.open(navigationUrl, '_blank', 'noopener,noreferrer')}
                    >
                      <Navigation className="h-4 w-4 mr-2" />
                      Navigate
                    </Button>
                  </div>
                </>
              )}

              {/* Completed leads - just show navigation */}
              {isCompleted && (
                <Button
                  variant="outline"
                  className="w-full h-10 rounded-full"
                  onClick={() => window.open(navigationUrl, '_blank', 'noopener,noreferrer')}
                >
                  <Navigation className="h-4 w-4 mr-2" />
                  Navigate to Location
                </Button>
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

      {/* Photo Type Picker */}
      <Dialog open={showPhotoTypePicker} onOpenChange={setShowPhotoTypePicker}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-center">Photo Type</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 pt-2">
            <Button
              variant="outline"
              className="h-14 text-base font-medium border-2 hover:border-blue-500 hover:bg-blue-50"
              onClick={async () => {
                if (pendingPhotoFile) {
                  setShowPhotoTypePicker(false);
                  await uploadPhoto(pendingPhotoFile, 'before');
                  setPendingPhotoFile(null);
                  setGalleryRefreshKey(k => k + 1);
                }
              }}
              disabled={photoUploading}
            >
              <span className="text-blue-600 mr-2">📷</span>
              Before
            </Button>
            <Button
              variant="outline"
              className="h-14 text-base font-medium border-2 hover:border-green-500 hover:bg-green-50"
              onClick={async () => {
                if (pendingPhotoFile) {
                  setShowPhotoTypePicker(false);
                  await uploadPhoto(pendingPhotoFile, 'after');
                  setPendingPhotoFile(null);
                  setGalleryRefreshKey(k => k + 1);
                }
              }}
              disabled={photoUploading}
            >
              <span className="text-green-600 mr-2">✅</span>
              After
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default LeadDetailSheet;