import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Sparkles, MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { hhmm, toMinutes } from "@/lib/schedulingDefaults";
import { LANE_META } from "@/lib/leadLane";

export type RankedBlock = { start: string; end: string; label: string };
export interface RankedPerson {
  profile_id: string; full_name: string; tier: number; status: string; km: number | null; reason: string;
  next_free: string | null; booked_minutes: number; work_start: string | null; work_end: string | null; blocks: RankedBlock[];
}
export interface SuggestedSlot { profile_id: string; full_name: string; slot_date: string; slot_start: string; reason: string }

export interface AvailabilityPickerProps {
  lane: "sales" | "service";
  date: string; // yyyy-MM-dd
  startTime: string; // HH:mm
  minutes: number;
  lat?: number | null;
  lng?: number | null;
  excludeJobId?: string | null;
  excludeLeadId?: string | null;
  selectedId?: string | null;
  onSelect: (personId: string, date?: string, time?: string) => void;
  className?: string;
}

const DAY_START = 7 * 60, DAY_END = 18 * 60;
const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - DAY_START) / (DAY_END - DAY_START)) * 100))}%`;

/** Status chip text for a ranked row (no money, HH:MM only). */
export function statusLabel(p: Pick<RankedPerson, "status" | "reason" | "blocks">): string {
  if (p.status === "off") return "Off";
  if (p.status === "leave") return "On leave";
  if (p.status === "busy") {
    const m = p.reason.match(/(?:Busy|Booked|Blocked|Off) (\d{2}:\d{2}–\d{2}:\d{2})/);
    return m ? `Busy ${m[1]}` : "Busy";
  }
  return "Free";
}

export function AvailabilityPicker({ lane, date, startTime, minutes, lat, lng, excludeJobId, excludeLeadId, selectedId, onSelect, className }: AvailabilityPickerProps) {
  const args = { p_lane: lane, p_date: date, p_minutes: minutes, p_lat: lat ?? null, p_lng: lng ?? null, p_exclude_job: excludeJobId ?? null, p_exclude_lead: excludeLeadId ?? null };
  const { data: people = [], isLoading } = useQuery({
    queryKey: ["rank-booking-candidates", args, startTime],
    enabled: !!date && !!startTime,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rank_booking_candidates" as any, { ...args, p_start: startTime } as any);
      if (error) throw error;
      return (data || []) as unknown as RankedPerson[];
    },
  });
  const { data: slots = [] } = useQuery({
    queryKey: ["suggest-booking-slots", args],
    enabled: !!date,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("suggest_booking_slots" as any, args as any);
      if (error) throw error;
      return (data || []) as unknown as SuggestedSlot[];
    },
  });

  return (
    <div className={cn("space-y-2 min-w-0", className)} data-testid="availability-picker">
      {slots.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="suggested-slots">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Suggested slots</span>
          {slots.map((s) => (
            <button key={`${s.profile_id}-${s.slot_date}-${s.slot_start}`} type="button" title={s.reason}
              onClick={() => onSelect(s.profile_id, s.slot_date, hhmm(s.slot_start))}
              className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10">
              {s.full_name.split(" ")[0]} · {format(parseISO(s.slot_date), "EEE")} {hhmm(s.slot_start)}
            </button>
          ))}
        </div>
      )}
      {isLoading && <p className="text-xs text-muted-foreground">Checking who's free…</p>}
      {people.map((p, i) => {
        const selected = selectedId === p.profile_id;
        const chip = statusLabel(p);
        const blocks = Array.isArray(p.blocks) ? p.blocks : [];
        return (
          <button key={p.profile_id} type="button" data-testid="ranked-person" onClick={() => onSelect(p.profile_id)}
            className={cn("w-full min-w-0 rounded-lg border p-2.5 text-left transition-colors",
              selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted")}>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium truncate max-w-full">{p.full_name}</span>
              <span className={cn("rounded border px-1 text-[10px] font-semibold", LANE_META[lane].className)}>{lane.toUpperCase()}</span>
              {i === 0 && p.tier < 3 && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                  <Sparkles className="h-3 w-3" /> Best match
                </span>
              )}
              <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                chip === "Free" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                  : chip.startsWith("Busy") ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{chip}</span>
              <span className="ml-auto inline-flex items-center gap-0.5 text-xs text-muted-foreground"><MapPin className="h-3 w-3" />{p.km != null ? `${p.km} km` : "no location"}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground break-words">{p.reason}</p>
            <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded bg-muted" aria-hidden>
              {blocks.map((b, k) => {
                const s = toMinutes(b.start), e = toMinutes(b.end);
                const grey = b.label === "Busy" || b.label === "Off" || b.label === "Blocked";
                return <span key={k} className={cn("absolute inset-y-0", grey ? "bg-muted-foreground/50" : "bg-primary/60")}
                  style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} title={`${b.label} ${b.start}–${b.end}`} />;
              })}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
              <span>{blocks.length ? blocks.map((b) => `${b.start}–${b.end}`).join(" · ") : "Nothing booked"}</span>
              {p.next_free && <span className="font-medium text-foreground">next free {hhmm(p.next_free)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default AvailabilityPicker;
