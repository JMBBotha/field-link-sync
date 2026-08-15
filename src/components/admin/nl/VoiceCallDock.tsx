import { Button } from "@/components/ui/button";
import type { TranscriptEntry, VoiceStatus } from "@/hooks/useVoiceAssistant";
import { Loader2, Maximize2, Mic, MicOff, PhoneOff, Radio } from "lucide-react";

interface VoiceCallDockProps {
  status: VoiceStatus;
  error: string | null;
  transcript: TranscriptEntry[];
  assistantSpeaking: boolean;
  muted: boolean;
  onStop: () => void;
  onToggleMute: () => void;
  onExpand: () => void;
}

/**
 * Compact floating call widget shown while a voice call is active so the
 * user keeps working on the page (e.g. an open quote) behind it.
 */
const VoiceCallDock = ({
  status,
  error,
  transcript,
  assistantSpeaking,
  muted,
  onStop,
  onToggleMute,
  onExpand,
}: VoiceCallDockProps) => {
  const live = status === "live";
  const connecting = status === "connecting";
  const last = [...transcript].reverse().find((t) => t.text.trim().length > 0);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[260px] sm:w-[300px] rounded-xl border border-border bg-card/90 backdrop-blur-md shadow-lg">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span
            className={`inline-flex h-2 w-2 shrink-0 rounded-full ${
              live
                ? "bg-emerald-500 animate-pulse"
                : status === "error"
                  ? "bg-destructive"
                  : "bg-muted-foreground/50"
            }`}
          />
          <span className="truncate font-medium text-foreground">
            {connecting ? "Connecting…" : "Mandy · live"}
          </span>
          {live && assistantSpeaking && <Radio className="h-3 w-3 shrink-0 text-primary" />}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onExpand} aria-label="Expand assistant">
          <Maximize2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {(error || last) && (
        <p
          className={`px-3 pb-2 text-xs line-clamp-2 ${
            error ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {error ?? last?.text}
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button variant="outline" size="sm" onClick={onToggleMute} className="h-8 flex-1 gap-1.5" disabled={!live}>
          {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          <span className="text-xs">{muted ? "Unmute" : "Mute"}</span>
        </Button>
        <Button variant="destructive" size="sm" onClick={onStop} className="h-8 flex-1 gap-1.5">
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
          <span className="text-xs">{connecting ? "Cancel" : "End"}</span>
        </Button>
      </div>
    </div>
  );
};

export default VoiceCallDock;
