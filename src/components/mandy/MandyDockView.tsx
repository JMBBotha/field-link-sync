/**
 * Mandy dock chrome. The live dock and the screenshot harness share this
 * so the turn states (listening / thinking / speaking) are the real ones.
 */
import { useEffect, useRef } from "react";
import { Loader2, Mic, MicOff, Send, Volume2, VolumeX, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MandyChoice, MandyResult } from "@/lib/mandy/actions";
import { isMandyBusy, mandyStatusLabel, type MandyPhase } from "@/lib/mandy/realtimeTurn";

type ConfirmCard = NonNullable<MandyResult["confirm"]>;

const PRIMARY = { background: "#C2410C", color: "#fff" };

export function MandyDockView({
  botName, mode, phase, level, heard, reply, choices, confirm, typed, muted, live, embedded, step,
  onTyped, onClose, onToggleMute, onMic, onSend, onChoice, onConfirm, onCancelConfirm, onStop, onReconnect,
}: {
  botName: string;
  mode: "default" | "quote";
  phase: MandyPhase;
  /** 0–1 mic level. Listening draws it; speaking uses its own pulse. */
  level: number;
  heard: string;
  reply: string;
  choices: MandyChoice[];
  confirm: ConfirmCard | null;
  typed: string;
  muted: boolean;
  /** Realtime session is up — the mic stays available so he can cut her off. */
  live: boolean;
  embedded?: boolean;
  /** Current tool step, shown beside Thinking…. */
  step?: string | null;
  onTyped: (v: string) => void;
  onClose: () => void;
  onToggleMute: () => void;
  onMic: () => void;
  onSend: () => void;
  onChoice: (c: MandyChoice) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
  onStop: () => void;
  onReconnect: () => void;
}) {
  const label = mandyStatusLabel(phase);
  const listening = phase === "listening";
  const speaking = phase === "speaking" || phase === "greeting";
  const thinking = phase === "thinking" || phase === "working" || phase === "hearing";
  const micDisabled = !live && isMandyBusy(phase);
  const actionRef = useRef<HTMLDivElement>(null);
  const shell = embedded
    ? "relative w-[340px] rounded-xl border border-border bg-card shadow-lg"
    : "fixed bottom-4 right-4 z-[60] w-[300px] sm:w-[340px] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-lg print:hidden";

  useEffect(() => {
    if (!choices.length && !confirm) return;
    actionRef.current?.scrollIntoView({ block: "nearest" });
  }, [choices, confirm]);

  return (
    <div className={shell} data-testid="mandy-dock" data-phase={phase}>
      <style>{`
        @keyframes mandy-speak{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
        @keyframes mandy-choice-pulse{0%{box-shadow:0 0 0 0 rgba(194,65,12,.7)}70%{box-shadow:0 0 0 8px rgba(194,65,12,0)}100%{box-shadow:0 0 0 0 rgba(194,65,12,0)}}
        .mandy-choice-live{animation:mandy-choice-pulse 1.2s ease-out infinite;border:2px solid #C2410C;border-radius:12px}
      `}</style>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${listening ? "animate-pulse" : phase === "idle" ? "bg-primary" : "animate-pulse bg-primary"}`} style={listening ? { background: "#C2410C" } : undefined} />
          <span className="shrink-0 text-sm font-medium text-foreground">{botName || "Mandy"}</span>
          {mode === "quote" && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Quote mode</span>}
          {(listening || speaking) && <LevelBars level={listening ? level : 0} speaking={speaking} />}
          <span className={`text-sm font-medium text-foreground ${phase === "disconnected" ? "font-semibold" : "truncate"}`} data-testid="mandy-status">{label}</span>
          {thinking && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#3D9BE8]" aria-hidden />}
          {step && (
            <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs font-medium text-[#3D9BE8]" data-testid="mandy-step">
              <span className="inline-block h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[#3D9BE8]" aria-hidden />
              {step}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close Mandy">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="max-h-52 space-y-2 overflow-y-auto px-3 py-2 text-sm">
        {heard && <p className="text-sm text-muted-foreground">You: “{heard}”</p>}
        {reply && <p className="text-sm text-foreground" data-testid="mandy-reply">{reply}</p>}
        {!heard && !reply && <p className="text-sm text-muted-foreground">Tap the mic and ask — e.g. “open the last quote”, “add a Samsung 24000 inverter to Main bedroom”.</p>}
      </div>

      {(choices.length > 0 || confirm) && (
        <div ref={actionRef} className="mandy-choice-live sticky bottom-0 z-10 space-y-2 bg-card px-3 py-2" data-testid="mandy-action-bar">
          {choices.length > 0 && (
            <div className="space-y-2" data-testid="mandy-choices">
              {choices.map((c, i) => (
                <Button
                  key={`${c.action}-${c.label}-${i}`}
                  type="button"
                  data-testid={i === 0 ? "mandy-choice-primary" : undefined}
                  variant={i === 0 ? "default" : "outline"}
                  className={i === 0 ? "h-12 w-full text-base font-semibold" : "h-10 w-full justify-start text-sm"}
                  style={i === 0 ? PRIMARY : undefined}
                  onClick={() => onChoice(c)}
                >
                  {c.label}
                </Button>
              ))}
            </div>
          )}
          {confirm && (
            <div className={confirm.danger ? "rounded-md border-2 border-destructive bg-destructive/15 p-2" : "rounded-md p-1"} data-testid={confirm.danger ? "mandy-danger-card" : "mandy-confirm-card"}>
              <p className={confirm.danger ? "text-sm font-semibold text-destructive" : "text-sm text-foreground"}>{confirm.summary}</p>
              {confirm.lines?.length ? (
                <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground" data-testid="mandy-plan-lines">
                  {confirm.lines.map((l, i) => <li key={i}>{l}</li>)}
                </ul>
              ) : null}
              <div className="mt-2 flex gap-2">
                <Button type="button" data-testid="mandy-confirm" size="sm" variant={confirm.danger ? "destructive" : "default"} className="h-12 flex-1 gap-1 text-base font-semibold" style={confirm.danger ? undefined : PRIMARY} onClick={onConfirm}>
                  <Check className="h-4 w-4" /> Confirm
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-12" onClick={onCancelConfirm}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "disconnected" && (
        <div className="border-t border-[#C2410C]/30 bg-[#C2410C]/10 px-3 py-2" data-testid="mandy-disconnected">
          <p className="text-sm font-semibold text-foreground">Mandy disconnected, tap to reconnect</p>
          <Button type="button" className="mt-2 h-11 w-full text-base font-semibold" style={PRIMARY} onClick={onReconnect}>
            Reconnect
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <Button type="button" data-testid="mandy-stop" className="h-10 shrink-0 px-3 font-semibold" style={PRIMARY} onClick={onStop}>
          Stop
        </Button>
        <span className="relative inline-flex shrink-0">
          {listening && <span className="absolute inset-0 animate-ping rounded-md" style={{ background: "rgba(194,65,12,0.35)" }} aria-hidden />}
          <Button
            type="button"
            size="icon"
            variant="default"
            className="relative h-9 w-9 shrink-0"
            style={listening ? PRIMARY : undefined}
            disabled={micDisabled}
            onClick={onMic}
            aria-label={speaking || thinking ? "Interrupt Mandy" : listening || live ? "Microphone" : "Talk"}
          >
            {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
        </span>
        <form className="flex flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
          <Input value={typed} onChange={(e) => onTyped(e.target.value)} placeholder="Type instead…" className="h-9 text-sm" disabled={phase === "working" || phase === "thinking"} data-testid="mandy-input" />
          <Button type="submit" size="icon" variant="ghost" className="h-9 w-9" disabled={!typed.trim() || phase === "working" || phase === "thinking"} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}

function LevelBars({ level, speaking }: { level: number; speaking: boolean }) {
  const bias = [0.45, 0.8, 1, 0.7, 0.4];
  return (
    <span className="inline-flex h-4 items-end gap-[2px]" aria-hidden data-testid="mandy-wave">
      {bias.map((b, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: 14,
            background: "#3D9BE8",
            transformOrigin: "bottom",
            transform: speaking ? undefined : `scaleY(${Math.max(0.18, Math.min(1, level * b * 1.6))})`,
            animation: speaking ? `mandy-speak .7s ease-in-out ${i * 0.08}s infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}
