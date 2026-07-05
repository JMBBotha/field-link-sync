import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Plus, Loader2 } from "lucide-react";
import LocationPicker from "@/components/LocationPicker";
import { geocodeAddress } from "@/lib/geocodeAddress";

const client = supabase as any;

export interface LocationSelectorValue {
  locationId: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  label?: string;
}

interface Props {
  customerId: string | null;
  companyId: string | null;
  value: LocationSelectorValue;
  onChange: (v: LocationSelectorValue) => void;
  compact?: boolean;
}

const LocationSelector = ({ customerId, companyId, value, onChange, compact }: Props) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: locations = [] } = useQuery({
    queryKey: ["customer-locations", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data } = await client
        .from("customer_locations")
        .select("id,label,address,latitude,longitude,is_primary")
        .eq("customer_id", customerId!)
        .order("is_primary", { ascending: false });
      return data || [];
    },
  });

  const pick = (id: string) => {
    const loc = locations.find((l: any) => l.id === id);
    if (!loc) return;
    onChange({
      locationId: loc.id,
      address: loc.address || "",
      latitude: loc.latitude != null ? Number(loc.latitude) : null,
      longitude: loc.longitude != null ? Number(loc.longitude) : null,
      label: loc.label,
    });
  };

  const addNew = async () => {
    if (!customerId || !companyId || !newLabel || !newAddress) {
      toast({ title: "Label and address required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const geo = await geocodeAddress(newAddress);
      const payload = {
        customer_id: customerId,
        company_id: companyId,
        label: newLabel,
        address: newAddress,
        latitude: geo?.latitude ?? null,
        longitude: geo?.longitude ?? null,
        is_primary: locations.length === 0,
      };
      const { data, error } = await client.from("customer_locations").insert(payload).select("*").single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["customer-locations", customerId] });
      onChange({
        locationId: data.id,
        address: data.address,
        latitude: data.latitude != null ? Number(data.latitude) : null,
        longitude: data.longitude != null ? Number(data.longitude) : null,
        label: data.label,
      });
      toast({ title: "Location added" });
      setShowAdd(false);
      setNewLabel(""); setNewAddress("");
    } catch (e: any) {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!customerId) {
    return <p className="text-xs text-muted-foreground italic">Select a customer to choose a location.</p>;
  }

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex items-center justify-between">
        <Label className="text-xs flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" /> Location
        </Label>
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="h-3 w-3" /> {showAdd ? "Cancel" : "New"}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowPicker((v) => !v)}>
            {showPicker ? "Hide map" : "Show map"}
          </Button>
        </div>
      </div>

      {locations.length > 0 && (
        <Select value={value.locationId || ""} onValueChange={pick}>
          <SelectTrigger><SelectValue placeholder="Choose a saved location" /></SelectTrigger>
          <SelectContent>
            {locations.map((l: any) => (
              <SelectItem key={l.id} value={l.id}>
                {l.label}{l.is_primary ? " ⭐" : ""} — {l.address}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}


      {showAdd && (
        <div className="rounded-md border p-3 space-y-2 bg-muted/30">
          <Input placeholder="Label (Main House, Office…)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <Input placeholder="Full address" value={newAddress} onChange={(e) => setNewAddress(e.target.value)} />
          <div className="flex justify-end">
            <Button size="sm" onClick={addNew} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save location
            </Button>
          </div>
        </div>
      )}

      {showPicker && (
        <LocationPicker
          latitude={value.latitude}
          longitude={value.longitude}
          onLocationChange={(la, ln, addr) => {
            onChange({ ...value, latitude: la, longitude: ln, address: addr || value.address });
          }}
        />
      )}
    </div>
  );
};

export default LocationSelector;
