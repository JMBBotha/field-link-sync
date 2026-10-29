import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { createRequest, REQUEST_TYPES, type RequestType } from "@/lib/requests";

/** "+ Add request": type is required (no untyped manual requests). Admin type stays an office task; others create a lead as before. */
export default function AddRequestDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: () => void }) {
  const [type, setType] = useState<RequestType | null>(null);
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [area, setArea] = useState(""); const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => { setType(null); setName(""); setPhone(""); setArea(""); setText(""); };
  const save = async () => {
    if (!type) return toast.error("Pick what this request is");
    if (!name.trim()) return toast.error("Add the client's name");
    setBusy(true);
    try {
      const r = await createRequest({ type, name, phone, area, text });
      if (r.ok) { toast.success("Request added"); reset(); onOpenChange(false); onCreated?.(); } else toast.error(r.message || "Could not add");
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const field = "min-h-12 w-full rounded-xl border px-3 text-[16px]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Add request</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Request type">
            {REQUEST_TYPES.map((t) => (
              <button key={t.v} role="radio" aria-checked={type === t.v} onClick={() => setType(t.v)}
                className={cn("min-h-14 rounded-xl border-2 px-3 text-left", type === t.v ? "border-[#1590D6] bg-[#E3F2FD]" : "")}>
                <div className="text-[15px] font-semibold">{t.l}</div><div className="text-[12px] text-muted-foreground">{t.hint}</div>
              </button>
            ))}
          </div>
          <input className={field} placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={field} placeholder="Phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className={field} placeholder="Area" value={area} onChange={(e) => setArea(e.target.value)} />
          <textarea className="min-h-24 w-full rounded-xl border p-3 text-[16px]" placeholder="What do they need?" value={text} onChange={(e) => setText(e.target.value)} />
          <button disabled={busy || !type} onClick={save} className="min-h-12 w-full rounded-xl bg-[#1590D6] text-[16px] font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Add request"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
