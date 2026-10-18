import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { WavRecorder } from "@/lib/wavRecorder";
import { useSurveyFileUrl } from "@/hooks/useSiteSurvey";
import { MAX_NOTE_SECONDS, suggestFromTranscript, type Suggestion } from "@/lib/siteSurvey/voice";
import type { SurveyMedia } from "@/lib/siteSurvey/model";

/** Tap to record, tap to stop (2-minute cap). Works offline: the note is kept on the phone and transcribed later. */
export function VoiceRecordButton({ onDone, label = "Voice note", testId }: { onDone: (b64: string, bytes: number) => void; label?: string; testId?: string }) {
  const { toast } = useToast();
  const rec = useRef<WavRecorder | null>(null);
  const [on, setOn] = useState(false);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = async () => {
    if (!rec.current) return;
    if (tick.current) clearInterval(tick.current);
    const r = rec.current; rec.current = null; setOn(false);
    try {
      const { base64, bytes } = await r.stop();
      if (bytes < 8000) { toast({ title: "That was very short, nothing saved" }); return; }
      onDone(base64, bytes);
    } catch (e: any) { toast({ title: "Couldn't save the recording", description: e?.message, variant: "destructive" }); }
  };
  const start = async () => {
    try {
      const r = new WavRecorder();
      await r.start({ onLevel: (l) => setLevel(l) });
      rec.current = r; setOn(true); setSecs(0);
      const t0 = Date.now();
      tick.current = setInterval(() => {
        const s = Math.floor((Date.now() - t0) / 1000);
        setSecs(s);
        if (s >= MAX_NOTE_SECONDS) void stop();
      }, 250);
    } catch {
      toast({ title: "Microphone not available", description: "Allow the microphone for this site in your browser settings, or type the note.", variant: "destructive" });
    }
  };
  useEffect(() => () => { if (tick.current) clearInterval(tick.current); rec.current?.cancel(); }, []);
  const left = MAX_NOTE_SECONDS - secs;
  return on ? (
    <Button type="button" variant="destructive" className="w-full min-h-[48px] justify-between" onClick={stop} data-testid={testId ? `${testId}-stop` : undefined}>
      <span className="flex items-center gap-2"><Square className="h-4 w-4" />Stop & save</span>
      <span className="flex items-center gap-2 tabular-nums text-sm">
        <span className="inline-block h-2 w-10 overflow-hidden rounded bg-white/30"><i className="block h-full bg-white" style={{ width: `${Math.min(100, level * 400)}%` }} /></span>
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}{left <= 15 ? ` · ${left}s left` : ""}
      </span>
    </Button>
  ) : (
    <Button type="button" variant="outline" className="w-full min-h-[48px]" onClick={start} data-testid={testId}>
      <Mic className="h-4 w-4 mr-1" />{label}
    </Button>
  );
}

function NotePlayer({ m }: { m: SurveyMedia }) {
  const url = useSurveyFileUrl(m.audio_purged ? null : m.storage_path);
  const el = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  if (!url) return null;
  return (
    <>
      <audio ref={el} src={url} preload="none" playsInline onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} />
      <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-primary"
        onClick={() => { const a = el.current; if (!a) return; if (playing) { a.pause(); } else { void a.play(); setPlaying(true); } }}>
        {playing ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}{m.duration_s ? `${Math.round(m.duration_s)}s` : "Play"}
      </Button>
    </>
  );
}

/** Voice notes with their written text. Optional suggestions ("Pipe run 6 m") the rep can apply with one tap. */
export function VoiceNoteList({ notes, onRemove, onApply, online }: {
  notes: SurveyMedia[]; online: boolean; onRemove?: (m: SurveyMedia) => void; onApply?: (s: Suggestion) => void;
}) {
  if (!notes.length) return null;
  return (
    <div className="space-y-2" data-testid="voice-notes">
      {notes.map((m) => {
        const sug = onApply && m.transcript ? suggestFromTranscript(m.transcript) : [];
        return (
          <div key={m.id} className="rounded-lg border-l-4 border-primary bg-muted/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-primary flex items-center gap-1"><Mic className="h-3 w-3" />Voice note</span>
              <div className="flex items-center">
                <NotePlayer m={m} />
                {onRemove && <Button type="button" size="sm" variant="ghost" className="h-8 px-2" aria-label="Delete voice note" onClick={() => onRemove(m)}><Trash2 className="h-3.5 w-3.5" /></Button>}
              </div>
            </div>
            {m.transcript_status === "done" && <p className="text-sm whitespace-pre-wrap">"{m.transcript}"</p>}
            {m.transcript_status === "pending" && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {online ? <><Loader2 className="h-3 w-3 animate-spin" />Writing it down…</> : "Saved on phone. Will be written down when you're back online."}
              </p>
            )}
            {m.transcript_status === "failed" && <p className="text-xs text-muted-foreground">Couldn't write this one down. The recording is kept; you can type the note.</p>}
            {sug.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {sug.map((x) => <button key={x.field} type="button" className="v8-chip min-h-[32px]" onClick={() => onApply?.(x)}>Use: {x.label}</button>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
