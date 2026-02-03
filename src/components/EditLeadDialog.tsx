import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Clock, CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import LocationPicker from "./LocationPicker";
import { format, formatDistanceToNow, parseISO } from "date-fns";

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
  priority?: string;
  scheduled_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface EditLeadDialogProps {
  lead: Lead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const EditLeadDialog = ({ lead, open, onOpenChange, onSuccess }: EditLeadDialogProps) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    service_type: "",
    notes: "",
    priority: "medium",
  });
  const [showManualCoords, setShowManualCoords] = useState(false);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const { toast } = useToast();

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

  // Extract local phone number (without +27)
  const extractLocalPhone = (phone: string) => {
    if (!phone) return '';
    return phone.replace(/^\+?27/, '').replace(/^0/, '');
  };

  // Load lead data when dialog opens
  useEffect(() => {
    if (lead && open) {
      setFormData({
        customer_name: lead.customer_name || "",
        customer_phone: extractLocalPhone(lead.customer_phone),
        customer_address: lead.customer_address || "",
        service_type: lead.service_type || "",
        notes: lead.notes || "",
        priority: lead.priority || "medium",
      });
      setLatitude(lead.latitude);
      setLongitude(lead.longitude);
      setScheduledDate(lead.scheduled_date ? parseISO(lead.scheduled_date) : undefined);
    }
  }, [lead, open]);

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
    if (address) {
      setFormData(prev => ({ ...prev, customer_address: address }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !latitude || !longitude) return;

    setLoading(true);

    try {
      const formattedPhone = formatPhoneForWhatsApp(formData.customer_phone);

      const { error } = await supabase
        .from("leads")
        .update({
          customer_name: formData.customer_name,
          customer_phone: formattedPhone,
          customer_address: formData.customer_address,
          service_type: formData.service_type,
          notes: formData.notes,
          priority: formData.priority,
          scheduled_date: scheduledDate ? format(scheduledDate, "yyyy-MM-dd") : null,
          latitude,
          longitude,
        })
        .eq("id", lead.id);

      if (error) throw error;

      toast({
        title: "Lead Updated ✓",
        description: "Changes saved successfully",
      });

      onSuccess?.();
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

  if (!lead) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Lead</DialogTitle>
          <DialogDescription>
            Update lead details
          </DialogDescription>
        </DialogHeader>

        {/* Last Updated Timestamp */}
        {lead.created_at && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border-b pb-3">
            <Clock className="h-3.5 w-3.5" />
            <span>
              Created {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customer_name">Customer Name</Label>
            <Input
              id="customer_name"
              value={formData.customer_name}
              onChange={(e) =>
                setFormData({ ...formData, customer_name: e.target.value })
              }
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_phone">Phone Number (WhatsApp)</Label>
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
          </div>

          <div className="space-y-2">
            <Label>Location & Address</Label>
            <LocationPicker
              latitude={latitude}
              longitude={longitude}
              onLocationChange={handleLocationChange}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="customer_address">Address</Label>
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
              <Label htmlFor="service_type">Service Type</Label>
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

          {/* Scheduled Date */}
          <div className="space-y-2">
            <Label>Scheduled Date (Optional)</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !scheduledDate && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {scheduledDate ? format(scheduledDate, "PPP") : "Select a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={scheduledDate}
                  onSelect={setScheduledDate}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
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
              {showManualCoords ? 'Hide' : 'Edit'} coordinates manually
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
              Save Changes
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditLeadDialog;
