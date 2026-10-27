import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Map as MapIcon, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatRand } from "@/utils/formatRand";
import { useToast } from "@/hooks/use-toast";
import { useProjectDetail, useInvalidateProject, clientName, db } from "@/hooks/useProjectTracker";
import { houseStatus, phaseFor, phaseLabel, STATUS_META, STEP_SHORT, DEFAULT_STEPS, type HouseStatus, type ProjectHouse } from "@/lib/projectTracker";
import HouseDrawer from "./HouseDrawer";
import PhaseEditor from "./PhaseEditor";

const ORDER: HouseStatus[] = ["done", "in_progress", "due", "not_started"];

export default function ProjectView({ projectId, backTo }: { projectId: string; backTo?: { to: string; label: string } }) {
  const { data, isLoading, error } = useProjectDetail(projectId);
  const invalidate = useInvalidateProject();
  const { toast } = useToast();
  const [tab, setTab] = useState<string | null>(null);
  const [openHouse, setOpenHouse] = useState<string | null>(null);
  const [filter, setFilter] = useState<HouseStatus | null>(null);
  const [newNo, setNewNo] = useState("");
  const [adding, setAdding] = useState(false);

  const phases = useMemo(() => [...(data?.phases || [])].sort((a, b) => a.sort_order - b.sort_order), [data]);
  const activeTab = tab ?? phases[0]?.id ?? "all";
  const enriched = useMemo(() => (data?.houses || []).map((h) => ({ h, phase: phaseFor(h, phases), status: houseStatus(h, data?.money[h.id]), money: data?.money[h.id] })), [data, phases]);
  const inTab = enriched.filter((e) => activeTab === "all" || e.phase === activeTab);
  const shown = filter ? inTab.filter((e) => e.status === filter) : inTab;
  const counts = ORDER.reduce((a, s) => ({ ...a, [s]: inTab.filter((e) => e.status === s).length }), {} as Record<HouseStatus, number>);
  const tot = inTab.reduce((a, e) => ({ inv: a.inv + (e.money?.invoiced || 0), paid: a.paid + (e.money?.paid || 0) }), { inv: 0, paid: 0 });
  const unphased = enriched.filter((e) => !e.phase).length;

  if (isLoading) return <div className="p-4 space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (error || !data?.project) return <div className="p-6 text-sm text-muted-foreground">Project not found, or you don't have access.</div>;
  const p = data.project;

  const addHouse = async () => {
    const no = newNo.trim(); if (!no) return;
    setAdding(true);
    const { data: h, error } = await db.from("project_houses").insert({ project_id: p.id, company_id: p.company_id, house_no: no, po_number: p.po_number, make: p.default_make }).select("id, company_id").single();
    if (!error && h) await db.from("project_house_steps").insert(DEFAULT_STEPS.map((s) => ({ ...s, house_id: h.id, company_id: h.company_id })));
    setAdding(false);
    if (error) toast({ title: "Couldn't add house", description: error.message, variant: "destructive" });
    else { setNewNo(""); invalidate(p.id); }
  };

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto" data-testid="project-view">
      {backTo && <Link to={backTo.to} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"><ArrowLeft className="h-4 w-4" /> {backTo.label}</Link>}
      <div className="rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold sm:text-2xl">{p.name}</h1>
            <p className="mt-1 text-sm text-[#CFE6F6]">
              <Link to={`/admin/customers/${p.customer_id}`} className="underline-offset-2 hover:underline">{clientName(p.customers)}</Link>
              {p.po_number ? ` · PO ${p.po_number}` : ""} · {data.houses.length} houses
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <div className="rounded-xl bg-white/10 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-[#CFE6F6]">Invoiced</div><div className="font-semibold">{formatRand(tot.inv)}</div></div>
            <div className="rounded-xl bg-white/10 px-3 py-2"><div className="text-[11px] uppercase tracking-wide text-[#CFE6F6]">Paid</div><div className="font-semibold">{formatRand(tot.paid)}</div></div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="tablist">
        {phases.map((ph) => (
          <button key={ph.id} role="tab" aria-selected={activeTab === ph.id} onClick={() => setTab(ph.id)}
            className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", activeTab === ph.id ? "bg-[#1590D6] text-white" : "bg-card border hover:border-[#1590D6]")}>{phaseLabel(ph)}</button>))}
        <button role="tab" aria-selected={activeTab === "all"} onClick={() => setTab("all")} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", activeTab === "all" ? "bg-[#1590D6] text-white" : "bg-card border")}>All{unphased ? ` (${unphased} no phase)` : ""}</button>
        <button role="tab" aria-selected={activeTab === "map"} onClick={() => setTab("map")} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium inline-flex items-center gap-1", activeTab === "map" ? "bg-[#1590D6] text-white" : "bg-card border")}><MapIcon className="h-4 w-4" /> Site map (coming)</button>
        <div className="ml-auto"><PhaseEditor project={p} phases={phases} onSaved={() => invalidate(p.id)} /></div>
      </div>

      {activeTab === "map" ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground" data-testid="site-map-placeholder">
          The site map is coming next: the phase plans lined up into one map, with each house as a clickable area in its status colour.
        </div>
      ) : (<>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {ORDER.map((s) => (
            <button key={s} onClick={() => setFilter(filter === s ? null : s)} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1", filter === s && "ring-2 ring-[#1590D6]")}>
              <span className={cn("h-2.5 w-2.5 rounded-sm", STATUS_META[s].dot)} /> {STATUS_META[s].label} <span className="text-muted-foreground">{counts[s]}</span>
            </button>))}
          <div className="ml-auto flex items-center gap-1.5">
            <Input value={newNo} onChange={(e) => setNewNo(e.target.value)} placeholder="House no" className="h-8 w-24" onKeyDown={(e) => e.key === "Enter" && addHouse()} />
            <Button size="sm" variant="outline" onClick={addHouse} disabled={adding || !newNo.trim()}>{adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add house</Button>
          </div>
        </div>
        {shown.length === 0 ? <div className="rounded-2xl border p-8 text-center text-sm text-muted-foreground">No houses here yet.</div> : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6" data-testid="house-grid">
            {shown.map(({ h, status, money }) => <HouseCard key={h.id} h={h} status={status} money={money} onOpen={() => setOpenHouse(h.id)} />)}
          </div>)}
      </>)}

      <HouseDrawer house={data.houses.find((h) => h.id === openHouse) || null} money={openHouse ? data.money[openHouse] : undefined}
        phases={phases} onClose={() => setOpenHouse(null)} onSaved={() => invalidate(p.id)} />
    </div>
  );
}

function HouseCard({ h, status, money, onOpen }: { h: ProjectHouse; status: HouseStatus; money?: { invoiced: number; paid: number; invoiceNumbers: string[] }; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} data-status={status} title={STATUS_META[status].label}
      className={cn("rounded-xl border-[3px] bg-card p-2.5 text-left shadow-sm transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#1590D6]", STATUS_META[status].ring)}>
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-base font-semibold">House {h.house_no}</span>
        {h.ready_for_aircon && <span className="text-[10px] font-semibold uppercase text-red-600">Ready</span>}
      </div>
      <div className="truncate text-xs text-muted-foreground">{[h.make, h.unit_sizes].filter(Boolean).join(" ") || "No units set"}</div>
      <div className={cn("truncate text-xs", money ? "text-foreground" : "text-red-600")}>
        {money ? `${formatRand(money.paid)} / ${formatRand(money.invoiced)}` : "no invoice"}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1">
        {h.steps.map((s) => (
          <span key={s.id} className={cn("rounded-md py-0.5 text-center text-[11px] font-medium", s.done ? "bg-emerald-600 text-white" : "bg-muted text-muted-foreground")}>
            {STEP_SHORT[s.step_key] || s.label.slice(0, 5)}{s.paid ? " ✓" : ""}
          </span>))}
      </div>
    </button>
  );
}
