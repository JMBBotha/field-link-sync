import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getUserCompanyId } from "@/lib/tenantUtils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Users, MapPin, Radio, CalendarIcon, UserCheck, UserPlus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import LocationPicker from "./LocationPicker";
import { useNearbyAgents } from "@/hooks/useNearbyAgents";
import { useBroadcastSettings } from "@/hooks/useBroadcastSettings";
import { getBroadcastRadiusForType, formatDistance } from "@/lib/geolocation";
import { findCustomerMatch, type CustomerMatch } from "@/lib/customerMatch";
import { laneFromServiceType, leadLaneFields, LANE_META, type LeadLane } from "@/lib/leadLane";
import { useLaneStaff } from "@/hooks/useLaneStaff";

interface CreateLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface NearbyAgent {
  agent_id: string;
  full_name: string;
  distance_km: number;
  is_available: boolean;
}

const CreateLeadDialog = ({ open, onOpenChange }: CreateLeadDialogProps) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    service_type: "",
    notes: "",
    priority: "medium",
  });
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState<string>("");
  const [showManualCoords, setShowManualCoords] = useState(false);

  // Format phone for WhatsApp (SA format)
  const formatPhoneForWhatsApp = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) {
      return '+27' + digits.slice(1);
    }
    if (digits.startsWith('27')) {
      return '+' + digits;
    }
    return '+27' + digits;
  };
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [customRadius, setCustomRadius] = useState<number | null>(null);
  const [nearbyAgents, setNearbyAgents] = useState<NearbyAgent[]>([]);
  const [customerMatch, setCustomerMatch] = useState<CustomerMatch | null>(null);
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  const [matchDismissed, setMatchDismissed] = useState(false);
  const [laneOverride, setLaneOverride] = useState<LeadLane | "unknown" | null>(null);
  const [salesOwnerId, setSalesOwnerId] = useState<string>("");
  const { toast } = useToast();
  const { findNearbyAgents, loading: loadingAgents } = useNearbyAgents();
  const { settings: broadcastSettings } = useBroadcastSettings();
  const { salesStaff } = useLaneStaff();

  // Lane: derived from the service type, dispatcher can override
  const derivedLane = laneFromServiceType(formData.service_type);
  const lane: LeadLane | null =
    laneOverride === null ? derivedLane : laneOverride === "unknown" ? null : laneOverride;

  // Only service leads get a geofenced first-accept broadcast
  const canBroadcast = lane === "service";

  // Calculate effective radius based on service type
  const effectiveRadius = customRadius ?? getBroadcastRadiusForType(formData.service_type, broadcastSettings);


  // Fetch nearby agents when location or radius changes
  useEffect(() => {
    const fetchAgents = async () => {
      if (latitude && longitude && effectiveRadius) {
        const agents = await findNearbyAgents(latitude, longitude, effectiveRadius);
        setNearbyAgents(agents);
      } else {
        setNearbyAgents([]);
      }
    };
    fetchAgents();
  }, [latitude, longitude, effectiveRadius, findNearbyAgents]);

  // Debounced customer dedup lookup by phone
  useEffect(() => {
    if (linkedCustomerId || matchDismissed) return;
    const phone = formData.customer_phone.trim();
    if (phone.length < 7) {
      setCustomerMatch(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      const companyId = await getUserCompanyId(user?.id);
      if (!companyId || cancelled) return;
      const match = await findCustomerMatch(companyId, phone, null);
      if (!cancelled) setCustomerMatch(match);
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [formData.customer_phone, user?.id, linkedCustomerId, matchDismissed]);

  const isFormValid =
    formData.customer_name.trim() !== "" &&
    formData.customer_phone.trim() !== "" &&
    formData.customer_address.trim() !== "" &&
    formData.service_type.trim() !== "" &&
    latitude !== null &&
    longitude !== null;

  const handleLocationChange = (lat: number, lng: number, address?: string) => {
    setLatitude(lat);
    setLongitude(lng);
    // Auto-fill address if provided from geocoder
    if (address) {
      setFormData(prev => ({ ...prev, customer_address: address }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!latitude || !longitude) return;
    
    setLoading(true);

    try {
      // Format phone number for WhatsApp
      const formattedPhone = formatPhoneForWhatsApp(formData.customer_phone);
      
      const company_id = await getUserCompanyId(user?.id);
      const { error } = await supabase.from("leads").insert({
        customer_name: formData.customer_name,
        customer_phone: formattedPhone,
        customer_address: formData.customer_address,
        service_type: formData.service_type,
        notes: formData.notes,
        priority: formData.priority,
        latitude,
        longitude,
        broadcast_radius_km: canBroadcast ? customRadius : null,
        scheduled_date: scheduledDate ? format(scheduledDate, "yyyy-MM-dd") : null,
        scheduled_time: scheduledTime || null,
        status: "pending",
        company_id,
        customer_id: linkedCustomerId,
        assigned_agent_id: lane === "sales" && salesOwnerId ? salesOwnerId : null,
        ...leadLaneFields(lane),
      });

      if (error) throw error;

      toast({
        title: "Lead Created 🎉",
        description:
          lane === "sales"
            ? salesOwnerId
              ? `Sales lead assigned to ${salesStaff.find(s => s.id === salesOwnerId)?.full_name ?? "sales"}`
              : "Sales lead created — pick a salesperson in the dispatch inbox"
            : lane === "service"
              ? nearbyAgents.length > 0
                ? `Notifying ${nearbyAgents.length} technician${nearbyAgents.length > 1 ? "s" : ""} within ${effectiveRadius}km`
                : "Service lead created - no technicians in range"
              : "Lead created — needs a human to pick sales or service",
      });


      setFormData({
        customer_name: "",
        customer_phone: "",
        customer_address: "",
        service_type: "",
        notes: "",
        priority: "medium",
      });
      setLatitude(null);
      setLongitude(null);
      setCustomRadius(null);
      setScheduledDate(undefined);
      setScheduledTime("");
      setNearbyAgents([]);
      setCustomerMatch(null);
      setLinkedCustomerId(null);
      setMatchDismissed(false);
      setLaneOverride(null);
      setSalesOwnerId("");


      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Lead</DialogTitle>
          <DialogDescription>
            Add a new customer lead for field agents
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer_name">
              Customer Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="customer_name"
              value={formData.customer_name}
              onChange={(e) =>
                setFormData({ ...formData, customer_name: e.target.value })
              }
              required
              placeholder="Full name"
            />
            {formData.customer_name === "" && (
              <p className="text-[11px] text-muted-foreground">Required – enter the customer's full name</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_phone">
              Phone Number (WhatsApp) <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                +27
              </span>
              <Input
                id="customer_phone"
                type="tel"
                className="pl-12"
                placeholder="82 123 4567"
                value={formData.customer_phone}
                onChange={(e) => {
                  // Strip +27 or leading 0 if user pastes full number
                  let value = e.target.value.replace(/^\+?27/, '').replace(/^0/, '');
                  setFormData({ ...formData, customer_phone: value });
                }}
                required
              />
            </div>
            {formData.customer_phone && (
              <p className="text-xs text-muted-foreground">
                WhatsApp: {formatPhoneForWhatsApp(formData.customer_phone)}
              </p>
            )}

            {/* Customer dedup prompt */}
            {linkedCustomerId && customerMatch ? (
              <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs">
                <UserCheck className="h-4 w-4 text-primary shrink-0" />
                <span className="flex-1">
                  Linked to <strong>{customerMatch.name || "existing customer"}</strong>
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline font-medium"
                  onClick={() => {
                    setLinkedCustomerId(null);
                    setMatchDismissed(true);
                  }}
                >
                  Unlink
                </button>
              </div>
            ) : customerMatch && !matchDismissed ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2">
                <div className="flex items-start gap-2 text-xs">
                  <UserCheck className="h-4 w-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">
                      Possible match: {customerMatch.name || "Existing customer"}
                    </p>
                    <p className="text-muted-foreground truncate">
                      {customerMatch.phone}
                      {customerMatch.email ? ` · ${customerMatch.email}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="default"
                    className="h-8 text-xs flex-1"
                    onClick={() => {
                      setLinkedCustomerId(customerMatch.id);
                      if (customerMatch.name && !formData.customer_name.trim()) {
                        setFormData((p) => ({ ...p, customer_name: customerMatch.name! }));
                      }
                    }}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Link existing
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs flex-1"
                    onClick={() => setMatchDismissed(true)}
                  >
                    <UserPlus className="h-3.5 w-3.5 mr-1" />
                    Create new
                  </Button>
                </div>
              </div>
            ) : null}
          </div>


          <div className="space-y-2">
            <Label>
              Location & Address <span className="text-destructive">*</span>
            </Label>
            <LocationPicker
              latitude={latitude}
              longitude={longitude}
              onLocationChange={handleLocationChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_address">
              Address <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="customer_address"
              placeholder="Address will auto-fill when you search, or enter manually"
              value={formData.customer_address}
              onChange={(e) =>
                setFormData({ ...formData, customer_address: e.target.value })
              }
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="service_type">
                Service Type <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.service_type}
                onValueChange={(value) =>
                  setFormData({ ...formData, service_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Sales/Consultation">Sales/Consultation</SelectItem>
                  <SelectItem value="Technical/Repairs">Technical/Repairs</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

          {/* Lane: Sales vs Service */}
          <div className="space-y-2">
            <Label>
              Lane <span className="text-destructive">*</span>
            </Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "sales" as const, label: "Sales" },
                { key: "service" as const, label: "Service" },
                { key: "unknown" as const, label: "Not sure" },
              ]).map(opt => {
                const active =
                  opt.key === "unknown" ? lane === null : lane === opt.key;
                return (
                  <Button
                    key={opt.key}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    className="h-9"
                    onClick={() => setLaneOverride(opt.key)}
                  >
                    {opt.label}
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {lane === "sales"
                ? "Sales lead — assigned to a named salesperson, no first-accept race."
                : lane === "service"
                  ? "Service lead — broadcast to nearby technicians, first accept wins."
                  : "Lane unknown — this lead stays in the inbox and will not be broadcast."}
            </p>
          </div>

          {/* Sales owner picker */}
          {lane === "sales" && (
            <div className="space-y-2">
              <Label>Salesperson (optional)</Label>
              <Select value={salesOwnerId} onValueChange={setSalesOwnerId}>
                <SelectTrigger>
                  <SelectValue placeholder={salesStaff.length ? "Assign to…" : "No sales-lane people yet"} />
                </SelectTrigger>
                <SelectContent>
                  {salesStaff.map(s => (
                    <SelectItem key={s.id} value={s.id}>{s.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Tag people as Sales on the Team page to grow this list.
              </p>
            </div>
          )}


            <div className="space-y-2">
              <Label htmlFor="priority">Priority</Label>
              <Select
                value={formData.priority}
                onValueChange={(value) =>
                  setFormData({ ...formData, priority: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-destructive" />
                      High
                    </span>
                  </SelectItem>
                  <SelectItem value="medium">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-orange-500" />
                      Medium
                    </span>
                  </SelectItem>
                  <SelectItem value="low">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                      Low
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Scheduled Date & Time */}
          <div className="space-y-2">
            <Label>Scheduled Date & Time (Optional)</Label>
            <div className="flex gap-2">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "flex-1 justify-start text-left font-normal",
                      !scheduledDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {scheduledDate ? format(scheduledDate, "d MMM yyyy") : "Date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={scheduledDate}
                    onSelect={setScheduledDate}
                    initialFocus
                    disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                  />
                </PopoverContent>
              </Popover>
              <Input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="w-28"
                placeholder="Time"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Issue Description (Optional)</Label>
            <Textarea
              id="notes"
              placeholder="Describe the customer's issue or service request..."
              value={formData.notes}
              onChange={(e) =>
                setFormData({ ...formData, notes: e.target.value })
              }
              rows={3}
            />
          </div>

          {/* Manual Coordinates (collapsible) */}
          <div className="space-y-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary underline"
              onClick={() => setShowManualCoords(!showManualCoords)}
            >
              {showManualCoords ? 'Hide' : 'Enter'} coordinates manually
            </button>
            {showManualCoords && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="latitude" className="text-xs">Latitude</Label>
                  <Input
                    id="latitude"
                    type="number"
                    step="any"
                    placeholder="-33.9249"
                    value={latitude ?? ''}
                    onChange={(e) => setLatitude(e.target.value ? parseFloat(e.target.value) : null)}
                  />
                </div>
                <div>
                  <Label htmlFor="longitude" className="text-xs">Longitude</Label>
                  <Input
                    id="longitude"
                    type="number"
                    step="any"
                    placeholder="18.4241"
                    value={longitude ?? ''}
                    onChange={(e) => setLongitude(e.target.value ? parseFloat(e.target.value) : null)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Broadcast Radius Preview */}
          {latitude && longitude && (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">Broadcast Radius</span>
                </div>
                <Badge variant="outline" className="text-xs">
                  {effectiveRadius}km
                </Badge>
              </div>
              
              <div className="flex items-center gap-4">
                <Slider
                  value={[customRadius ?? effectiveRadius]}
                  onValueChange={([value]) => setCustomRadius(value)}
                  min={5}
                  max={100}
                  step={5}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setCustomRadius(null)}
                >
                  Reset
                </Button>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {loadingAgents ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <span>
                      {nearbyAgents.length} agent{nearbyAgents.length !== 1 ? 's' : ''} in range
                    </span>
                  )}
                </div>
                {nearbyAgents.length > 0 && (
                  <span className="text-primary">
                    Closest: {formatDistance(nearbyAgents[0].distance_km)}
                  </span>
                )}
              </div>

              {nearbyAgents.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {nearbyAgents.slice(0, 5).map((agent) => (
                    <Badge 
                      key={agent.agent_id} 
                      variant="secondary" 
                      className="text-xs"
                    >
                      <MapPin className="h-2.5 w-2.5 mr-1" />
                      {agent.full_name} ({formatDistance(agent.distance_km)})
                    </Badge>
                  ))}
                  {nearbyAgents.length > 5 && (
                    <Badge variant="outline" className="text-xs">
                      +{nearbyAgents.length - 5} more
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !isFormValid} className="flex-1">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Lead
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateLeadDialog;