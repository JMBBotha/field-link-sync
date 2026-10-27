import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatRand } from "@/utils/formatRand";
import { db } from "@/hooks/useProjectTracker";
import { houseStatus, phaseLabel, stepsTotal, STATUS_META, type HouseMoney, type ProjectHouse, type ProjectPhase, type HouseStatus } from "@/lib/projectTracker";

type Form = Pick<ProjectHouse, "house_no" | "phase_id" | "po_number" | "make" | "unit_sizes" | "units_ordered" | "units_received" | "ready_for_aircon" | "ready_for_aircon_at" | "status_override" | "notes">;

export default function HouseDrawer({ house, money, phases, onClose, onSaved }: { house: ProjectHouse | null; money?: HouseMoney; phases: ProjectPhase[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f, setF] = useState<Form | null>(null);
  const [steps, setSteps] = useState(house?.steps || []);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!house) return;
    const { house_no, phase_id, po_number, make, unit_sizes, units_ordered, units_received, ready_for_aircon, ready_for_aircon_at, status_override, notes } = house;
    setF({ house_no, phase_id, po_number, make, unit_sizes, units_ordered, units_received, ready_for_aircon, ready_for_aircon_at, status_override, notes });
    setSteps(house.steps);
  }, [house]);
  if (!house || !f) return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const computed = houseStatus({ ...house, ...f, status_override: null, steps }, money);

  const save = async () => {
    setSaving(true);
    const { error } = await db.from("project_houses").update({ ...f, ready_for_aircon_at: f.ready_for_aircon ? (f.ready_for_aircon_at || new Date().toISOString().slice(0, 10)) : null }).eq("id", house.id);
    let err = error;
    for (const s of steps) {
      const o = house.steps.find((x) => x.id === s.id);
      if (!err && o && (o.done !== s.done || o.paid !== s.paid || Number(o.rate) !== Number(s.rate))) {
        const r = await db.from("project_house_steps").update({ done: s.done, paid: s.paid, rate: s.rate }).eq("id", s.id);
        err = r.error;
      }
    }
    setSaving(false);
    if (err) return toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    onSaved(); onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" data-testid="house-drawer">
        <SheetHeader>
          <SheetTitle>House {house.house_no}</SheetTitle>
          <SheetDescription>Status now: {STATUS_META[f.status_override || computed].label}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <section className="rounded-xl border p-3">
            <div className="mb-2 text-sm font-semibold">Steps</div>
            {steps.map((s, i) => (
              <div key={s.id} className="grid grid-cols-[1fr_auto_auto_5.5rem] items-center gap-2 py-1 text-sm">
                <span>{s.label}</span>
                <label className="flex items-center gap-1 text-xs"><Checkbox checked={s.done} onCheckedChange={(v) => setSteps(steps.map((x, j) => j === i ? { ...x, done: !!v } : x))} /> Done</label>
                <label className="flex items-center gap-1 text-xs"><Checkbox checked={s.paid} onCheckedChange={(v) => setSteps(steps.map((x, j) => j === i ? { ...x, paid: !!v } : x))} /> Paid</label>
                <Input type="number" className="h-8" value={s.rate} onChange={(e) => setSteps(steps.map((x, j) => j === i ? { ...x, rate: Number(e.target.value) } : x))} aria-label={`${s.label} rate`} />
              </div>))}
            <div className="mt-1 text-right text-xs text-muted-foreground">Labour total {formatRand(stepsTotal(steps))}</div>
          </section>

          <section className="rounded-xl border p-3 text-sm">
            <div className="mb-1 font-semibold">Money (from Field Lynk invoices)</div>
            {money ? (<>
              <div className="flex justify-between"><span>Invoiced</span><span>{formatRand(money.invoiced)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span>{formatRand(money.paid)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance</span><span>{formatRand(money.invoiced - money.paid)}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">Invoices: {money.invoiceNumbers.join(", ")}</div>
            </>) : <div className="text-red-600">No invoice linked to this house.</div>}
          </section>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div><div className="text-sm font-semibold">Ready for aircon</div><div className="text-xs text-muted-foreground">Turns the house red until units are installed</div></div>
            <Switch checked={f.ready_for_aircon} onCheckedChange={(v) => set("ready_for_aircon", v)} aria-label="Ready for aircon" />
          </div>
          {f.ready_for_aircon && <div><Label>Ready since</Label><Input type="date" value={f.ready_for_aircon_at || ""} onChange={(e) => set("ready_for_aircon_at", e.target.value || null)} /></div>}

          <div className="grid grid-cols-2 gap-3">
            <div><Label>House no</Label><Input value={f.house_no} onChange={(e) => set("house_no", e.target.value)} /></div>
            <div><Label>Phase</Label>
              <Select value={f.phase_id || "auto"} onValueChange={(v) => set("phase_id", v === "auto" ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="auto">By house number</SelectItem>{phases.map((p) => <SelectItem key={p.id} value={p.id}>{phaseLabel(p)}</SelectItem>)}</SelectContent>
              </Select></div>
            <div><Label>PO</Label><Input value={f.po_number || ""} onChange={(e) => set("po_number", e.target.value || null)} /></div>
            <div><Label>Make</Label><Input value={f.make || ""} onChange={(e) => set("make", e.target.value || null)} placeholder="Samsung" /></div>
            <div className="col-span-2"><Label>Unit sizes</Label><Input value={f.unit_sizes || ""} onChange={(e) => set("unit_sizes", e.target.value || null)} placeholder="24k + 3x12k" /></div>
            <div><Label>Units ordered</Label><Input type="number" min={0} value={f.units_ordered} onChange={(e) => set("units_ordered", Math.max(0, Number(e.target.value)))} /></div>
            <div><Label>Units received</Label><Input type="number" min={0} value={f.units_received} onChange={(e) => set("units_received", Math.max(0, Number(e.target.value)))} /></div>
          </div>
          <div><Label>Colour override</Label>
            <Select value={f.status_override || "auto"} onValueChange={(v) => set("status_override", v === "auto" ? null : (v as HouseStatus))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="auto">Automatic ({STATUS_META[computed].label})</SelectItem>{(Object.keys(STATUS_META) as HouseStatus[]).map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label>Notes</Label><Textarea rows={3} value={f.notes || ""} onChange={(e) => set("notes", e.target.value || null)} /></div>
          <div className="flex justify-end gap-2 pb-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-[#1590D6] hover:bg-[#127bb8]">{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
