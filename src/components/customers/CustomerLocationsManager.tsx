import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, MapPin, Plus, Star, Trash2, Pencil } from "lucide-react";
import LocationPicker from "@/components/LocationPicker";
import { geocodeAddress } from "@/lib/geocodeAddress";

export interface CustomerLocation {
  id: string;
  customer_id: string;
  company_id: string;
  label: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  is_primary: boolean;
}

interface Props {
  customerId: string;
  companyId: string;
}

const client = supabase as any;

const CustomerLocationsManager = ({ customerId, companyId }: Props) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CustomerLocation | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const { data: locations = [], isLoading } = useQuery({
    queryKey: ["customer-locations", customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await client
        .from("customer_locations")
        .select("*")
        .eq("customer_id", customerId)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as CustomerLocation[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await client.from("customer_locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Location deleted" });
      qc.invalidateQueries({ queryKey: ["customer-locations", customerId] });
    },
    onError: (e: any) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const setPrimaryMut = useMutation({
    mutationFn: async (id: string) => {
      await client.from("customer_locations").update({ is_primary: false }).eq("customer_id", customerId);
      const { error } = await client.from("customer_locations").update({ is_primary: true }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Primary location updated" });
      qc.invalidateQueries({ queryKey: ["customer-locations", customerId] });
    },
  });

  const openNew = () => { setEditing(null); setShowDialog(true); };
  const openEdit = (loc: CustomerLocation) => { setEditing(loc); setShowDialog(true); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Locations</h3>
          <p className="text-xs text-muted-foreground">
            Multiple addresses (home, office, rentals). Jobs and quotes can target any of these.
          </p>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1">
          <Plus className="h-4 w-4" /> Add Location
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : locations.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">
          No locations yet. Add one to enable multi-site job dispatch.
        </CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {locations.map((loc) => (
            <Card key={loc.id} className="bg-card">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span className="font-semibold text-sm">{loc.label}</span>
                    {loc.is_primary && (
                      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
                        <Star className="h-3 w-3 mr-0.5" /> Primary
                      </Badge>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {!loc.is_primary && (
                      <Button size="icon" variant="ghost" className="h-7 w-7"
                        onClick={() => setPrimaryMut.mutate(loc.id)} title="Set as primary">
                        <Star className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(loc)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                      onClick={() => { if (confirm(`Delete "${loc.label}"?`)) deleteMut.mutate(loc.id); }}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-sm">{loc.address}</p>
                {loc.notes && <p className="text-xs text-muted-foreground italic">{loc.notes}</p>}
                <p className="text-[11px] text-muted-foreground">
                  {loc.latitude != null && loc.longitude != null
                    ? `📍 ${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`
                    : "⚠️ No coordinates — won't appear on Map"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <LocationDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        customerId={customerId}
        companyId={companyId}
        existing={editing}
        isFirst={locations.length === 0}
        onSaved={() => qc.invalidateQueries({ queryKey: ["customer-locations", customerId] })}
      />
    </div>
  );
};

// ---------- Add/Edit dialog ----------
const LocationDialog = ({
  open, onOpenChange, customerId, companyId, existing, isFirst, onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId: string;
  companyId: string;
  existing: CustomerLocation | null;
  isFirst: boolean;
  onSaved: () => void;
}) => {
  const { toast } = useToast();
  const [label, setLabel] = useState(existing?.label || "Main");
  const [address, setAddress] = useState(existing?.address || "");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [lat, setLat] = useState<number | null>(existing?.latitude ?? null);
  const [lng, setLng] = useState<number | null>(existing?.longitude ?? null);
  const [isPrimary, setIsPrimary] = useState(existing?.is_primary ?? isFirst);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);

  // Reset when opening
  useState(() => {
    if (open) {
      setLabel(existing?.label || "Main");
      setAddress(existing?.address || "");
      setNotes(existing?.notes || "");
      setLat(existing?.latitude ?? null);
      setLng(existing?.longitude ?? null);
      setIsPrimary(existing?.is_primary ?? isFirst);
    }
  });

  const runGeocode = async () => {
    if (!address) return;
    setGeocoding(true);
    const r = await geocodeAddress(address);
    setGeocoding(false);
    if (r) { setLat(r.latitude); setLng(r.longitude); toast({ title: "Address located ✅" }); }
    else toast({ title: "Couldn't locate", description: "Use the map to pin manually.", variant: "destructive" });
  };

  const save = async () => {
    if (!label || !address) {
      toast({ title: "Label and Address are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      let finalLat = lat, finalLng = lng;
      if (finalLat == null || finalLng == null) {
        const r = await geocodeAddress(address);
        if (r) { finalLat = r.latitude; finalLng = r.longitude; }
      }
      const payload: any = {
        customer_id: customerId,
        company_id: companyId,
        label, address, notes: notes || null,
        latitude: finalLat, longitude: finalLng,
        is_primary: isPrimary,
      };
      if (isPrimary) {
        await client.from("customer_locations").update({ is_primary: false }).eq("customer_id", customerId);
      }
      const q = existing
        ? client.from("customer_locations").update(payload).eq("id", existing.id)
        : client.from("customer_locations").insert(payload);
      const { error } = await q;
      if (error) throw error;
      toast({ title: existing ? "Location updated" : "Location added" });
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit Location" : "Add Location"}</DialogTitle>
          <DialogDescription>
            Give this address a memorable label like “Main House”, “Office”, or “Rental Property”.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label className="text-xs">Label *</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main House" />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Address *</Label>
            <div className="flex gap-2">
              <Input value={address} onChange={(e) => { setAddress(e.target.value); setLat(null); setLng(null); }} placeholder="Full street address" />
              <Button type="button" variant="outline" onClick={runGeocode} disabled={geocoding || !address}>
                {geocoding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Locate"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {lat != null && lng != null
                ? `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`
                : "Coordinates will be resolved automatically on save."}
            </p>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Pin on Map</Label>
            <LocationPicker
              latitude={lat}
              longitude={lng}
              onLocationChange={(la, ln, addr) => {
                setLat(la); setLng(ln);
                if (addr && !address) setAddress(addr);
              }}
            />
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Gate code, access instructions, contact on-site…" />
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input id="is_primary" type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            <Label htmlFor="is_primary" className="text-sm cursor-pointer">Set as primary location</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save Changes" : "Add Location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CustomerLocationsManager;
