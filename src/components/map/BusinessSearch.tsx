import { useEffect, useRef, useState } from "react";
import { Search, Loader2, MapPin, X, Building2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { hasValidCoords } from "@/lib/leadCoords";

interface Feature {
  id: string;
  text: string;
  place_name: string;
  center?: [number, number] | null; // [lng, lat] — may be resolved on select
  mapboxId?: string; // Search Box API id, retrieved on select
}

interface InternalResult {
  key: string;
  kind: "lead" | "customer";
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
}

interface Props {
  getToken: () => string | null;
  onSelect: (lat: number, lng: number, name: string, address: string) => void;
  /** Called when an internal lead/job record is picked (so the map can open its popup). */
  onSelectLead?: (leadId: string, lat: number, lng: number) => void;
  proximity?: { lat: number; lng: number } | null;
  className?: string;
}

export default function BusinessSearch({ getToken, onSelect, onSelectLead, proximity, className }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Feature[]>([]);
  const [internal, setInternal] = useState<InternalResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setInternal([]);
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      setError(null);

      // 1) Search our own records (leads + customers) first.
      const like = `%${term}%`;
      const internalPromise = Promise.all([
        supabase
          .from("leads")
          .select("id, customer_name, customer_address, latitude, longitude")
          .or(`customer_name.ilike.${like},customer_address.ilike.${like}`)
          .limit(8),
        supabase
          .from("customers")
          .select("id, name, company_name, primary_address_line1, city, latitude, longitude")
          .or(`name.ilike.${like},company_name.ilike.${like},primary_address_line1.ilike.${like}`)
          .limit(8),
      ]);

      // 2) Mapbox business/POI search (secondary) — country-wide, not limited to
      //    the current map viewport. Runs a proximity-biased pass plus a broad
      //    national pass, then merges the two.
      const token = getToken();
      const mapboxPromise = (async () => {
        if (!token) return [] as Feature[];
        const runSearch = async (useProximity: boolean) => {
          const params = new URLSearchParams({
            access_token: token,
            types: "poi,address,place,locality,neighborhood",
            limit: "10",
            autocomplete: "true",
            language: "en",
            country: "za",
          });
          if (useProximity && proximity) params.set("proximity", `${proximity.lng},${proximity.lat}`);
          const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(term)}.json?${params}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          return (data.features || []) as Feature[];
        };

        const [near, wide] = await Promise.all([
          proximity ? runSearch(true).catch(() => [] as Feature[]) : Promise.resolve([] as Feature[]),
          runSearch(false).catch(() => [] as Feature[]),
        ]);

        const seen = new Set<string>();
        const merged: Feature[] = [];
        [...near, ...wide].forEach((f) => {
          const key = f.id || `${f.place_name}`;
          if (seen.has(key)) return;
          seen.add(key);
          merged.push(f);
        });
        return merged.slice(0, 12);
      })();


      try {
        const [[leadsRes, customersRes], features] = await Promise.all([
          internalPromise,
          mapboxPromise.catch(() => [] as Feature[]),
        ]);

        const rows: InternalResult[] = [];
        leadsRes.data?.forEach((l: any) =>
          rows.push({
            key: `lead-${l.id}`,
            kind: "lead",
            id: l.id,
            name: l.customer_name,
            address: l.customer_address || "",
            lat: l.latitude,
            lng: l.longitude,
          })
        );
        customersRes.data?.forEach((c: any) =>
          rows.push({
            key: `customer-${c.id}`,
            kind: "customer",
            id: c.id,
            name: c.company_name || c.name,
            address: [c.primary_address_line1, c.city].filter(Boolean).join(", "),
            lat: c.latitude,
            lng: c.longitude,
          })
        );

        setInternal(rows);
        setResults(features);
        setOpen(true);
      } catch (e: any) {
        setError(e?.message || "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, getToken, proximity]);

  const handlePick = (f: Feature) => {
    const [lng, lat] = f.center;
    onSelect(lat, lng, f.text, f.place_name);
    setOpen(false);
    setQ(f.text);
  };

  const handlePickInternal = async (r: InternalResult) => {
    let { lat, lng } = r;

    // Fall back to the customer's primary location when the record has no coords.
    if (!hasValidCoords(lat, lng) && r.kind === "customer") {
      const { data } = await supabase
        .from("customer_locations")
        .select("latitude, longitude")
        .eq("customer_id", r.id)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        lat = data.latitude;
        lng = data.longitude;
      }
    }

    if (!hasValidCoords(lat, lng)) {
      setError("Location not confirmed for this record");
      return;
    }

    setOpen(false);
    setQ(r.name);
    if (r.kind === "lead" && onSelectLead) onSelectLead(r.id, lat as number, lng as number);
    else onSelect(lat as number, lng as number, r.name, r.address);
  };

  const hasAny = internal.length > 0 || results.length > 0 || !!error;

  return (
    <div ref={wrapRef} className={className ?? "relative w-72"}>
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => hasAny && setOpen(true)}
          placeholder="Search businesses, leads, customers…"
          className="h-8 pl-7 pr-7 text-xs bg-background text-foreground border-border"
        />
        {loading ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : q ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-0 top-0 h-8 w-8"
            onClick={() => { setQ(""); setResults([]); setInternal([]); setOpen(false); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {open && hasAny && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover text-popover-foreground shadow-lg max-h-80 overflow-auto">
          {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
          {internal.length > 0 && (
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50">
              In your records
            </div>
          )}
          {internal.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => handlePickInternal(r)}
              className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground flex gap-2 items-start border-b last:border-b-0"
            >
              {r.kind === "lead" ? (
                <Building2 className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
              ) : (
                <Users className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{r.name}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {r.address || (r.kind === "lead" ? "Job / lead" : "Customer")}
                  {!hasValidCoords(r.lat, r.lng) && r.kind === "lead" ? " • location not confirmed" : ""}
                </div>
              </div>
            </button>
          ))}
          {results.length > 0 && (
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50">
              Places
            </div>
          )}
          {results.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => handlePick(f)}
              className="w-full text-left px-3 py-2 hover:bg-accent hover:text-accent-foreground flex gap-2 items-start border-b last:border-b-0"
            >
              <MapPin className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{f.text}</div>
                <div className="text-[11px] text-muted-foreground truncate">{f.place_name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
