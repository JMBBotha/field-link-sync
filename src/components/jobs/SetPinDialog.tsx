import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import LocationPicker from "@/components/LocationPicker";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { coordsFromText, storedPin } from "@/lib/mapPin";

/**
 * Set the exact map pin on a booking (Johan t2045u). Drag the pin, search, GPS, or use coordinates from the notes.
 * Saves lat/lng only (set_booking_pin: same rights as booking edit, logged to audit_log). The address is never
 * overwritten automatically; an admin may confirm the suggested address with one extra tap.
 */
export default function SetPinDialog({ open, onClose, leadId, lat, lng, notes, address, canSetAddress, onSaved }: {
  open: boolean; onClose: () => void; leadId: string; lat?: number | string | null; lng?: number | string | null;
  notes?: string | null; address?: string | null; canSetAddress?: boolean; onSaved: () => void;
}) {
  const start = storedPin(lat, lng);
  const fromNotes = coordsFromText(notes);
  const [pin, setPin] = useState(start);
  const [suggest, setSuggest] = useState<string | null>(null);
  const [useAddr, setUseAddr] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!pin) return;
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)("set_booking_pin", { p_lead: leadId, p_lat: pin.lat, p_lng: pin.lng });
      if (error) throw error;
      if (useAddr && suggest && canSetAddress) {
        const { error: e2 } = await (supabase.rpc as any)("update_booking_details", { p_lead: leadId, p_address: suggest });
        if (e2) throw e2;
      }
      toast({ title: "Pin saved", description: "Map now opens the exact spot." });
      onSaved(); onClose();
    } catch (e: any) {
      toast({ title: e?.message || "Could not save the pin", variant: "destructive" });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg" data-testid="set-pin-dialog">
        <DialogHeader><DialogTitle>Set pin on map</DialogTitle></DialogHeader>
        {fromNotes && (!pin || pin.lat !== fromNotes.lat || pin.lng !== fromNotes.lng) && (
          <Button variant="outline" className="min-h-11 w-full" onClick={() => { setPin(fromNotes); setSuggest(null); }} data-testid="pin-from-notes">
            Use coordinates from notes ({fromNotes.lat.toFixed(5)}, {fromNotes.lng.toFixed(5)})
          </Button>
        )}
        <LocationPicker latitude={pin?.lat ?? null} longitude={pin?.lng ?? null} addressHint={address}
          onLocationChange={(a, b, addr) => { setPin({ lat: a, lng: b }); setSuggest(addr && addr !== address ? addr : null); setUseAddr(false); }} />
        {pin && <p className="text-xs text-muted-foreground">Pin: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>}
        {suggest && canSetAddress && (
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={useAddr} onChange={(e) => setUseAddr(e.target.checked)} data-testid="pin-use-address" />
            <span>Also change the address to “{suggest}”</span></label>
        )}
        <Button className="min-h-11 w-full bg-[#1590D6]" disabled={!pin || busy} onClick={save} data-testid="pin-save">{busy ? "Saving…" : "Save pin"}</Button>
      </DialogContent>
    </Dialog>
  );
}
