import { useRef, useState } from "react";
import { Camera, CheckCircle2, CloudOff, Loader2, Minus, PenLine, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSurveyFileUrl, type SyncState } from "@/hooks/useSiteSurvey";
import type { SurveyMedia } from "@/lib/siteSurvey/model";

export function SyncBadge({ state, online }: { state: SyncState; online: boolean }) {
  if (state === "syncing") return <Badge variant="outline" className="gap-1 text-xs" data-testid="survey-sync"><Loader2 className="h-3 w-3 animate-spin" />Uploading…</Badge>;
  if (state === "error") return <Badge variant="outline" className="gap-1 text-xs border-orange-300 text-orange-700" data-testid="survey-sync"><RefreshCw className="h-3 w-3" />Saved on phone · retrying</Badge>;
  if (state === "saved-phone" || !online) return <Badge variant="outline" className="gap-1 text-xs" data-testid="survey-sync">{online ? <UploadCloud className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}Saved on phone</Badge>;
  return <Badge variant="outline" className="gap-1 text-xs border-green-300 text-green-700" data-testid="survey-sync"><CheckCircle2 className="h-3 w-3" />Synced</Badge>;
}

export function Chips<T extends string | number>({ options, value, onChange, label }:
  { options: { v: T; label: string }[]; value: T | null; onChange: (v: T | null) => void; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && <div className="text-sm font-semibold">{label}</div>}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button key={String(o.v)} type="button" className={cn("v8-chip min-h-[36px]", value === o.v && "on")}
            onClick={() => onChange(value === o.v ? null : o.v)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

export function Stepper({ label, value, unit, onStep, hint }: { label: string; value: number | null; unit?: string; onStep: (d: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{label}</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => onStep(-1)} aria-label={`Less ${label}`}><Minus className="h-4 w-4" /></Button>
          <span className="min-w-[64px] text-center text-lg font-semibold tabular-nums">{value == null ? "–" : `${value}${unit ? ` ${unit}` : ""}`}</span>
          <Button type="button" variant="outline" size="icon" className="h-10 w-10" onClick={() => onStep(1)} aria-label={`More ${label}`}><Plus className="h-4 w-4" /></Button>
        </div>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** One photo slot: empty = big camera button; filled = photo with Retake / Mark up / Delete. */
export function PhotoSlot({ title, media, required, onFile, onMarkup, onRemove, testId }: {
  title: string; media: SurveyMedia | null; required?: boolean; testId?: string;
  onFile: (f: File, replaceId?: string) => void; onMarkup?: (m: SurveyMedia, url: string) => void; onRemove?: (m: SurveyMedia) => void;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const [replace, setReplace] = useState<string | undefined>();
  const url = useSurveyFileUrl(media ? (media.annotated_path || media.storage_path) : null);
  const original = useSurveyFileUrl(media?.storage_path);
  return (
    <div className="space-y-2" data-testid={testId}>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f, replace); e.target.value = ""; setReplace(undefined); }} />
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{title}</span>
        {required && !media && <span className="v8-late">Required</span>}
      </div>
      {media ? (
        <>
          <div className="relative overflow-hidden rounded-xl bg-muted aspect-[4/3]">
            {url ? <img src={url} alt={title} className="h-full w-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-muted-foreground" />}
            {!media.synced && <span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white">On phone</span>}
            {media.annotated_path && <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-xs font-semibold text-white">Marked</span>}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => { setReplace(media.id); cam.current?.click(); }}><Camera className="h-4 w-4 mr-1" />Retake</Button>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={!onMarkup || !original} onClick={() => onMarkup?.(media, original)}><PenLine className="h-4 w-4 mr-1" />Mark up</Button>
            <Button type="button" variant="outline" className="min-h-[44px]" disabled={!onRemove} onClick={() => onRemove?.(media)}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
          </div>
        </>
      ) : (
        <button type="button" onClick={() => cam.current?.click()}
          className="v8-dz flex w-full flex-col items-center justify-center gap-1 aspect-[4/3] rounded-xl" data-testid={testId ? `${testId}-take` : undefined}>
          <Camera className="h-7 w-7" />
          <span>Take photo</span>
        </button>
      )}
    </div>
  );
}

export function Thumb({ media, onClick }: { media: SurveyMedia; onClick?: () => void }) {
  const url = useSurveyFileUrl(media.annotated_path || media.storage_path);
  return (
    <button type="button" onClick={onClick} className="relative aspect-square overflow-hidden rounded-md bg-muted">
      {url && <img src={url} alt={media.caption ?? "Photo"} className="h-full w-full object-cover" loading="lazy" />}
    </button>
  );
}
