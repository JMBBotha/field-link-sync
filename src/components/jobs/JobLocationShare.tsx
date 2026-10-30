import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin, Navigation } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PresenceTarget, presenceLabel, sastTime, canCancelTrip } from "@/lib/techLocation";
import { toast } from "sonner";

const MIN_SEND_MS = 30_000;   // throttle watchPosition fixes
const TICK_MS = 45_000;       // foreground heartbeat (iPhone pauses watchPosition when idle)

/** Tech + salesperson side. While a job / booked site visit is inside its window (server decides:
 *  my_presence_targets), send GPS fixes to report_presence, which stores the location and runs the
 *  geofence (auto On the way / check-in / check-out). Shows a clear notice + manual fallback buttons.
 *  Browsers only report while the app is open; on reopen we send a fix straight away to catch up. */
export default function JobLocationShare() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["my-presence-targets"],
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_presence_targets");
      if (error) return [];
      return (data || []) as { kind: "job" | "sales_visit"; job_id: string | null; lead_id: string | null; title: string | null; window_end: string }[];
    },
  });
  const targets = q.data || [];
  const active = targets.length > 0;
  const [state, setState] = useState<PresenceTarget[]>([]);
  const [denied, setDenied] = useState(false);
  const last = useRef(0);

  const send = useCallback(async (pos: GeolocationPosition, force = false) => {
    if (!force && Date.now() - last.current < MIN_SEND_MS) return;
    last.current = Date.now();
    const { data } = await (supabase.rpc as any)("report_presence", {
      p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: Math.round(pos.coords.accuracy || 0),
    });
    if (data?.targets) setState(data.targets);
  }, []);

  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    const opts = { enableHighAccuracy: true, maximumAge: 20_000, timeout: 30_000 };
    const onErr = (e: GeolocationPositionError) => { if (e.code === 1) setDenied(true); };
    const id = navigator.geolocation.watchPosition((p) => { setDenied(false); void send(p); }, onErr, opts);
    const now = () => navigator.geolocation.getCurrentPosition((p) => void send(p, true), onErr, opts);
    const onVisible = () => { if (document.visibilityState === "visible") now(); };
    const tick = setInterval(() => { if (document.visibilityState === "visible") now(); }, TICK_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    now();
    return () => {
      navigator.geolocation.clearWatch(id); clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible);
    };
  }, [active, send]);

  const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), 15_000); return () => clearInterval(i); }, []);
  const manual = async (kind: string, target: string, event: "start_trip" | "cancel_trip" | "arrived" | "left") => {
    const { data, error } = await (supabase.rpc as any)("presence_manual", { p_kind: kind, p_target: target, p_event: event });
    if (error) { toast.error(error.message); return; }
    if (event === "start_trip") toast.success("Trip started. The office can see you're on the way.");
    if (event === "cancel_trip" && data?.cancelled) toast("Trip cancelled");
    setState((st) => st.map((x) => x.target !== target ? x : event === "start_trip" ? { ...x, en_route_at: new Date().toISOString(), nudge: false }
      : event === "cancel_trip" ? { ...x, en_route_at: null } : event === "arrived" ? { ...x, arrived_at: new Date().toISOString() } : { ...x, left_at: new Date().toISOString() }));
    navigator.geolocation?.getCurrentPosition((p) => void send(p, true), () => {}, { timeout: 15_000 });
    qc.invalidateQueries({ queryKey: ["my-presence-targets"] });
  };

  if (!active) return null;
  const until = targets.map((t) => t.window_end).sort().slice(-1)[0];
  return (
    <div role="status" className="mx-3 mt-2 space-y-1.5 rounded-xl border border-[#1590D6]/30 bg-[#1590D6]/10 px-3 py-2 text-xs text-[#0F2A44] dark:text-[#CFE6F6]" data-testid="location-share-notice">
      <p className="flex items-start gap-2">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Visit window open until {sastTime(until)}. When you tap Start trip, the office{targets.some((t) => t.kind === "job") ? " and the job's salesperson" : ""} can see your location and ETA. Arrival and leaving are logged automatically; keep the app open on the way. Sharing stops after the visit.</span>
      </p>
      {denied && <p className="font-medium text-red-700">Location is off for this app. Turn it on in your phone settings, or use the buttons below.</p>}
      {targets.map((t, i) => {
        const id = (t.job_id || t.lead_id)!;
        const s = state.find((x) => x.target === id) || ({ kind: t.kind, title: t.title, distance_m: null } as PresenceTarget);
        const name = t.title || (t.kind === "job" ? "your job" : "your site visit");
        const notStarted = !s.en_route_at && !s.arrived_at;
        return (
          <div key={id} className="space-y-1.5 border-t border-[#1590D6]/20 pt-2" data-testid="trip-card">
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="min-w-0 font-semibold">{t.title || (t.kind === "job" ? "Job" : "Site visit")}</span>
              <span className="text-[11px] opacity-80">{presenceLabel(s)}{s.distance_m != null && !s.arrived_at ? ` · ${s.distance_m >= 1000 ? `${(s.distance_m / 1000).toFixed(1)} km` : `${s.distance_m} m`}` : ""}</span>
            </div>
            {notStarted && s.nudge && <p className="rounded-lg bg-amber-100 px-2 py-1.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">Heading to {name}? Tap Start trip.</p>}
            {notStarted && i === 0 && (
              <Button className="h-14 w-full rounded-xl bg-[#1590D6] text-base font-semibold text-white shadow-md hover:bg-[#127bb8]" onClick={() => manual(t.kind, id, "start_trip")} data-testid="start-trip">
                <Navigation className="mr-2 h-5 w-5" /> Start trip
              </Button>
            )}
            {notStarted && i > 0 && <Button variant="outline" className="h-9 w-full text-sm" onClick={() => manual(t.kind, id, "start_trip")}>Start trip</Button>}
            <div className="flex flex-wrap justify-end gap-1.5">
              {canCancelTrip(s) && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => manual(t.kind, id, "cancel_trip")}>Cancel trip</Button>}
              {!s.arrived_at && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => manual(t.kind, id, "arrived")}>Check in</Button>}
              {s.arrived_at && !s.left_at && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => manual(t.kind, id, "left")}>Check out</Button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
