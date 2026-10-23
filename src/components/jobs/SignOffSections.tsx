/**
 * Shared "after photos" + "sign-off" blocks for Done for today and Finish job (Johan 23 Oct 19:01):
 * photos and the tech's own sign-off are required; the client signature is optional.
 */
import { useRef } from "react";
import { Camera, ChevronDown, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import SignaturePad from "./SignaturePad";
import { cn } from "@/lib/utils";

export function AfterPhotosSection({ count, uploading, onFile, hint, testid = "after-photos" }: {
  count: number; uploading?: boolean; onFile: (f: File) => void | Promise<void>; hint?: string; testid?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className={cn("space-y-2 rounded-xl border-2 p-3", count ? "border-green-600/50" : "border-amber-400")} data-testid={testid}>
      <p className="flex items-center gap-2 text-base font-semibold"><Camera className="h-5 w-5" />After photos <span className="text-sm font-normal text-muted-foreground">(required)</span></p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" data-testid="after-photo-input"
        onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await onFile(f); }} />
      <Button type="button" variant={count ? "outline" : "default"} className="h-12 w-full text-base" disabled={uploading}
        onClick={() => input.current?.click()} data-testid="after-photo-take">
        {uploading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Camera className="mr-2 h-5 w-5" />}
        {count ? `Take another (${count} taken)` : "Take after photo"}
      </Button>
    </section>
  );
}

export function TechSignOffSection({ name, onName, confirmed, onConfirmed, at, what = "day" }: {
  name: string; onName: (v: string) => void; confirmed: boolean; onConfirmed: (v: boolean) => void; at: Date; what?: "day" | "job";
}) {
  const time = at.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" });
  return (
    <section className={cn("space-y-2 rounded-xl border-2 p-3", confirmed && name.trim().length >= 2 ? "border-green-600/50" : "border-border")} data-testid="tech-signoff">
      <p className="flex items-center gap-2 text-base font-semibold"><PenLine className="h-5 w-5" />Your sign-off <span className="text-sm font-normal text-muted-foreground">(required)</span></p>
      <Input value={name} onChange={(e) => onName(e.target.value)} className="h-11" placeholder="Your name" aria-label="Your name" data-testid="signoff-name" />
      <label className="flex items-start gap-3 rounded-lg bg-muted/50 p-2.5">
        <Checkbox data-no-min className="mt-0.5 h-6 w-6" checked={confirmed} onCheckedChange={(v) => onConfirmed(v === true)} data-testid="signoff-confirm" />
        <span className="text-sm">
          I confirm {what === "job" ? "the job is done" : "today's work is done"} and the after photos are taken.
          <span className="block text-xs text-muted-foreground">Signed {name.trim() || "—"} · {time}</span>
        </span>
      </label>
    </section>
  );
}

export function ClientSignatureSection({ open, onOpenChange, name, onName, signature, onSignature }: {
  open: boolean; onOpenChange: (v: boolean) => void; name: string; onName: (v: string) => void; signature: string | null; onSignature: (v: string | null) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-1 text-sm font-medium text-primary" data-testid="client-sign-open">
          Client signature (optional) <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2" data-testid="client-signature">
        <Label className="sr-only" htmlFor="client-name">Client name</Label>
        <Input id="client-name" value={name} onChange={(e) => onName(e.target.value)} placeholder="Client name" className="h-11" aria-label="Client name" />
        <SignaturePad value={signature} onChange={onSignature} />
      </CollapsibleContent>
    </Collapsible>
  );
}
