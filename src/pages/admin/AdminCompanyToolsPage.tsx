import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import ToolDetail, { StatusPill } from "@/components/tools/ToolDetail";
import { rpc, uploadToolInvoice, useCanEditTools, useCompanyId, useTechs, useToolTypes, useTools, useToolsRefresh } from "@/components/tools/api";
import { STATUS, costText, filterTools, fmtDate, needsAttention, nextLabels, parseRands, prefixFor, rands, splitCents, summarise, type ToolFilter, type ToolStatus } from "@/lib/companyTools";

const card = "rounded-xl border bg-white p-4 shadow-sm";
const chip = "h-7 rounded-full border-0 bg-slate-100 px-3 text-xs font-semibold";

/** Company tools register (Johan 3 Nov): equipment techs use — not stock, never on a job. Admin/owner only edit; RLS enforces it. */
export default function AdminCompanyToolsPage() {
  const [sp, setSp] = useSearchParams();
  const { data: companyId } = useCompanyId();
  const { data: canEdit = false } = useCanEditTools(companyId);
  const { data: types = [] } = useToolTypes();
  const { data: tools = [], isLoading, error } = useTools();
  const { data: techs = [] } = useTechs(companyId);
  const [f, setF] = useState<ToolFilter>({ status: "active" });
  const [adding, setAdding] = useState(false);
  const openId = sp.get("tool");
  const open = tools.find((t) => t.id === openId) ?? null;
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const list = useMemo(() => filterTools(tools, f), [tools, f]);
  const stats = useMemo(() => summarise(types, tools), [types, tools]);
  const shown = stats.filter((s) => s.owned || s.ended).concat(stats.filter((s) => !s.owned && !s.ended)).slice(0, 3);
  const attention = needsAttention(tools);
  const setOpen = (id: string | null) => { const n = new URLSearchParams(sp); if (id) n.set("tool", id); else n.delete("tool"); setSp(n, { replace: true }); };

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6" data-testid="company-tools-page">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h1 className="text-2xl font-bold">Company tools</h1><p className="text-sm text-muted-foreground">Equipment techs use — not stock, never on a job</p></div>
        {canEdit && <Button className="bg-[#C2410C] hover:bg-[#a3370a]" onClick={() => setAdding(true)}>+ Add tool</Button>}
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="tool-summary">
        {shown.map((s, i) => (
          <button key={s.type_id} onClick={() => setF({ ...f, type: f.type === s.type_id ? undefined : s.type_id })}
            className={`${card} text-left ${i === 0 || f.type === s.type_id ? "border-t-4 border-t-[#C2410C]" : ""}`}>
            <div className="text-sm text-muted-foreground">{s.name}</div><div className="text-2xl font-bold">{s.owned}{s.owned ? " owned" : ""}</div>
            <div className="text-xs text-muted-foreground">{s.in_use} in use · {s.in_store} in store</div>
            <div className="text-xs text-muted-foreground">Avg life: {s.avg_life_days == null ? "—" : `${s.avg_life_days} days`} · {s.replaced_12m} replaced/yr</div>
            <div className="text-xs text-muted-foreground">Spend: <b>{s.tbc && !s.spend_cents ? "TBC" : `${rands(s.spend_cents)}${s.tbc ? " (TBC)" : ""}`}</b></div>
          </button>
        ))}
        <button className={`${card} border-orange-100 bg-orange-50 text-left`} onClick={() => setF({ status: "all" })}>
          <div className="text-sm text-muted-foreground">Needs attention</div><div className="text-2xl font-bold text-[#C2410C]">{attention.length}</div>
          <div className="text-xs text-muted-foreground">broken · lost · no invoice</div></button>
      </div>
      <div className={card}>
        <div className="mb-2 flex flex-wrap gap-2">
          <select aria-label="Type" className={chip} value={f.type ?? ""} onChange={(e) => setF({ ...f, type: e.target.value || undefined })}><option value="">All types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select aria-label="Status" className={chip} value={f.status ?? "active"} onChange={(e) => setF({ ...f, status: e.target.value as ToolFilter["status"] })}>
            <option value="active">All status</option>{(Object.keys(STATUS) as ToolStatus[]).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}<option value="all">Show retired too</option></select>
          <select aria-label="Tech" className={chip} value={f.tech ?? ""} onChange={(e) => setF({ ...f, tech: e.target.value || undefined })}><option value="">All techs</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}</select>
          <Input className="h-7 w-40 text-xs" placeholder="Search label / name" value={f.q ?? ""} onChange={(e) => setF({ ...f, q: e.target.value })} />
        </div>
        {error ? <p className="py-6 text-center text-sm text-muted-foreground">Company tools aren't switched on yet.</p>
          : isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          : !list.length ? <p className="py-6 text-center text-sm text-muted-foreground">No tools yet{canEdit ? " — use + Add tool" : ""}.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm" data-testid="tools-table">
            <thead className="text-left text-xs uppercase text-muted-foreground"><tr>{["Tool", "Type", "Supplier", "Bought", "Cost", "Invoice", "With", "Status"].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{list.map((t) => (
              <tr key={t.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setOpen(t.id)}>
                <td className="px-2 py-2.5 font-semibold">{t.label} <span className="font-normal text-muted-foreground">{t.name}</span></td>
                <td className="px-2">{typeOf(t.tool_type_id)?.name ?? "—"}</td><td className="px-2">{t.supplier_name ?? "—"}</td><td className="px-2">{fmtDate(t.purchase_date)}</td>
                <td className="px-2">{costText(t)}</td>
                <td className="px-2">{t.invoice_path ? "✓" : <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">To attach</span>}</td>
                <td className="px-2">{t.assigned_tech_name ?? "—"}</td><td className="px-2"><StatusPill s={t.status} /></td>
              </tr>))}</tbody></table></div>)}
        <p className="mt-2 text-xs text-muted-foreground">Retired, broken and lost tools stay in history (filter “Show retired too”). Editing: admin/owner only.</p>
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto bg-slate-50 sm:max-w-md">{open && <ToolDetail tool={open} type={typeOf(open.tool_type_id)} admin={canEdit} techs={techs} companyId={companyId} />}</SheetContent>
      </Sheet>
      {companyId && <AddToolsDialog open={adding} onClose={() => setAdding(false)} companyId={companyId} types={types} existing={tools.map((t) => t.label)} />}
    </div>
  );
}

