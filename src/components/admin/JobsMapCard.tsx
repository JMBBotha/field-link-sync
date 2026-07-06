import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { supabase } from "@/integrations/supabase/client";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Loader2 } from "lucide-react";
import { getMapboxToken } from "@/lib/mapboxToken";
import { format, addDays, addMonths, subDays } from "date-fns";
import { useNavigate } from "react-router-dom";

type Range = "week" | "month";

interface JobRow {
  id: string;
  title: string | null;
  status: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  scheduled_for: string | null;
  priority: string | null;
  customers: { name: string | null; phone: string | null } | null;
}

const bucketFor = (scheduled: string | null): "past" | "current" | "future" => {
  if (!scheduled) return "future";
  const t = new Date(scheduled).getTime();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (t < now - dayMs) return "past";
  if (t > now + dayMs) return "future";
  return "current";
};

const COLORS = {
  past: "#94a3b8",     // slate-400
  current: "#10b981",  // emerald-500
  future: "#3b82f6",   // blue-500
};

const escapeHtml = (s: string | null | undefined) => {
  if (!s) return "";
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
};

const JobsMapCard = () => {
  const { companyId } = useUserCompanyId();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("week");
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const [tokenReady, setTokenReady] = useState(false);
  const [tokenError, setTokenError] = useState(false);

  const bounds = useMemo(() => {
    const now = new Date();
    const start = subDays(now, 90); // always 90 days back
    const end = range === "week" ? addDays(now, 7) : addMonths(now, 1);
    return { start: start.toISOString(), end: end.toISOString() };
  }, [range]);

  const { data: jobs = [], isLoading } = useQuery<JobRow[]>({
    queryKey: ["jobs-map", companyId, range],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, status, address, lat, lng, scheduled_for, priority, customers(name, phone)")
        .eq("company_id", companyId!)
        .gte("scheduled_for", bounds.start)
        .lte("scheduled_for", bounds.end)
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return (data as any) || [];
    },
  });

  const geoJobs = useMemo(
    () => jobs.filter((j) => typeof j.lat === "number" && typeof j.lng === "number"),
    [jobs]
  );

  const counts = useMemo(() => {
    const c = { past: 0, current: 0, future: 0 };
    for (const j of geoJobs) c[bucketFor(j.scheduled_for)] += 1;
    return c;
  }, [geoJobs]);

  // Init map once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getMapboxToken();
      if (cancelled) return;
      if (!token) {
        setTokenError(true);
        return;
      }
      mapboxgl.accessToken = token;
      if (!containerRef.current || mapRef.current) {
        setTokenReady(true);
        return;
      }
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [22.2922, -34.0522],
        zoom: 5,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      mapRef.current = map;
      setTokenReady(true);
    })();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Render markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tokenReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (geoJobs.length === 0) return;

    const b = new mapboxgl.LngLatBounds();
    for (const j of geoJobs) {
      const bucket = bucketFor(j.scheduled_for);
      const color = COLORS[bucket];

      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.borderRadius = "50%";
      el.style.background = color;
      el.style.border = "2px solid white";
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.35)";
      el.style.cursor = "pointer";

      const sched = j.scheduled_for
        ? format(new Date(j.scheduled_for), "dd MMM yyyy, HH:mm")
        : "Unscheduled";

      const popupHtml = `
        <div style="font-family: system-ui, sans-serif; min-width: 200px;">
          <div style="font-weight:600; margin-bottom:4px;">${escapeHtml(j.title || "Job")}</div>
          <div style="font-size:12px; color:#475569;">${escapeHtml(j.customers?.name || "No customer")}</div>
          ${j.customers?.phone ? `<div style="font-size:12px; color:#475569;">${escapeHtml(j.customers.phone)}</div>` : ""}
          ${j.address ? `<div style="font-size:12px; color:#475569; margin-top:2px;">${escapeHtml(j.address)}</div>` : ""}
          <div style="font-size:12px; margin-top:6px;"><strong>${sched}</strong></div>
          <div style="font-size:11px; color:#64748b; margin-top:2px; text-transform:capitalize;">
            ${escapeHtml(bucket)} · ${escapeHtml(j.status.replace(/_/g, " "))}
          </div>
          <button data-job-id="${j.id}" style="margin-top:8px; font-size:12px; color:#2563eb; background:none; border:none; padding:0; cursor:pointer; font-weight:600;">Open job →</button>
        </div>
      `;

      const popup = new mapboxgl.Popup({ offset: 14, closeButton: true }).setHTML(popupHtml);
      popup.on("open", () => {
        const btn = popup.getElement().querySelector<HTMLButtonElement>(`button[data-job-id="${j.id}"]`);
        btn?.addEventListener("click", () => navigate(`/admin/jobs/${j.id}`));
      });

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([j.lng!, j.lat!])
        .setPopup(popup)
        .addTo(map);
      markersRef.current.push(marker);
      b.extend([j.lng!, j.lat!]);
    }

    if (!b.isEmpty()) {
      map.fitBounds(b, { padding: 60, maxZoom: 13, duration: 600 });
    }
  }, [geoJobs, tokenReady, navigate]);

  return (
    <Card className="rounded-xl border border-border">
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4" /> Jobs Map
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Past 90 days + {range === "week" ? "next 7 days" : "next 30 days"}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <Button
            size="sm"
            variant={range === "week" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setRange("week")}
          >
            Week
          </Button>
          <Button
            size="sm"
            variant={range === "month" ? "default" : "ghost"}
            className="h-7 px-2 text-xs"
            onClick={() => setRange("month")}
          >
            Month
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.past }} />
            Past ({counts.past})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.current }} />
            Current ({counts.current})
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS.future }} />
            Future ({counts.future})
          </span>
          <span className="ml-auto text-muted-foreground">
            {geoJobs.length} of {jobs.length} jobs mapped
          </span>
        </div>

        <div className="relative w-full h-[420px] md:h-[520px] rounded-lg overflow-hidden border border-border bg-muted">
          <div ref={containerRef} className="absolute inset-0" />
          {(isLoading || (!tokenReady && !tokenError)) && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {tokenError && (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground p-4 text-center">
              Map unavailable — Mapbox token not configured.
            </div>
          )}
          {tokenReady && !isLoading && geoJobs.length === 0 && (
            <div className="absolute inset-x-0 top-3 mx-auto w-fit bg-background/90 border border-border rounded-full px-3 py-1 text-xs text-muted-foreground shadow-sm">
              No geocoded jobs in this range
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default JobsMapCard;
