import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { sastTime } from "@/lib/techLocation";

const MIN_WRITE_MS = 60_000;

/** Tech side: while one of the tech's jobs is inside its location window (server decides:
 *  my_location_share_jobs), report GPS to agent_locations and show a clear notice.
 *  Stops as soon as no window is open. Browsers only report while the app is open
 *  (iPhone especially); on reopen we write a fresh fix straight away. */
export default function JobLocationShare() {
  const q = useQuery({
    queryKey: ["my-location-share-jobs"],
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_location_share_jobs");
      if (error) return [];
      return (data || []) as { job_id: string; title: string | null; window_end: string }[];
    },
  });
  const jobs = q.data || [];
  const active = jobs.length > 0;
  const lastWrite = useRef(0);

  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    let cancelled = false;
    const write = async (pos: GeolocationPosition, force = false) => {
      if (cancelled) return;
      if (!force && Date.now() - lastWrite.current < MIN_WRITE_MS) return;
      lastWrite.current = Date.now();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Location only: never touch is_available here (DB trigger keeps it in step with the tech's own choice).
      const { data: row } = await supabase.from("agent_locations").select("id").eq("agent_id", user.id).maybeSingle();
      const patch = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, last_updated: new Date().toISOString() };
      if (row) await supabase.from("agent_locations").update(patch).eq("agent_id", user.id);
      else await supabase.from("agent_locations").insert({ agent_id: user.id, is_available: false, ...patch });
    };
    const id = navigator.geolocation.watchPosition((p) => void write(p), () => {}, { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 });
    const onVisible = () => {
      if (document.visibilityState === "visible")
        navigator.geolocation.getCurrentPosition((p) => void write(p, true), () => {}, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 15_000 });
    };
    document.addEventListener("visibilitychange", onVisible);
    onVisible();
    return () => { cancelled = true; navigator.geolocation.clearWatch(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [active]);

  if (!active) return null;
  const until = jobs.map((j) => j.window_end).sort().slice(-1)[0];
  return (
    <div role="status" className="mx-3 mt-2 flex items-start gap-2 rounded-xl border border-[#1590D6]/30 bg-[#1590D6]/10 px-3 py-2 text-xs text-[#0F2A44] dark:text-[#CFE6F6]" data-testid="location-share-notice">
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>Your location is shared with the job's salesperson and the office during this job (until {sastTime(until)}). Keep this app open on the way so they can see you're coming. Sharing stops automatically after the job.</span>
    </div>
  );
}
