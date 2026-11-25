import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { sameOriginAsset } from "@/lib/captureImages";

/** Staff photo on a unit line. Print and the client PDF keep the image and hide the buttons. */
export default function UnitLinePhoto({
  name,
  imageUrl,
  pending,
  needsReview,
  onKeep,
  onReject,
  onReplace,
}: {
  name: string;
  imageUrl?: string | null;
  pending?: boolean;
  needsReview?: boolean;
  onKeep?: () => void;
  onReject?: () => void;
  onReplace?: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const src = imageUrl ? sameOriginAsset(imageUrl) ?? undefined : undefined;
  return (
    <div className="mt-0.5 flex shrink-0 flex-col items-start gap-1" data-testid="unit-line-photo">
      {src ? (
        <img src={src} alt={name} className="h-10 w-10 rounded border border-slate-200 bg-white object-contain" loading="lazy" />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-[9px] leading-tight text-slate-500">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "No photo"}
        </div>
      )}
      <div className="flex max-w-[9.5rem] flex-wrap gap-1 print:hidden" data-pdf-hide data-html2canvas-ignore>
        {pending && !src && <span className="text-[10px] text-slate-500">Finding photo…</span>}
        {needsReview && src && <span className="text-[10px] font-semibold text-amber-800">Check this photo</span>}
        {needsReview && src && onKeep && (
          <button type="button" className="text-[10px] font-semibold text-[#C2410C] underline" data-testid="keep-product-image" onClick={(event) => { event.stopPropagation(); onKeep(); }}>Keep</button>
        )}
        {onReplace && (!src || needsReview) && (
          <button type="button" className="text-[10px] font-semibold text-slate-600 underline" data-testid="replace-product-image" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>
            {src ? "Replace" : "Add photo"}
          </button>
        )}
        {needsReview && src && onReject && (
          <button type="button" className="text-[10px] font-semibold text-red-700 underline" data-testid="reject-product-image" onClick={(event) => { event.stopPropagation(); onReject(); }}>Reject</button>
        )}
      </div>
      {onReplace && (
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) onReplace(file);
          }}
        />
      )}
    </div>
  );
}
