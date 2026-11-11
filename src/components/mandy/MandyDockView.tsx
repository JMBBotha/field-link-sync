/**
 * Mandy dock chrome. The live dock and the screenshot harness share this
 * so the turn states (listening / thinking / speaking) are the real ones.
 */
import { Loader2, Mic, MicOff, Send, Volume2, VolumeX, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MandyChoice, MandyResult } from "@/lib/mandy/actions";
import { isMandyBusy, mandyStatusLabel, type MandyPhase } from "@/lib/mandy/realtimeTurn";

type ConfirmCard = NonNullable<MandyResult["confirm"]>;

export function MandyDockView({
  botName, mode, phase, level, heard, reply, choices, confirm, typed, muted, live, embedded,
  onTyped, onClose, onToggleMute, onMic, onSend, onChoice, onConfirm, onCancelConfirm,
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
  onTyped: (v: string) => void;
  onClose: () => void;
  onToggleMute: () => void;
  onMic: () => void;
  onSend: () => void;
  onChoice: (c: MandyChoice) => void;
  onConfirm: () => void;
  onCancelConfirm: () => void;
}) {
  const label = mandyStatusLabel(phase);
  const listening = phase === "listening";
  const speaking = phase === "speaking" || phase === "greeting";
  const thinking = phase === "thinking" || phase === "working" || phase === "hearing";
  const micDisabled = !live && isMandyBusy(phase);
  const shell = embedded
    ? "relative w-[340px] rounded-xl border border-border bg-card shadow-lg"
    : "fixed bottom-4 right-4 z-[60] w-[300px] sm:w-[340px] rounded-xl border border-border bg-card/95 backdrop-blur-md shadow-lg print:hidden";

  return (
    <div className={shell} data-testid="mandy-dock" data-phase={phase}>
      <style>{`@keyframes mandy-speak{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}`}</style>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full ${listening ? "animate-pulse" : phase === "idle" ? "bg-primary" : "animate-pulse bg-primary"}`} style={listening ? { background: "#C2410C" } : undefined} />
          <span className="shrink-0 text-sm font-medium text-foreground">{botName || "Mandy"}</span>
          {mode === "quote" && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">Quote mode</span>}
          {(listening || speaking) && <LevelBars level={listening ? level : 0} speaking={speaking} />}
          <span className="truncate text-sm font-medium text-foreground" data-testid="mandy-status">{label}</span>
          {thinking && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#3D9BE8]" aria-hidden />}
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

      <div className="space-y-2 px-3 py-2 text-sm">
        {heard && <p className="text-sm text-muted-foreground">You: “{heard}”</p>}
        {reply && <p className="text-sm text-foreground" data-testid="mandy-reply">{reply}</p>}
        {!heard && !reply && <p className="text-sm text-muted-foreground">Tap the mic and ask — e.g. “open the last quote”, “add a Samsung 24000 inverter to Main bedroom”.</p>}

        {choices.length > 0 && (
          <div className="flex flex-wrap gap-1.5" data-testid="mandy-choices">
            {choices.map((c, i) => (
              <Button key={i} size="sm" variant="outline" className="h-auto whitespace-normal py-1 text-left text-xs" onClick={() => onChoice(c)}>
                {c.label}
              </Button>
            ))}
          </div>
        )}

        {confirm && (
          <div className={confirm.danger ? "rounded-md border-2 border-destructive bg-destructive/15 p-2" : "rounded-md border border-destructive/40 bg-destructive/10 p-2"} data-testid={confirm.danger ? "mandy-danger-card" : undefined}>
            <p className={confirm.danger ? "text-sm font-semibold text-destructive" : "text-sm text-foreground"}>{confirm.summary}</p>
            {confirm.lines?.length ? (
              <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground" data-testid="mandy-plan-lines">
                {confirm.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={onConfirm}><Check className="h-3 w-3" /> Confirm</Button>
              <Button size="sm" variant="outline" className="h-7" onClick={onCancelConfirm}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <span className="relative inline-flex shrink-0">
          {listening && <span className="absolute inset-0 animate-ping rounded-md" style={{ background: "rgba(194,65,12,0.35)" }} aria-hidden />}
          <Button
            size="icon"
            variant={listening ? "default" : "default"}
            className="relative h-9 w-9 shrink-0"
            style={listening ? { background: "#C2410C", color: "#fff" } : undefined}
            disabled={micDisabled}
            onClick={onMic}
            aria-label={listening || live ? "Stop" : "Talk"}
          >
            {listening || live ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
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
