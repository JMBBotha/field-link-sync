import { Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSoundPrefs } from "@/hooks/useEventSounds";
import { playNow, setSoundPrefs, type SoundEvent } from "@/lib/sounds/eventSounds";

const SAMPLES: [SoundEvent, string][] = [["new_lead", "New lead"], ["deal_closed", "Quote accepted"], ["deposit_paid", "Deposit paid"], ["final_payment", "Paid in full"]];

/** Per-user mute + volume for dashboard event sounds (stored on this device). */
export default function SoundControls({ compact = false }: { compact?: boolean }) {
  const { muted, volume } = useSoundPrefs();
  return (
    <div className="space-y-3" data-testid="sound-controls">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-medium">
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />} Event sounds
        </span>
        <Switch checked={!muted} onCheckedChange={(on) => setSoundPrefs({ muted: !on })} aria-label="Event sounds on" />
      </div>
      <Slider value={[Math.round(volume * 100)]} max={100} step={5} disabled={muted} aria-label="Event sound volume"
        onValueChange={([v]) => setSoundPrefs({ volume: v / 100 })} onValueCommit={() => playNow("new_lead")} />
      {!compact && (
        <div className="flex flex-wrap gap-2">
          {SAMPLES.map(([e, label]) => (
            <button key={e} type="button" onClick={() => playNow(e, true)} className="rounded-md border px-2 py-1 text-xs hover:bg-muted">▶ {label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
