import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Upload, AirVent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { saveUnitMockup, type MockupUnit } from "@/lib/unitMockups";

/** One row per quoted unit: upload a picture of it; the plain background is cut away so it can be placed on wall photos. */
export default function UnitMockupUploads({ leadId, units }: { leadId: string; units: MockupUnit[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState<MockupUnit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const onFile = async (file?: File) => {
    if (!file || !target) return;
    if (!file.type.startsWith("image/")) { toast({ title: "Pick a picture file", variant: "destructive" }); return; }
    if (file.size > 15 * 1024 * 1024) { toast({ title: "Picture is too big", description: "Max 15 MB.", variant: "destructive" }); return; }
    setBusy(target.modelKey);
    try {
      await saveUnitMockup(target.modelKey, target.label, file);
      qc.invalidateQueries({ queryKey: ["lead-unit-mockups", leadId] });
      toast({ title: "Mockup picture saved", description: `${target.label} can now be placed on photos.` });
    } catch (e: any) {
      toast({ title: "Couldn't save the picture", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); setTarget(null); }
  };

  return (
    <div className="rounded-lg border p-2 space-y-2" data-testid="unit-mockup-uploads">
      <p className="text-xs font-semibold flex items-center gap-1"><AirVent className="h-3.5 w-3.5" />Unit mockup pictures</p>
      <p className="text-xs text-muted-foreground">Upload a picture of each unit on a white or plain background — we cut the background away so it sits on the wall photo.</p>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      {units.map((u) => (
        <div key={u.modelKey} className="flex items-center gap-2">
          <div className="h-10 w-14 shrink-0 rounded bg-muted flex items-center justify-center overflow-hidden">
            {u.url ? <img src={u.url} alt="" className="max-h-full max-w-full object-contain" /> : <AirVent className="h-4 w-4 text-muted-foreground" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm truncate">{u.label}</p>
            <p className="text-xs text-muted-foreground">{u.own ? "Your picture" : u.url ? "Catalogue photo" : "No picture yet"}</p>
          </div>
          <Button size="sm" variant="outline" className="min-h-[40px]" disabled={!!busy}
            onClick={() => { setTarget(u); inputRef.current?.click(); }} data-testid="unit-mockup-upload">
            {busy === u.modelKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Upload className="h-4 w-4 mr-1" />{u.own ? "Replace" : "Upload"}</>}
          </Button>
        </div>
      ))}
    </div>
  );
}
