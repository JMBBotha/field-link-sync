import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Pencil, Type, Undo2, Trash2, X, Check, Loader2 } from "lucide-react";
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
}

/** Full-screen plain-canvas annotator: pen, arrow, text label, red/yellow/white, undo, clear, cancel, save. */
export default function PhotoAnnotator({ imageUrl, initial, saving, onCancel, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [shapes, setShapes] = useState<AnnShape[]>(initial);
  const [draft, setDraft] = useState<AnnShape | null>(null);
  const [tool, setTool] = useState<AnnTool>("pen");
  const [color, setColor] = useState<AnnColor>("#ef4444");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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
    drawShapes(ctx, draft ? [...shapes, draft] : shapes, cv.width, cv.height);
  }, [shapes, draft, ready]);

  const rel = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const down = (e: React.PointerEvent) => {
    if (!ready) return;
    const p = rel(e);
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
    cv.toBlob((b) => b && onSave(shapes, b), "image/jpeg", 0.85);
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" data-testid="photo-annotator">
      <div className="flex items-center gap-1 p-2 bg-black/80 text-white flex-wrap">
        {([["pen", Pencil, "Pen"], ["arrow", ArrowUpRight, "Arrow"], ["text", Type, "Label"]] as const).map(([k, Icon, label]) => (
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
      <div className="flex-1 min-h-0 flex items-center justify-center p-2">
        {failed ? <p className="text-white text-sm">Couldn't load the photo.</p> : (
          <canvas ref={canvasRef} className="max-w-full max-h-full touch-none" style={{ touchAction: "none" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        )}
      </div>
    </div>
  );
}
