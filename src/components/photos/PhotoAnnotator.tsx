import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pencil, Type, Undo2, Trash2, X, Check, Loader2, AirVent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ANN_COLORS, drawShapes, type AnnColor, type AnnShape, type AnnTool } from "@/lib/annotation";

interface Props {
  imageUrl: string;
  initial: AnnShape[];
  saving?: boolean;
  onCancel: () => void;
  /** Called with the strokes and a flattened JPEG of photo + strokes. */
  onSave: (shapes: AnnShape[], jpeg: Blob) => void;
  /** Optional one-tap labels (site survey markers): tap a chip, then tap the photo. */
  presets?: string[];
  /** Quoted units with a cut-out picture: pick one, tap the photo to place it, slider to size it. */
  mockups?: { label: string; url: string }[];
}

/** Full-screen plain-canvas annotator: pen, arrow, text label, red/yellow/white, undo, clear, cancel, save. */
export default function PhotoAnnotator({ imageUrl, initial, saving, onCancel, onSave, presets, mockups = [] }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<AnnShape[]>(initial);
  const [draft, setDraft] = useState<AnnShape | null>(null);
  const [tool, setTool] = useState<AnnTool>("pen");
  const [color, setColor] = useState<AnnColor>("#ef4444");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preset, setPreset] = useState<string | null>(null);
  const [unitImgs, setUnitImgs] = useState<Map<string, HTMLImageElement>>(new Map());
  const [unit, setUnit] = useState<{ label: string; url: string } | null>(null);
  const [selIdx, setSelIdx] = useState<number | null>(null);

  // Preload unit cut-outs (existing mockups + pickable ones); CORS-safe so the saved JPEG isn't blocked.
  const unitUrls = [...new Set([...mockups.map((m) => m.url), ...initial.filter((x) => x.t === "unit").map((x: any) => x.url)])].join("|");
  useEffect(() => {
    unitUrls.split("|").filter(Boolean).forEach((u) => {
      if (unitImgs.has(u)) return;
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => setUnitImgs((m) => new Map(m).set(u, im));
      im.src = u;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitUrls]);

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => { imgRef.current = img; setReady(true); };
    img.onerror = () => setFailed(true);
    img.src = imageUrl;
  }, [imageUrl]);

  useEffect(() => {
    const cv = canvasRef.current, img = imgRef.current;
    if (!cv || !img || !ready) return;
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    drawShapes(ctx, draft ? [...shapes, draft] : shapes, cv.width, cv.height, unitImgs);
  }, [shapes, draft, ready, unitImgs]);

  const rel = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e: React.PointerEvent) => {
    if (!ready) return;
    const p = rel(e);
    if (preset) {
      setShapes((s) => [...s, { t: "text", c: color, at: p, text: preset.slice(0, 80) }]);
      setPreset(null);
      return;
    }
    if (tool === "unit") {
      // Tap on a placed unit selects it; tap elsewhere moves the selected unit, or places the picked one.
      const hit = shapes.map((x, i) => [x, i] as const).reverse().find(([x]) => x.t === "unit" && Math.abs(p.x - x.at.x) < x.w / 2 && Math.abs(p.y - x.at.y) < x.w / 2);
      if (hit && hit[1] !== selIdx) { setSelIdx(hit[1]); return; }
      if (selIdx != null && shapes[selIdx]?.t === "unit" && !unit) {
        setShapes((s) => s.map((x, i) => (i === selIdx ? { ...(x as any), at: p } : x)));
        return;
      }
      if (unit) {
        setShapes((s) => { setSelIdx(s.length); return [...s, { t: "unit", c: color, at: p, w: 0.3, url: unit.url, label: unit.label }]; });
        setUnit(null);
      }
      return;
    }
    if (tool === "text") {
      const text = window.prompt("Label text")?.trim();
      if (text) setShapes((s) => [...s, { t: "text", c: color, at: p, text: text.slice(0, 80) }]);
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setDraft(tool === "pen" ? { t: "pen", c: color, pts: [p] } : { t: "arrow", c: color, a: p, b: p });
  };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = rel(e);
    setDraft(draft.t === "pen" ? { ...draft, pts: [...draft.pts, p] } : draft.t === "arrow" ? { ...draft, b: p } : draft);
  };
  const up = () => { if (draft) { setShapes((s) => [...s, draft]); setDraft(null); } };

  const save = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    try {
      cv.toBlob((b) => b && onSave(shapes, b), "image/jpeg", 0.85);
    } catch {
      window.alert("This unit picture can't be saved onto the photo. Remove it and try another unit.");
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="photo-annotator">
      <div className="flex items-center gap-1 p-2 bg-black/80 text-white flex-wrap">
        {([["pen", Pencil, "Pen"], ["arrow", ArrowUpRight, "Arrow"], ["text", Type, "Label"], ...(mockups.length ? [["unit", AirVent, "Unit mockup"]] : [])] as [AnnTool, typeof Pencil, string][]).map(([k, Icon, label]) => (
          <Button key={k} size="sm" variant={tool === k ? "secondary" : "ghost"} className="min-h-[44px] text-white" onClick={() => setTool(k)} aria-label={label}>
            <Icon className="h-4 w-4" />
          </Button>
        ))}
        {ANN_COLORS.map((c) => (
          <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => setColor(c)}
            className={cn("h-9 w-9 rounded-full border-2 mx-0.5", color === c ? "border-sky-400" : "border-white/40")} style={{ background: c }} />
        ))}
        <Button size="sm" variant="ghost" className="min-h-[44px] text-white" onClick={() => setShapes((s) => s.slice(0, -1))} aria-label="Undo"><Undo2 className="h-4 w-4" /></Button>
        <Button size="sm" variant="ghost" className="min-h-[44px] text-white" onClick={() => setShapes([])} aria-label="Clear"><Trash2 className="h-4 w-4" /></Button>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="min-h-[44px] text-white" onClick={onCancel}><X className="h-4 w-4 mr-1" />Cancel</Button>
          <Button size="sm" className="min-h-[44px]" onClick={save} disabled={!ready || saving} data-testid="annotator-save">
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}Save
          </Button>
        </div>
      </div>
      {presets?.length ? (
        <div className="flex gap-1.5 overflow-x-auto px-2 pb-2 bg-black/80" data-testid="annotator-presets">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => setPreset(preset === p ? null : p)}
              className={cn("v8-chip shrink-0 border-white/30 bg-transparent text-white", preset === p && "on")}>{p}</button>
          ))}
        </div>
      ) : null}
      {tool === "unit" && (
        <div className="bg-black/80 px-2 pb-2 space-y-2" data-testid="annotator-units">
          <div className="flex gap-1.5 overflow-x-auto">
            {mockups.map((m) => (
              <button key={m.url} type="button" onClick={() => { setUnit(unit?.url === m.url ? null : m); }}
                className={cn("v8-chip shrink-0 border-white/30 bg-transparent text-white flex items-center gap-1", unit?.url === m.url && "on")}>
                <img src={m.url} alt="" className="h-6 w-6 object-contain bg-white rounded" />{m.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/80">
            {unit ? `Tap the photo to place ${unit.label}` : selIdx != null && shapes[selIdx]?.t === "unit" ? "Tap to move the selected unit, or resize it:" : "Pick a unit, then tap the photo."}
          </p>
          {selIdx != null && shapes[selIdx]?.t === "unit" && (
            <div className="flex items-center gap-2">
              <input type="range" min={5} max={100} value={Math.round((shapes[selIdx] as any).w * 100)} aria-label="Unit size"
                onChange={(e) => { const w = Number(e.target.value) / 100; setShapes((s) => s.map((x, i) => (i === selIdx ? { ...(x as any), w } : x))); }}
                className="flex-1" />
              <Button size="sm" variant="ghost" className="text-white" onClick={() => { setShapes((s) => s.filter((_, i) => i !== selIdx)); setSelIdx(null); }}>Remove</Button>
            </div>
          )}
        </div>
      )}
      {preset && <p className="bg-black/80 px-3 pb-2 text-xs text-white/80">Tap the photo to place "{preset}"</p>}
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {failed ? <p className="text-white text-sm">Couldn't load the photo.</p> : (
          <canvas ref={canvasRef} className="max-w-full max-h-full touch-none" style={{ touchAction: "none" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        )}
      </div>
    </div>
  );
}
