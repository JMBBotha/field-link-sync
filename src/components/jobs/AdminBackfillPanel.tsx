/**
 * Johan 30 Oct (t1929u): admin records a tech's visit, photos, unit model/serial numbers and materials on his behalf,
 * backdated. Server-side admin only (admin_backfill_* RPCs + _backfill_guard trigger). Backdated entries send no client
 * messages or rep alerts. Every record shows "Added by <admin> for <tech>".
 */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Camera, ImagePlus, Loader2, Package, Trash2, Wrench } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { mapDispatchCandidates } from "@/lib/teamGroups";
import { signedPhotoUrl } from "@/lib/photoUrls";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Mode = "visit" | "photos" | "unit" | "material" | null;
type Props = { jobId: string; leadId: string | null; companyId: string; defaultTechId?: string | null };

const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);
const today = () => format(new Date(), "yyyy-MM-dd");
const sast = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

export function OnBehalfLabel({ by, tech }: { by?: string | null; tech?: string | null }) {
  return <span className="inline-block rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[11px] font-medium text-[#B45309]" data-testid="on-behalf-label">Added by {(by || "admin").split(" ")[0]} for {(tech || "tech").split(" ")[0]}</span>;
}

export default function AdminBackfillPanel({ jobId, leadId, companyId, defaultTechId }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [tech, setTech] = useState<string>(defaultTechId || "");
  const [date, setDate] = useState(today());
  const [arrive, setArrive] = useState("08:00");
  const [leave, setLeave] = useState("");
  const [completed, setCompleted] = useState(false);
  const [note, setNote] = useState("");
  const [photoType, setPhotoType] = useState<"before" | "after" | "other">("before");
  const [unit, setUnit] = useState({ position: "indoor", label: "", brand: "", model: "", serial: "" });
  const [mat, setMat] = useState({ item: "", qty: "1", stock: "", draw: true });
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const techId = tech || defaultTechId || "";

  const { data: techs = [] } = useQuery({
    queryKey: ["dispatch-techs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dispatchable_technicians" as any, { _company_id: companyId });
      if (error) throw error;
      return mapDispatchCandidates(data as any);
    },
  });
  const { data: stock = [] } = useQuery({
    queryKey: ["backfill-stock", companyId],
    enabled: mode === "material",
    queryFn: async () => {
      const { data } = await (supabase.from("cf_stock_items" as any) as any).select("id, item, model_code, qty_on_hand").eq("company_id", companyId).eq("active", true).order("item");
      return (data ?? []) as { id: string; item: string; model_code: string | null; qty_on_hand: number }[];
    },
  });
  const list = useQuery({
    queryKey: ["backfill-list", jobId],
    queryFn: async () => {
      const { data, error } = await rpc("admin_backfill_list", { p_job: jobId });
      if (error) throw error;
      return data as { visits: any[]; units: any[]; materials: any[] };
    },
  });
  const photos = useQuery({
    queryKey: ["backfill-photos", leadId],
    enabled: !!leadId,
    queryFn: async () => {
      const { data } = await (supabase.from("job_photos") as any).select("id, storage_path, photo_type, occurred_at, entered_by, on_behalf_of").eq("lead_id", leadId).not("on_behalf_of", "is", null).order("occurred_at", { ascending: false });
      const rows = (data ?? []) as any[];
      const ids = Array.from(new Set(rows.flatMap((r) => [r.entered_by, r.on_behalf_of]).filter(Boolean)));
      const { data: ps } = ids.length ? await supabase.from("profiles").select("id, full_name").in("id", ids) : { data: [] as any[] };
      const name = (id: string) => (ps as any[])?.find((p) => p.id === id)?.full_name;
      return Promise.all(rows.map(async (r) => ({ ...r, url: await signedPhotoUrl(r.storage_path), by: name(r.entered_by), tech: name(r.on_behalf_of) })));
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["backfill-list", jobId] });
    qc.invalidateQueries({ queryKey: ["backfill-photos", leadId] });
    qc.invalidateQueries({ queryKey: ["job-detail", jobId] });
    qc.invalidateQueries({ queryKey: ["site-photos", leadId] });
    qc.invalidateQueries({ queryKey: ["photos", leadId] });
  };
  const occurred = () => new Date(`${date}T${arrive || "12:00"}:00+02:00`).toISOString();
  const run = async (fn: () => Promise<void>, ok: string) => {
    if (!techId) { toast({ title: "Pick the tech first", variant: "destructive" }); return; }
    setBusy(true);
    try { await fn(); toast({ title: ok }); refresh(); setMode(null); }
    catch (e: any) { toast({ title: "Couldn't save", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const saveVisit = () => run(async () => {
    const { error } = await rpc("admin_backfill_visit", { p_job: jobId, p_tech: techId, p_date: date, p_arrive: arrive, p_leave: leave || null, p_completed: completed, p_note: note || null });
    if (error) throw error;
  }, completed ? "Visit recorded and job marked completed" : "Visit recorded");

  const uploadPhotos = (files: FileList | null) => {
    if (!files?.length || !leadId) return;
    void run(async () => {
      for (const f of Array.from(files)) {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${leadId}/backfill-${crypto.randomUUID()}.${ext}`;
        const up = await supabase.storage.from("job-photos").upload(path, f, { contentType: f.type || "image/jpeg" });
        if (up.error) throw up.error;
        const { error } = await (supabase.from("job_photos") as any).insert({ lead_id: leadId, storage_path: path, uploaded_by: user?.id, photo_type: photoType, on_behalf_of: techId, occurred_at: occurred(), caption: `${photoType} photo` });
        if (error) { await supabase.storage.from("job-photos").remove([path]); throw error; }
      }
    }, `${files.length} photo${files.length > 1 ? "s" : ""} added`);
  };

  const saveUnit = () => run(async () => {
    const { error } = await rpc("admin_backfill_unit", { p_job: jobId, p_tech: techId, p_position: unit.position, p_brand: unit.brand, p_model: unit.model, p_serial: unit.serial, p_label: unit.label || null, p_occurred: occurred() });
    if (error) throw error;
    setUnit((u) => ({ ...u, model: "", serial: "" }));
  }, "Unit details saved");

  const saveMaterial = () => run(async () => {
    const { data, error } = await rpc("admin_backfill_material", { p_job: jobId, p_tech: techId, p_item: mat.item, p_qty: Number(mat.qty), p_stock_item: mat.stock || null, p_draw: mat.draw, p_occurred: occurred() });
    if (error) throw error;
    if ((data as any)?.note) toast({ title: (data as any).note });
    setMat({ item: "", qty: "1", stock: "", draw: true });
  }, "Material recorded");

  const remove = async (kind: string, id: string) => {
    if (!window.confirm("Remove this record?")) return;
    const { error } = await rpc("admin_backfill_delete", { p_kind: kind, p_id: id });
    if (error) toast({ title: "Couldn't remove", description: error.message, variant: "destructive" }); else refresh();
  };

  const d = list.data;
  const techSelect = (
    <label className="block text-sm">
      <span className="text-muted-foreground">Tech</span>
      <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" value={techId} onChange={(e) => setTech(e.target.value)} data-testid="backfill-tech">
        <option value="">Choose tech…</option>
        {techs.map((t: any) => <option key={t.id} value={t.id}>{t.full_name || "Technician"}</option>)}
      </select>
    </label>
  );
  const dateRow = (
    <label className="block text-sm"><span className="text-muted-foreground">Date it happened</span>
      <Input type="date" className="mt-1 h-11" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></label>
  );
  const btn = "h-11 justify-start gap-2 rounded-xl";

  return (
    <div className="space-y-3" data-testid="admin-backfill">
      <div>
        <h3 className="font-semibold text-sm">Add on behalf of tech</h3>
        <p className="text-xs text-muted-foreground">For work the tech didn't log in the app. Backdated entries don't message the client or alert reps.</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className={btn} onClick={() => setMode("visit")} data-testid="backfill-visit-btn"><CalendarClock className="h-4 w-4 text-[#1590D6]" />Record visit</Button>
        <Button variant="outline" className={btn} onClick={() => setMode("photos")} disabled={!leadId}><Camera className="h-4 w-4 text-[#1590D6]" />Add photos</Button>
        <Button variant="outline" className={btn} onClick={() => setMode("unit")}><Wrench className="h-4 w-4 text-[#1590D6]" />Model &amp; serial</Button>
        <Button variant="outline" className={btn} onClick={() => setMode("material")}><Package className="h-4 w-4 text-[#1590D6]" />Materials used</Button>
      </div>

      {!!d?.visits?.length && (
        <div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visits</p>
          {d.visits.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{v.tech || "Tech"} · {format(new Date(v.work_date), "EEE d MMM")} · {String(v.start || "").slice(0, 5)}{v.end ? `–${String(v.end).slice(0, 5)}` : ""}{v.hours ? ` (${v.hours} h)` : ""}</p>
                {v.on_behalf && <OnBehalfLabel by={v.by} tech={v.tech} />}
              </div>
              {v.on_behalf && <Button size="icon" variant="ghost" aria-label="Remove visit" onClick={() => remove("visit", v.id)}><Trash2 className="h-4 w-4" /></Button>}
            </div>))}
        </div>)}
      {!!d?.units?.length && (
        <div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Units</p>
          {d.units.map((u) => (
            <div key={u.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">
              <div className="min-w-0"><p className="font-medium capitalize">{[u.label, u.position].filter(Boolean).join(" · ")}{u.brand ? ` · ${u.brand}` : ""}</p>
                <p className="text-xs text-muted-foreground break-all">Model {u.model || "—"} · Serial {u.serial || "—"}</p><OnBehalfLabel by={u.by} tech={u.tech} /></div>
              <Button size="icon" variant="ghost" aria-label="Remove unit" onClick={() => remove("unit", u.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>))}
        </div>)}
      {!!d?.materials?.length && (
        <div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Materials</p>
          {d.materials.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl border p-2.5 text-sm">
              <div className="min-w-0"><p className="font-medium">{m.qty} × {m.item}</p>
                <p className="text-xs text-muted-foreground">{Number(m.drawn_qty) > 0 ? `${m.drawn_qty} drawn from stock` : m.note || "Not drawn from stock"}</p><OnBehalfLabel by={m.by} tech={m.tech} /></div>
              <Button size="icon" variant="ghost" aria-label="Remove material" onClick={() => remove("material", m.id)}><Trash2 className="h-4 w-4" /></Button>
            </div>))}
        </div>)}
      {!!photos.data?.length && (
        <div className="space-y-1.5"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos added for tech</p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.data.map((p: any) => (
              <div key={p.id} className="space-y-1">
                <img src={p.url} alt={`${p.photo_type} photo`} className="aspect-square w-full rounded-lg object-cover" />
                <p className="text-[11px] capitalize text-muted-foreground">{p.photo_type} · {sast(p.occurred_at)}</p>
                <OnBehalfLabel by={p.by} tech={p.tech} />
              </div>))}
          </div>
        </div>)}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-md">
          <DialogHeader><DialogTitle>{mode === "visit" ? "Record visit" : mode === "photos" ? "Add photos" : mode === "unit" ? "Model & serial numbers" : "Materials used"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {techSelect}
            {dateRow}
            {mode === "visit" && (<>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Arrived</span><TimeInput24 className="mt-1" value={arrive} onChange={(e) => setArrive(e.target.value)} /></label>
                <label className="text-sm"><span className="mb-1 block text-muted-foreground">Left</span><TimeInput24 className="mt-1" value={leave} onChange={(e) => setLeave(e.target.value)} /></label>
              </div>
              <label className="flex items-center justify-between rounded-xl border p-3 text-sm"><span>Job was completed</span><Switch checked={completed} onCheckedChange={setCompleted} /></label>
              <Input placeholder="Note (optional)" className="h-11" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button className="h-11 w-full bg-[#1590D6] hover:bg-[#0F7BBB]" disabled={busy || !arrive} onClick={saveVisit} data-testid="backfill-visit-save">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save visit</Button>
            </>)}
            {mode === "photos" && (<>
              <label className="block text-sm"><span className="mb-1 block text-muted-foreground">Time (for the photo date)</span><TimeInput24 className="mt-1" value={arrive} onChange={(e) => setArrive(e.target.value)} /></label>
              <div className="grid grid-cols-3 gap-2">
                {(["before", "after", "other"] as const).map((t) => (
                  <Button key={t} type="button" variant={photoType === t ? "default" : "outline"} className={`h-10 capitalize ${photoType === t ? "bg-[#0F2A44]" : ""}`} onClick={() => setPhotoType(t)}>{t}</Button>))}
              </div>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { uploadPhotos(e.target.files); e.target.value = ""; }} />
              <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { uploadPhotos(e.target.files); e.target.value = ""; }} />
              <div className="grid grid-cols-2 gap-2">
                <Button className="h-11 bg-[#1590D6] hover:bg-[#0F7BBB]" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}From photos</Button>
                <Button variant="outline" className="h-11" disabled={busy} onClick={() => camRef.current?.click()}><Camera className="mr-2 h-4 w-4" />Camera</Button>
              </div>
            </>)}
            {mode === "unit" && (<>
              <div className="grid grid-cols-3 gap-2">
                {(["indoor", "outdoor", "other"] as const).map((t) => (
                  <Button key={t} type="button" variant={unit.position === t ? "default" : "outline"} className={`h-10 capitalize ${unit.position === t ? "bg-[#0F2A44]" : ""}`} onClick={() => setUnit({ ...unit, position: t })}>{t}</Button>))}
              </div>
              <Input placeholder="Room / unit (e.g. Lounge)" className="h-11" value={unit.label} onChange={(e) => setUnit({ ...unit, label: e.target.value })} />
              <Input placeholder="Brand" className="h-11" value={unit.brand} onChange={(e) => setUnit({ ...unit, brand: e.target.value })} />
              <Input placeholder="Model number" className="h-11" value={unit.model} onChange={(e) => setUnit({ ...unit, model: e.target.value })} />
              <Input placeholder="Serial number" className="h-11" value={unit.serial} onChange={(e) => setUnit({ ...unit, serial: e.target.value })} />
              <p className="text-xs text-muted-foreground">Also saved to the client's equipment list.</p>
              <Button className="h-11 w-full bg-[#1590D6] hover:bg-[#0F7BBB]" disabled={busy || (!unit.model && !unit.serial)} onClick={saveUnit}>Save unit</Button>
            </>)}
            {mode === "material" && (<>
              <label className="block text-sm"><span className="text-muted-foreground">From stock (optional)</span>
                <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" value={mat.stock} onChange={(e) => { const s = stock.find((x) => x.id === e.target.value); setMat({ ...mat, stock: e.target.value, item: s ? s.item : mat.item }); }}>
                  <option value="">Not a stock item</option>
                  {stock.map((s) => <option key={s.id} value={s.id}>{s.item}{s.model_code ? ` (${s.model_code})` : ""} · {s.qty_on_hand} on hand</option>)}
                </select></label>
              <Input placeholder="Item" className="h-11" value={mat.item} onChange={(e) => setMat({ ...mat, item: e.target.value })} />
              <Input type="number" inputMode="decimal" min="0" step="any" placeholder="Qty" className="h-11" value={mat.qty} onChange={(e) => setMat({ ...mat, qty: e.target.value })} />
              {mat.stock && <label className="flex items-center justify-between rounded-xl border p-3 text-sm"><span>Take it off stock</span><Switch checked={mat.draw} onCheckedChange={(v) => setMat({ ...mat, draw: v })} /></label>}
              <Button className="h-11 w-full bg-[#1590D6] hover:bg-[#0F7BBB]" disabled={busy || !mat.item || !(Number(mat.qty) > 0)} onClick={saveMaterial}>Save material</Button>
            </>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
