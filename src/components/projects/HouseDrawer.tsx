import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "react-router-dom";
import { docTypeLabel, openDocFile } from "@/components/supplierDocs/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatRand } from "@/utils/formatRand";
import { db } from "@/hooks/useProjectTracker";
import PanelErrorBoundary from "@/components/shared/PanelErrorBoundary";
import { houseStatus, houseReminders, primaryInvoice, phaseLabel, STATUS_META, OVERRIDE_OK, FIRST_FIT_STEP, daysSince, type HouseMoney, type HousePhotos, type HouseDocs, type ProjectHouse, type ProjectPhase, type HouseStatus } from "@/lib/projectTracker";

type Form = Pick<ProjectHouse, "house_no" | "phase_id" | "po_number" | "make" | "unit_sizes" | "units_ordered" | "units_received" | "ready_for_aircon" | "ready_for_aircon_at" | "status_override" | "notes">;
/** Form values straight from the house row, so the drawer opens on the first tap (no wait for an effect). */
export function formFromHouse(house: ProjectHouse): Form {
  const { house_no, phase_id, po_number, make, unit_sizes, units_ordered, units_received, ready_for_aircon, ready_for_aircon_at, status_override, notes } = house;
  return { house_no, phase_id, po_number, make, unit_sizes, units_ordered, units_received, ready_for_aircon, ready_for_aircon_at, status_override, notes };
}