function AddToolsDialog({ open, onClose, companyId, types, existing }: { open: boolean; onClose: () => void; companyId: string; types: { id: string; name: string }[]; existing: string[] }) {
  const refresh = useToolsRefresh();
  const [type, setType] = useState(""); const [newType, setNewType] = useState(""); const [name, setName] = useState("");
  const [qty, setQty] = useState(1); const [prefix, setPrefix] = useState(""); const [supplier, setSupplier] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [total, setTotal] = useState(""); const [tbc, setTbc] = useState(false);
  const [notes, setNotes] = useState(""); const [file, setFile] = useState<File | null>(null); const [busy, setBusy] = useState(false);
  const typeName = types.find((t) => t.id === type)?.name ?? newType;
  const pre = prefix || prefixFor(typeName || "Tool");
  const labels = nextLabels(pre, existing, Math.max(1, Math.min(50, qty)));
  const cents = parseRands(total);
  const parts = cents != null ? splitCents(cents, labels.length) : [];
  const save = async () => {
    setBusy(true);
    try {
      const typeId = type || (await rpc("add_tool_type", { p_company: companyId, p_name: newType.trim() }));
      const ids = (await rpc("add_tools", { p_company: companyId, p_type: typeId, p_name: name.trim() || typeName, p_labels: labels, p_supplier_name: supplier || null,
        p_purchase_date: date || null, p_total_cents: cents, p_cost_tbc: tbc || cents == null, p_notes: notes || null })) as string[] | null;
      if (file && ids?.length) await uploadToolInvoice(companyId, ids, file);
      toast.success(`${labels.length} tool${labels.length > 1 ? "s" : ""} added`); await refresh(); onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Add tools</DialogTitle></DialogHeader>
        <div className="grid gap-2 text-sm">
          <label>Type<select className="mt-1 h-10 w-full rounded-md border px-2" value={type} onChange={(e) => setType(e.target.value)}><option value="">+ New type…</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          {!type && <Input placeholder="New tool type, e.g. Nitrogen regulator" value={newType} onChange={(e) => setNewType(e.target.value)} />}
          <Input placeholder={`Name (default: ${typeName || "type name"})`} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2"><label>How many<Input type="number" min={1} max={50} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} /></label>
            <label>Label prefix<Input value={pre} onChange={(e) => setPrefix(e.target.value.toUpperCase())} /></label></div>
          <p className="text-xs text-muted-foreground" data-testid="label-preview">Labels: {labels.join(", ")}</p>
          <div className="grid grid-cols-2 gap-2"><Input placeholder="Supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} /><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="flex items-center gap-2"><Input placeholder="Total cost (R), blank if unknown" inputMode="decimal" value={total} onChange={(e) => setTotal(e.target.value)} />
            <label className="flex shrink-0 items-center gap-1"><input type="checkbox" checked={tbc} onChange={(e) => setTbc(e.target.checked)} /> To be confirmed</label></div>
          {parts.length > 1 && <p className="text-xs text-muted-foreground">Split per tool: {parts.map(rands).join(" · ")}</p>}
          <Input placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <label className="text-xs">Invoice (optional, private)<input type="file" accept="application/pdf,image/*" className="mt-1 block" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <div className="mt-2 grid grid-cols-2 gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button className="bg-[#C2410C] hover:bg-[#a3370a]" disabled={busy || (!type && !newType.trim()) || !labels.length} onClick={save}>Add {labels.length}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
