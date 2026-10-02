import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSaveOnUnmount } from "@/hooks/useSaveOnUnmount";
import { Check, Loader2, MapPin, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getMapboxToken, getMapboxTokenSync } from "@/lib/mapboxToken";
import { hasValidCoords } from "@/lib/leadCoords";
import type { LocationChangeSource } from "@/components/LocationPicker";

// Mapbox GL is heavy: only load it when someone actually edits an address.
const LocationPicker = lazy(() => import("@/components/LocationPicker"));

type Pin = { lat: number; lng: number };
export interface AddressMapValue { address: string | null; lat: number | null; lng: number | null }

/** One-request static Mapbox thumbnail with a pin (no JS map in view mode). */
export const staticMapUrl = (token: string, lat: number, lng: number, w = 480, h = 140) =>
  `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-s+0077b6(${lng},${lat})/${lng},${lat},15/${w}x${h}@2x?access_token=${token}`;

const toPin = (lat: unknown, lng: unknown): Pin | null =>
  hasValidCoords(lat, lng) ? { lat: Number(lat), lng: Number(lng) } : null;

/**
 * Address + map pin editor. Search (autocomplete) or type the address, drag the pin to the exact
 * property (reverse-geocodes the address), then Save writes the address AND coordinates together.
 * Map-first intake can reuse this: open in edit mode with no address and let the pin fill it in.
 */
const AddressMapField = ({
  label, value, lat, lng, saving, disabled, className, onSave,
}: {
  label: string;
  value: string | null | undefined;
  lat: unknown;
  lng: unknown;
  saving?: boolean;
  disabled?: boolean;
  className?: string;
  onSave: (v: AddressMapValue) => Promise<any>;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pin, setPin] = useState<Pin | null>(toPin(lat, lng));
  const [fromPin, setFromPin] = useState(false);
  const [token, setToken] = useState(getMapboxTokenSync());
  const editingRef = useRef(false);
  editingRef.current = editing;

  useEffect(() => {
    if (token) return;
    getMapboxToken().then((t) => t && setToken(t));
  }, [token]);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? "");
    setPin(toPin(lat, lng));
  }, [value, lat, lng, editing]);

  // Setters only, so the picker's long-lived marker handlers never hold a stale closure.
  const onLocationChange = useCallback((la: number, ln: number, address?: string, source?: LocationChangeSource) => {
    setPin({ lat: la, lng: ln });
    if (address) {
      setDraft(address);
      setFromPin(source === "drag" || source === "map" || source === "gps");
    }
  }, []);

  const pendingSave = (): AddressMapValue | undefined => {
    if (!editingRef.current) return undefined;
    const address = draft.trim() === "" ? null : draft.trim();
    const old = toPin(lat, lng);
    const pinChanged = !!pin && (!old || old.lat !== pin.lat || old.lng !== pin.lng);
    if (address === (value ?? null) && !pinChanged) return undefined;
    return { address, lat: pinChanged ? pin!.lat : null, lng: pinChanged ? pin!.lng : null };
  };
  // Dialog closed / Esc / navigation mid-edit: save instead of silently dropping the edit
  useSaveOnUnmount(pendingSave, (v) =>
    onSave(v).then(() => toast({ title: `${label} saved`, description: v.lat != null ? "Map pin updated" : undefined })),
  );

  const cancel = () => {
    editingRef.current = false;
    setDraft(value ?? "");
    setPin(toPin(lat, lng));
    setFromPin(false);
    setEditing(false);
  };

  const commit = async () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    const address = draft.trim() === "" ? null : draft.trim();
    const old = toPin(lat, lng);
    const pinChanged = !!pin && (!old || old.lat !== pin.lat || old.lng !== pin.lng);
    setEditing(false);
    setFromPin(false);
    if (address === (value ?? null) && !pinChanged) return;
    try {
      await onSave({ address, lat: pinChanged ? pin!.lat : null, lng: pinChanged ? pin!.lng : null });
      toast({ title: `${label} saved`, description: pinChanged ? "Map pin updated" : undefined });
    } catch {
      // useEntityEditor already shows "Couldn't save change" and reverts
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className={cn("min-w-0", className)}>
      <p className="text-muted-foreground text-xs flex items-center gap-1">
        {label}
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </p>
      {children}
    </div>
  );

  if (editing) {
    return shell(
      <div className="space-y-2">
        <Suspense fallback={<div className="flex h-[280px] items-center justify-center rounded-md border text-xs text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading map…</div>}>
          <LocationPicker latitude={pin?.lat ?? null} longitude={pin?.lng ?? null} onLocationChange={onLocationChange} addressHint={draft || null} />
        </Suspense>
        <div className="flex items-center gap-1">
          <Input
            value={draft ?? ""}
            placeholder="Search above, drag the pin, or type the address"
            onChange={(e) => { setDraft(e.target.value); setFromPin(false); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
            }}
            className="h-8 min-w-0 text-sm"
          />
          <Button type="button" size="sm" aria-label="Save" onClick={commit} className="h-8 shrink-0 gap-1 px-2.5">
            <Check className="h-4 w-4" /> Save
          </Button>
          <button type="button" aria-label="Cancel" onMouseDown={(e) => e.preventDefault()} onClick={cancel} className="p-1 rounded hover:bg-muted">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        {fromPin && <p className="text-[11px] text-muted-foreground">Address filled from the pin — add the house number if it's missing.</p>}
      </div>,
    );
  }

  const shown = toPin(lat, lng);
  return shell(
    <div className="space-y-1">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="group flex w-full items-center gap-1 rounded px-1 -mx-1 py-0.5 text-left font-medium text-sm hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="truncate">{value || "—"}</span>
        {!disabled && <Pencil className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60" />}
      </button>
      {shown && token ? (
        <button type="button" disabled={disabled} onClick={() => setEditing(true)} className="block w-full overflow-hidden rounded-md border" title="Check or move the pin">
          <img src={staticMapUrl(token, shown.lat, shown.lng)} alt={`Map pin for ${value || "this address"}`} className="h-[110px] w-full object-cover" loading="lazy" />
        </button>
      ) : (
        !disabled && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <MapPin className="h-3 w-3" /> Set the map pin
          </button>
        )
      )}
    </div>,
  );
};

export default AddressMapField;
