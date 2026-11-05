import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { MASSAIR_WEEK_TEMPLATE, toggleDay } from "@/lib/availabilitySchedule";
import { TimeInput24 } from "@/components/ui/time-input-24";

export const POPIA_LOCATION_NOTICE =
  "You choose this. Location sharing stays off until you turn it on. Field Lynk shares your location only while you are signed in, marked Available, and inside the hours you set here. Your company uses the latest point for the Live Map, job arrival times, and nearby job offers. Colleagues do not see each other. Nothing new is recorded when you are Off, Busy, outside your hours, or after you turn this off. You can stop any time (POPIA: we process this location only because you opted in).";

export const HOURS_ARE_YOURS =
  "These hours are yours. The Massair suggestion is Mon–Fri 07:00–18:00 Johannesburg time — add or remove any day, and set your own start and end. Being Available does not ignore jobs already on your calendar. Those times still block new offers.";

const DAYS: { iso: number; label: string }[] = [
  { iso: 1, label: "Mon" },
  { iso: 2, label: "Tue" },
  { iso: 3, label: "Wed" },
  { iso: 4, label: "Thu" },
  { iso: 5, label: "Fri" },
  { iso: 6, label: "Sat" },
  { iso: 7, label: "Sun" },
];

export type ScheduleDraft = {
  days: number[];
  start: string;
  end: string;
  enabled: boolean;
  timezone: string;
};

type PlanSchedule = {
  timezone?: string;
  days?: number[];
  start?: string;
  end?: string;
  enabled?: boolean;
  override_status?: string | null;
  override_until?: string | null;
};

type Plan = {
  saved?: boolean;
  status?: string;
  tracking_enabled?: boolean;
  suggestion?: PlanSchedule;
  schedule?: PlanSchedule | null;
  next_boundary?: string | null;
};

export function suggestionDraft(suggestion?: PlanSchedule | null): ScheduleDraft {
  return {
    days: suggestion?.days?.length ? [...suggestion.days] : [...MASSAIR_WEEK_TEMPLATE.days],
    start: (suggestion?.start || MASSAIR_WEEK_TEMPLATE.start).slice(0, 5),
    end: (suggestion?.end || MASSAIR_WEEK_TEMPLATE.end).slice(0, 5),
    enabled: true,
    timezone: suggestion?.timezone || MASSAIR_WEEK_TEMPLATE.timezone,
  };
}

