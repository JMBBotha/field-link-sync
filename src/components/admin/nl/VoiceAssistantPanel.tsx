import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import ResultTable from "@/components/admin/nl/ResultTable";
import type { TranscriptEntry, VoiceStatus } from "@/hooks/useVoiceAssistant";
import type { Structured } from "@/components/admin/nl/ResultTable";
import { Loader2, Mic, MicOff, PhoneOff, Radio } from "lucide-react";

interface VoiceAssistantPanelProps {
  status: VoiceStatus;
  error: string | null;
  transcript: TranscriptEntry[];
  results: Structured[];
  assistantSpeaking: boolean;
  muted: boolean;
  onStart: () => void;
  onStop: () => void;
  onToggleMute: () => void;
}

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  live: "Live",
  ended: "Call ended",
  error: "Connection problem",
};

const VoiceAssistantPanel = ({
  status,
  error,
  transcript,
  results,
  assistantSpeaking,
  muted,
  onStart,
  onStop,
  onToggleMute,
}: VoiceAssistantPanelProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const live = status === "live";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcript, results]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              live ? "bg-emerald-500 animate-pulse" : status === "error" ? "bg-destructive" : "bg-muted-foreground/50"
            }`}
          />
          <span className="text-muted-foreground">{STATUS_LABEL[status]}</span>
          {live && assistantSpeaking && (
            <span className="flex items-center gap-1 text-primary">
              <Radio className="h-3 w-3" /> speaking
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {live && (
            <Button variant="outline" size="sm" onClick={onToggleMute} className="gap-1.5">
              {muted ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              <span className="text-xs">{muted ? "Unmute" : "Mute"}</span>
            </Button>
          )}
          {live || status === "connecting" ? (
            <Button variant="destructive" size="sm" onClick={onStop} className="gap-1.5">
              <PhoneOff className="h-3.5 w-3.5" />
              <span className="text-xs">End call</span>
            </Button>
          ) : (
            <Button size="sm" onClick={onStart} className="gap-1.5" disabled={status === "connecting"}>
              {status === "connecting"
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Mic className="h-3.5 w-3.5" />}
              <span className="text-xs">{status === "idle" ? "Start voice call" : "Call again"}</span>
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[55vh] min-h-[220px] overflow-y-auto px-4 py-3 space-y-3">
        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
            {error}
          </div>
        )}

        {status === "idle" && !transcript.length && (
          <div className="space-y-2 text-xs text-muted-foreground">
            <p className="text-sm text-foreground">Talk to your operations assistant.</p>
            <p>
              It uses exactly the same tools as the text assistant — leads, jobs, invoices, staff and the
              unassigned queue. Anything that changes data is read back to you and only runs once you say
              “yes, confirm” (or confirm on screen).
            </p>
          </div>
        )}

        {transcript.map((entry, i) => (
          <div key={i} className={entry.role === "user" ? "flex justify-end" : ""}>
            <div
              className={
                entry.role === "user"
                  ? `max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground ${
                    entry.final ? "" : "opacity-70"
                  }`
                  : `text-sm text-foreground whitespace-pre-wrap ${entry.final ? "" : "opacity-70"}`
              }
            >
              {entry.text}
            </div>
          </div>
        ))}

        {results.map((block, i) => <ResultTable key={i} block={block} />)}
      </div>
    </div>
  );
};

export default VoiceAssistantPanel;
