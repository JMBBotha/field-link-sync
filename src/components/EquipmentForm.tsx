import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface EquipmentFormProps {
  customerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingEquipment?: any;
}

const equipmentTypes = [
  { value: "ac", label: "Air Conditioner" },
  { value: "heater", label: "Heater" },
  { value: "vent", label: "Ventilation" },
  { value: "heat_pump", label: "Heat Pump" },
  { value: "furnace", label: "Furnace" },
  { value: "other", label: "Other" },
];

const EquipmentForm = ({ customerId, open, onClose, onSuccess, existingEquipment }: EquipmentFormProps) => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState(existingEquipment?.type || "ac");
  const [brand, setBrand] = useState(existingEquipment?.brand || "");
  const [model, setModel] = useState(existingEquipment?.model || "");
  const [serialNumber, setSerialNumber] = useState(existingEquipment?.serial_number || "");
  const [installDate, setInstallDate] = useState<Date | undefined>(
    existingEquipment?.install_date ? new Date(existingEquipment.install_date) : undefined
  );
  const [warrantyExpiry, setWarrantyExpiry] = useState<Date | undefined>(
    existingEquipment?.warranty_expiry ? new Date(existingEquipment.warranty_expiry) : undefined
  );
  const [location, setLocation] = useState(existingEquipment?.location || "");
  const [notes, setNotes] = useState(existingEquipment?.notes || "");

  const handleSubmit = async () => {
    if (!brand.trim()) {
      toast({
        title: "Error",
        description: "Please enter a brand",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    const equipmentData = {
      customer_id: customerId,
      type,
      brand: brand.trim(),
      model: model.trim() || null,
      serial_number: serialNumber.trim() || null,
      install_date: installDate ? format(installDate, "yyyy-MM-dd") : null,
      warranty_expiry: warrantyExpiry ? format(warrantyExpiry, "yyyy-MM-dd") : null,
      location: location.trim() || null,
      notes: notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error;

    if (existingEquipment?.id) {
      const { error: updateError } = await supabase
        .from("equipment" as "leads")
        .update(equipmentData as any)
        .eq("id", existingEquipment.id);
      error = updateError;
    } else {
      const { error: insertError } = await supabase
        .from("equipment" as "leads")
        .insert([equipmentData] as any);
      error = insertError;
    }

    setLoading(false);

    if (error) {
      console.error("Equipment save error:", error);
      toast({
        title: "Error",
        description: "Failed to save equipment",
        variant: "destructive",
      });
    } else {
      toast({
        title: existingEquipment ? "Equipment Updated! ✅" : "Equipment Added! 🎉",
        description: `${brand} ${model || type} saved successfully`,
      });
      onSuccess();
      onClose();
    }
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <SheetContent 
        side="bottom" 
        className="h-[85vh] rounded-t-2xl border-t bg-card/95 backdrop-blur-md overflow-hidden flex flex-col"
      >
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
        </div>

        <SheetHeader className="px-1 pb-2 flex-shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-lg font-bold">
              {existingEquipment ? "Edit Equipment" : "Add Equipment"}
            </SheetTitle>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-1 pb-4 space-y-4">
          {/* Type */}
          <div>
            <Label className="text-sm">Equipment Type *</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {equipmentTypes.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Brand & Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Brand *</Label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="e.g. Carrier, Daikin"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm">Model</Label>
              <Input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Model number"
                className="mt-1"
              />
            </div>
          </div>

          {/* Serial Number */}
          <div>
            <Label className="text-sm">Serial Number</Label>
            <Input
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="Serial/ID number"
              className="mt-1"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Install Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full mt-1 justify-start text-left font-normal",
                      !installDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {installDate ? format(installDate, "PP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={installDate}
                    onSelect={setInstallDate}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label className="text-sm">Warranty Expiry</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full mt-1 justify-start text-left font-normal",
                      !warrantyExpiry && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {warrantyExpiry ? format(warrantyExpiry, "PP") : "Select date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={warrantyExpiry}
                    onSelect={setWarrantyExpiry}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Location */}
          <div>
            <Label className="text-sm">Location in Building</Label>
            <Input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Master Bedroom, Roof, Office"
              className="mt-1"
            />
          </div>

          {/* Notes */}
          <div>
            <Label className="text-sm">Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional notes about this unit..."
              rows={3}
              className="mt-1 resize-none"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex-shrink-0 border-t pt-3 pb-2 px-1">
          <Button
            className="w-full h-11 rounded-full font-semibold"
            style={{ backgroundColor: '#0077B6', color: '#FFFFFF' }}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : existingEquipment ? (
              "Update Equipment"
            ) : (
              "Add Equipment"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default EquipmentForm;