export function ScheduleHoursForm({
  draft,
  onChange,
  saved,
  saving,
  onSave,
  onUseSuggestion,
}: {
  draft: ScheduleDraft;
  onChange: (next: ScheduleDraft) => void;
  saved: boolean;
  saving: boolean;
  onSave: () => void;
  onUseSuggestion: () => void;
}) {
  return (
    <div className="space-y-3" data-testid="schedule-hours-form">
      <p className="text-sm text-muted-foreground">{HOURS_ARE_YOURS}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days you are available">
        {DAYS.map((day) => {
          const on = draft.days.includes(day.iso);
          return (
            <button
              key={day.iso}
              type="button"
              aria-pressed={on}
              data-testid={`schedule-day-${day.iso}`}
              onClick={() => onChange({ ...draft, days: toggleDay(draft.days, day.iso) })}
              className={cn(
                "h-11 min-w-11 rounded-full px-3 text-sm font-semibold",
                on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {day.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium">
          Start
          <TimeInput24
            aria-label="Start time"
            value={draft.start}
            onChange={(e) => onChange({ ...draft, start: e.target.value })}
            className="mt-1 h-11"
          />
        </label>
        <label className="text-sm font-medium">
          End
          <TimeInput24
            aria-label="End time"
            value={draft.end}
            onChange={(e) => onChange({ ...draft, end: e.target.value })}
            className="mt-1 h-11"
          />
        </label>
      </div>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Follow these hours automatically</span>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(v) => onChange({ ...draft, enabled: v })}
          aria-label="Follow these hours automatically"
        />
      </label>
      <p className="text-xs text-muted-foreground">Times use {draft.timezone.replace(/_/g, " ")}.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onSave} disabled={saving} data-testid="schedule-save">
          {saving ? "Saving…" : saved ? "Save my hours" : "Save my hours"}
        </Button>
        <Button type="button" variant="outline" onClick={onUseSuggestion} disabled={saving}>
          Fill Mon–Fri 07:00–18:00
        </Button>
      </div>
    </div>
  );
}

export function LocationShareCard({ className, preview = false }: { className?: string; preview?: boolean }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(suggestionDraft(null));
  const [tracking, setTracking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc("ensure_my_availability_schedule");
    if (rpcError) {
      setError("Hours could not be loaded yet. They will appear after the location update is applied.");
      setLoading(false);
      return;
    }
    const next = (data || {}) as Plan;
    setPlan(next);
    setTracking(next.tracking_enabled === true);
    const source = next.saved && next.schedule ? next.schedule : next.suggestion;
    setDraft({
      ...suggestionDraft(source),
      enabled: next.schedule?.enabled !== false,
    });
    setLoading(false);
  };

  useEffect(() => {
    if (preview) {
      setLoading(false);
      return;
    }
    if (!user) return;
    void load();
  }, [user?.id, preview]);

  const setSharing = async (on: boolean) => {
    if (!user) return;
    setTracking(on);
    setError(null);
    const { error: updateError } = await supabase.from("profiles").update({ location_tracking_enabled: on }).eq("id", user.id);
    if (updateError) {
      setTracking(!on);
      setError(updateError.message);
      return;
    }
    window.dispatchEvent(new CustomEvent("fl:location-share-changed", { detail: on }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc("save_my_availability_schedule", {
      p_days: draft.days,
      p_start: draft.start,
      p_end: draft.end,
      p_timezone: draft.timezone,
      p_enabled: draft.enabled,
    });
    setSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const next = (data || {}) as Plan;
    setPlan(next);
    window.dispatchEvent(new CustomEvent("fl:availability-changed"));
  };

  return (
    <section className={cn("rounded-xl border bg-card p-4 text-card-foreground space-y-4", className)} data-testid="location-share-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Share location while Available</h2>
          <p className="mt-1 text-sm text-muted-foreground">{POPIA_LOCATION_NOTICE}</p>
        </div>
        <Switch
          checked={tracking}
          onCheckedChange={(v) => void setSharing(v)}
          disabled={!user || loading}
          aria-label="Share my location while Available"
          data-testid="location-share-switch"
        />
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading your hours…</p>
      ) : (
        <ScheduleHoursForm
          draft={draft}
          onChange={setDraft}
          saved={plan?.saved === true}
          saving={saving}
          onSave={() => void save()}
          onUseSuggestion={() => setDraft(suggestionDraft(plan?.suggestion))}
        />
      )}
      {plan?.schedule?.override_status && plan.next_boundary && (
        <p className="text-xs text-muted-foreground">
          Your manual {plan.schedule.override_status === "available" ? "Available" : "Off"} holds until the next change in your hours.
        </p>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </section>
  );
}

/** Header button for Field Agent and sales. Opens the same opt-in and hours editor. */
export function LocationShareButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("h-11 gap-1 px-2 text-white hover:bg-white/20", className)}
        onClick={() => setOpen(true)}
        aria-label="Location sharing and hours"
        data-testid="open-location-share"
      >
        <MapPin className="h-4 w-4" />
        <span className="hidden sm:inline">Hours</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Location and hours</DialogTitle>
            <DialogDescription>Off until you opt in. Background location runs only while you are Available.</DialogDescription>
          </DialogHeader>
          <LocationShareCard className="border-0 p-0" />
        </DialogContent>
      </Dialog>
    </>
  );
}
