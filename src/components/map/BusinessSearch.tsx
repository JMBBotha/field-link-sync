import { useEffect, useRef, useState } from "react";
import { Search, Loader2, MapPin, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Feature {
  id: string;
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
}

interface Props {
  getToken: () => string | null;
  onSelect: (lat: number, lng: number, name: string, address: string) => void;
  proximity?: { lat: number; lng: number } | null;
  className?: string;
}

export default function BusinessSearch({ getToken, onSelect, proximity, className }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Feature[]>([]);
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
      return;
    }
    debounceRef.current = window.setTimeout(async () => {
      const token = getToken();
      if (!token) {
        setError("Mapbox token not set");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          access_token: token,
          types: "poi",
          limit: "8",
          autocomplete: "true",
          language: "en",
        });
        if (proximity) params.set("proximity", `${proximity.lng},${proximity.lat}`);
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(term)}.json?${params}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setResults(data.features || []);
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

  return (
    <div ref={wrapRef} className="relative w-72">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search businesses by name…"
          className="h-8 pl-7 pr-7 text-xs"
        />
        {loading ? (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />
        ) : q ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-0 top-0 h-8 w-8"
            onClick={() => { setQ(""); setResults([]); setOpen(false); }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      {open && (results.length > 0 || error) && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-80 overflow-auto">
          {error && <div className="px-3 py-2 text-xs text-destructive">{error}</div>}
          {results.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => handlePick(f)}
              className="w-full text-left px-3 py-2 hover:bg-accent flex gap-2 items-start border-b last:border-b-0"
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