function HouseDrawerInner({ house, money, photos, docs, showDocs, phases, onClose, onSaved }: { house: ProjectHouse | null; money?: HouseMoney; photos?: HousePhotos; docs?: HouseDocs; showDocs?: boolean; phases: ProjectPhase[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [f0, setF] = useState<Form | null>(() => (house ? formFromHouse(house) : null));
  const f = f0 ?? (house ? formFromHouse(house) : null);
  const [steps, setSteps] = useState(house?.steps || []);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!house) return;
    setF(formFromHouse(house));
    // Older houses were created before "First fit" existed: show it unticked; the row is only created when ticked + saved.
    setSteps(house.steps.some((s) => s.step_key === FIRST_FIT_STEP) ? house.steps
      : [{ id: `new-${FIRST_FIT_STEP}`, step_key: FIRST_FIT_STEP, label: "First fit (sleeves & drains)", rate: 0, sort_order: 0, done: false, paid: false }, ...house.steps]);
  }, [house]);
  if (!house || !f) return <Sheet open={false} onOpenChange={() => onClose()}><SheetContent /></Sheet>;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const computed = houseStatus({ ...house, ...f, status_override: null, steps }, money);

  const save = async () => {
    setSaving(true);
    const { error } = await db.from("project_houses").update(f).eq("id", house.id);
    let err = error;
    for (const s of steps) {
      if (!err && s.id.startsWith("new-") && s.done) {
        const r = await db.from("project_house_steps").insert({ house_id: house.id, company_id: (house as { company_id?: string }).company_id, step_key: s.step_key, label: s.label, rate: 0, sort_order: s.sort_order, done: true });
        err = r.error; continue;
      }
      const o = house.steps.find((x) => x.id === s.id);
      if (!err && o && o.done !== s.done) {
        const r = await db.from("project_house_steps").update({ done: s.done }).eq("id", s.id);
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
        <PanelErrorBoundary panelName={`House ${house.house_no} details`}>
        <div className="mt-4 space-y-4">
          {houseReminders({ ...house, steps, status_override: null }, money).map((x) => (
            <div key={x.kind} data-testid="drawer-reminder" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-100">🔔 {x.text}</div>))}
          <section className="rounded-xl border p-3">
            <div className="mb-2 text-sm font-semibold">Done ticks</div>
            {steps.map((s, i) => (
              <label key={s.id} className="flex items-center gap-2 py-1 text-sm">
                <Checkbox checked={s.done} onCheckedChange={(v) => setSteps(steps.map((x, j) => j === i ? { ...x, done: !!v } : x))} aria-label={s.label} /> {s.label}
              </label>))}
          </section>

          <section className="rounded-xl border p-3 text-sm">
            <div className="mb-1 font-semibold">Invoice (one per house)</div>
            {(() => { const pi = primaryInvoice(money); if (!pi || !money) return <div className="text-red-600">No invoice linked yet. After first fit: send the estimate to get the PO, then invoice 50% of this house's quote.</div>;
              const d = daysSince(pi.sent_at); return (<>
              <div className="flex justify-between"><span>Invoice</span><Link to={`/admin/invoices/${pi.id}`} className="font-semibold text-[#1590D6] hover:underline">{pi.number || "draft"} ↗</Link></div>
              <div className="flex justify-between"><span>Sent</span><span>{pi.sent_at ? `${pi.sent_at.slice(0, 10)} (${d} days ago)` : "not sent yet"}</span></div>
              <div className="flex justify-between"><span>Total</span><span>{formatRand(money.invoiced)}</span></div>
              <div className="flex justify-between"><span>Paid</span><span>{formatRand(money.paid)}</span></div>
              <div className="flex justify-between font-medium"><span>Balance</span><span>{formatRand(money.invoiced - money.paid)}</span></div>
              {money.invoiceCount > 1 && <div className="mt-1 text-xs text-muted-foreground">Also linked: {money.invoiceNumbers.join(", ")}</div>}
            </>); })()}
          </section>

          <section className="rounded-xl border p-3 text-sm" data-testid="drawer-photos">
            <div className="mb-1 font-semibold">Job photos</div>
            {photos?.jobs.length ? photos.jobs.map((j) => (
              <div key={j.id} className="flex justify-between gap-2"><span className="truncate">{j.title}</span>
                <Link to={`/admin/jobs/${j.id}#job-photos`} className="shrink-0 font-semibold text-[#1590D6] hover:underline">📷 {j.count} photo{j.count === 1 ? "" : "s"} ↗</Link></div>))
              : <div className="text-muted-foreground">No job found for this house yet (by invoice or a job titled "House {house.house_no}").</div>}
          </section>
          {showDocs && <section className="rounded-xl border p-3 text-sm" data-testid="drawer-supplier-docs">
            <div className="mb-1 font-semibold">Supplier documents <span className="text-xs font-normal text-muted-foreground">(private, office only)</span></div>
            {docs?.docs.length ? docs.docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 py-0.5">
                <span className="min-w-0 truncate"><span className="font-medium">{docTypeLabel(d.doc_type)} {d.doc_number || ""}</span>
                  <span className="text-xs text-muted-foreground"> · {[d.supplier, d.doc_date].filter(Boolean).join(" · ")}</span></span>
                {d.storage_path
                  ? <button type="button" data-testid="drawer-doc-open" className="shrink-0 font-semibold text-[#1590D6] hover:underline"
                      onClick={() => openDocFile(d.storage_path).catch((e) => toast({ title: "Could not open file", description: e?.message, variant: "destructive" }))}>Open ↗</button>
                  : <span className="shrink-0 text-xs text-muted-foreground">no file attached</span>}
              </div>))
              : <div className="text-muted-foreground">No supplier documents linked to this house's job(s).</div>}
          </section>}

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
              <SelectContent><SelectItem value="auto">Automatic ({STATUS_META[computed].label})</SelectItem>{OVERRIDE_OK.map((s) => <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>)}</SelectContent>
            </Select></div>
          <div><Label>Notes</Label><Textarea rows={3} value={f.notes || ""} onChange={(e) => set("notes", e.target.value || null)} /></div>
          <div className="flex justify-end gap-2 pb-4">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving} className="bg-[#1590D6] hover:bg-[#127bb8]">{saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Save</Button>
          </div>
        </div>
        </PanelErrorBoundary>
      </SheetContent>
    </Sheet>
  );
}

type DrawerProps = Parameters<typeof HouseDrawerInner>[0];
/** Error boundary: a bad house/doc row shows a message in the drawer instead of the tap silently doing nothing. */
export default function HouseDrawer(props: DrawerProps) {
  if (!props.house) return <HouseDrawerInner {...props} />;
  return (
    <PanelErrorBoundary key={props.house.id} panelName={`House ${props.house.house_no}`}>
      <HouseDrawerInner {...props} />
    </PanelErrorBoundary>
  );
}
