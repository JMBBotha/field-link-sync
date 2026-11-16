import { useMemo, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { quoteHref } from "@/lib/recordLinks";
import { formatRand } from "@/utils/formatRand";
import { cn } from "@/lib/utils";
import {
  DEFAULT_WALL_UNIT,
  ISSUE_LABEL,
  UNIT_SIZES,
  alreadyInvoicedOn,
  firstFitReady,
  formatIssueDay,
  normalizeUnitSize,
  parsePipeMetres,
  pipeTotal,
  type IssueState,
} from "@/lib/firstFit";

export interface FirstFitPointRow {
  id: string;
  area: string;
  unitSize: string;
  pipeM: number;
  caption?: string | null;
  url?: string | null;
}

export interface FirstFitSchedule {
  on: string | null;
  state: IssueState | null;
  estimated: boolean;
  number?: string | null;
  id?: string | null;
  amount?: number | null;
  flag?: string | null;
}

export interface FirstFitQuote {
  id?: string;
  number?: string | null;
  flag?: string | null;
  total?: number | null;
  ready?: boolean;
  status?: string | null;
}

export interface FirstFitView {
  houseNo: string;
  projectName?: string | null;
  live: boolean;
  completeAt?: string | null;
  completeBy?: string | null;
  undoneAt?: string | null;
  undoneBy?: string | null;
  points: FirstFitPointRow[];
  units: { area: string; unitSize: string }[];
  pipeM?: number;
  deposit?: FirstFitSchedule | null;
  balance?: FirstFitSchedule | null;
  quote?: FirstFitQuote | null;
  showMoney: boolean;
  canEditList: boolean;
  /** Invoice number when this house is already billed for the whole system. */
  alreadyInvoicedOn?: string | null;
  /** Labour was invoiced. The units price is not known, so no draft is created. */
  unitsInvoiceNeeded?: boolean;
  /** Invoice number of a labour-extraction coverage link. */
  labourInvoice?: string | null;
}

const chip: Record<IssueState, string> = {
  upcoming: "bg-slate-200 text-slate-900 dark:bg-slate-600 dark:text-white",
  due_soon: "bg-amber-100 text-amber-950 dark:bg-amber-800 dark:text-amber-50",
  due_today: "bg-[#C2410C] text-white",
  overdue: "bg-red-600 text-white",
  estimated: "bg-sky-100 text-[#0F2A44] dark:bg-sky-900 dark:text-sky-50",
};

function ScheduleLine({ title, line, showMoney }: { title: string; line?: FirstFitSchedule | null; showMoney: boolean }) {
  if (!line?.on) return null;
  const state = line.state || (line.estimated ? "estimated" : "upcoming");
  const when = formatIssueDay(line.on);
  return (
    <div className="flex items-start justify-between gap-2 py-1" data-testid={`issue-${title.toLowerCase()}`}>
      <div className="min-w-0 text-sm">
        <div className="font-medium text-foreground">{title} due to issue {when}{line.estimated ? " (estimated)" : ""}</div>
        {showMoney && line.amount != null && <div className="text-xs text-muted-foreground">{formatRand(line.amount)}{line.number ? ` · ${line.number}` : ""}</div>}
        {!showMoney && line.number && <div className="text-xs text-muted-foreground">{line.number}</div>}
        {line.flag && <div className="text-xs font-medium text-amber-800 dark:text-amber-200">{line.flag}</div>}
        {line.id && showMoney && <Link to={`/admin/invoices/${line.id}`} className="text-xs font-semibold text-[#3D9BEB] hover:underline">Open draft</Link>}
      </div>
      <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-bold", chip[state])}>{ISSUE_LABEL[state]}</span>
    </div>
  );
}

export default function FirstFitPanel({
  view, busy, onSnap, onSitePhoto, onComplete, onUndo, onSaveUnits,
}: {
  view: FirstFitView;
  busy?: boolean;
  onSnap?: (input: { area: string; unitSize: string; pipeM: number; file: File | null }) => void;
  onSitePhoto?: (file: File) => void;
  onComplete?: () => void;
  onUndo?: () => void;
  onSaveUnits?: (units: { area: string; unitSize: string }[]) => void;
}) {
  const [area, setArea] = useState("");
  const [size, setSize] = useState("");
  const [metres, setMetres] = useState("");
  const [draftUnits, setDraftUnits] = useState(view.units);
  const listed = view.units.length > 0;
  const pipeM = parsePipeMetres(metres);
  const sizeOk = !!normalizeUnitSize(size);
  const areaOk = area.trim().length > 0;
  const canSnap = areaOk && sizeOk && pipeM != null;
  const ready = useMemo(() => firstFitReady(view.units, view.points.map((p) => ({ area: p.area, unitSize: p.unitSize, pipeM: p.pipeM }))), [view.units, view.points]);
  const total = view.pipeM ?? pipeTotal(view.points);
  const pickArea = (name: string) => {
    setArea(name);
    const row = view.units.find((u) => u.area.toLowerCase() === name.trim().toLowerCase());
    if (row) setSize(row.unitSize);
  };

  return (
    <section className="space-y-3" data-testid="first-fit-panel">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">First fit complete</h2>
        {view.live && <span data-testid="live-badge" className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Live</span>}
      </div>
      <p className="text-sm text-muted-foreground">Default unit: {DEFAULT_WALL_UNIT}. Each point still needs a size: 9K, 12K, 18K or 24K. Nothing is sent from here.</p>
      {view.undoneAt && !view.live && (
        <div data-testid="undone-note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          First fit complete was undone{view.undoneBy ? ` by ${view.undoneBy}` : ""}{view.undoneAt ? ` on ${formatIssueDay(view.undoneAt.slice(0, 10))}` : ""}.
        </div>
      )}
      {view.alreadyInvoicedOn && (
        <div data-testid="already-invoiced" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          <div className="font-semibold">{alreadyInvoicedOn(view.alreadyInvoicedOn)}</div>
          <div data-testid="coverage-skip">No draft invoice was created for this house.</div>
        </div>
      )}
      {!view.alreadyInvoicedOn && view.unitsInvoiceNeeded && (
        <div data-testid="units-invoice-needed" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">
          <div className="font-semibold">Units invoice needed</div>
          <div>Price needed (R0).{view.labourInvoice ? ` Labour already invoiced on ${view.labourInvoice}.` : ""}</div>
        </div>
      )}
      {!view.alreadyInvoicedOn && !view.unitsInvoiceNeeded && view.labourInvoice && (
        <div data-testid="labour-covered" className="rounded-xl border bg-card p-3 text-sm text-card-foreground">
          Labour already invoiced on {view.labourInvoice}. A units invoice can still be raised.
        </div>
      )}
      {view.quote?.flag && <div data-testid="quote-flag" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-50">{view.quote.flag}</div>}

      <div className="rounded-2xl border bg-card p-3 text-card-foreground" data-testid="first-fit-capture">
        <div className="mb-2 text-sm font-semibold">New point</div>
        {listed ? (
          <div className="mb-2">
            <Label htmlFor="ff-area">Area</Label>
            <select id="ff-area" value={area} onChange={(e) => pickArea(e.target.value)} className="mt-1 h-12 w-full rounded-md border bg-background px-3 text-base">
              <option value="">Choose an area</option>
              {view.units.map((u) => <option key={u.area} value={u.area}>{u.area} · {u.unitSize}</option>)}
            </select>
          </div>
        ) : (
          <div className="mb-2">
            <Label htmlFor="ff-area-text">Area</Label>
            <Input id="ff-area-text" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Lounge" className="mt-1 h-12 text-base" />
            <p className="mt-1 text-xs text-muted-foreground">No unit list on this house yet. Type the area. The unit stays the {DEFAULT_WALL_UNIT}.</p>
          </div>
        )}
        <div className="mb-2">
          <Label htmlFor="ff-size">Unit size</Label>
          <select id="ff-size" value={size} onChange={(e) => setSize(e.target.value)} className="mt-1 h-12 w-full rounded-md border bg-background px-3 text-base" required>
            <option value="">Choose 9K, 12K, 18K or 24K</option>
            {UNIT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="mb-3">
          <Label htmlFor="ff-metres">Pipe metres</Label>
          <Input id="ff-metres" inputMode="decimal" value={metres} onChange={(e) => setMetres(e.target.value)} placeholder="6.5" className="mt-1 h-12 text-base" />
        </div>
        <div className="grid grid-cols-1 gap-2">
          <Button type="button" disabled={!canSnap || busy} data-testid="first-fit-snap" className="h-12 bg-[#C2410C] text-base text-white hover:bg-[#9a3412]"
            onClick={() => canSnap && pipeM != null && onSnap?.({ area: area.trim(), unitSize: normalizeUnitSize(size) || size, pipeM, file: null })}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}Snap point
          </Button>
          <label className="flex h-12 cursor-pointer items-center justify-center rounded-md border text-base font-medium">
            <Camera className="mr-2 h-4 w-4" /> Site photo
            <input data-testid="site-photo-input" type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSitePhoto?.(f); e.target.value = ""; }} />
          </label>
          <label className={cn("flex h-12 items-center justify-center rounded-md border text-base font-medium", !canSnap && "pointer-events-none opacity-50")}>
            Add a photo to this point
            <input data-testid="point-photo-input" type="file" accept="image/*" capture="environment" className="sr-only" disabled={!canSnap}
              onChange={(e) => { const f = e.target.files?.[0]; if (f && canSnap && pipeM != null) onSnap?.({ area: area.trim(), unitSize: normalizeUnitSize(size) || size, pipeM, file: f }); e.target.value = ""; }} />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-3" data-testid="first-fit-points">
        <div className="mb-2 flex items-baseline justify-between text-sm">
          <span className="font-semibold">{view.units.length ? `${view.points.length} of ${view.units.length} areas` : `${view.points.length} point${view.points.length === 1 ? "" : "s"}`}</span>
          <span data-testid="pipe-total">{total} m pipe</span>
        </div>
        {view.points.length === 0 && <p className="text-sm text-muted-foreground">No points yet.</p>}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {view.points.map((p) => (
            <div key={p.id} className="w-28 shrink-0" data-testid="first-fit-point">
              {p.url ? <img src={p.url} alt="" className="h-24 w-28 rounded-xl object-cover" /> : <div className="flex h-24 w-28 items-center justify-center rounded-xl bg-slate-200 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-100">{p.area}</div>}
              <div className="mt-1 truncate text-xs font-medium">{p.area}</div>
              <div className="text-[11px] text-muted-foreground">{p.unitSize} · {p.pipeM} m</div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border bg-card p-3" data-testid="issue-schedule">
        <div className="mb-1 text-sm font-semibold">When to issue</div>
        <p className="mb-2 text-xs text-muted-foreground">These dates are for issuing. They do not change a sent invoice or a payment. The balance stays an estimate until the deposit is issued.</p>
        {view.alreadyInvoicedOn && <p className="text-sm text-muted-foreground">Nothing further is due to issue for this house.</p>}
        {!view.alreadyInvoicedOn && !view.deposit?.on && !view.balance?.on && <p className="text-sm text-muted-foreground">Dates appear when First fit complete is set.</p>}
        <ScheduleLine title="Deposit" line={view.deposit} showMoney={view.showMoney} />
        <ScheduleLine title="Balance" line={view.balance} showMoney={view.showMoney} />
        {view.showMoney && view.quote?.id && (
          <div className="mt-2 text-sm">
            <Link to={quoteHref(view.quote.id)} className="font-semibold text-[#3D9BEB] hover:underline" data-testid="first-fit-quote">{view.quote.number || "Draft quote"}</Link>
            {view.quote.total != null && <span className="text-muted-foreground"> · {formatRand(view.quote.total)}</span>}
            {view.quote.status === "draft" && <span className="text-muted-foreground"> · draft, not sent</span>}
          </div>
        )}
        {!view.showMoney && view.quote?.ready && <p className="mt-2 text-sm text-muted-foreground">A draft quote is with the office. It is not sent.</p>}
      </div>

      {view.live ? (
        <Button type="button" variant="outline" className="h-12 w-full text-base" disabled={busy} data-testid="first-fit-undo" onClick={onUndo}>Undo First fit complete</Button>
      ) : (
        <div>
          <Button type="button" className="h-12 w-full bg-[#C2410C] text-base text-white hover:bg-[#9a3412]" disabled={!ready.ok || busy} data-testid="first-fit-complete" onClick={onComplete}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}First fit complete
          </Button>
          {!ready.ok && <p data-testid="first-fit-reason" className="mt-2 text-sm text-muted-foreground">{ready.reason}</p>}
        </div>
      )}

      {view.canEditList && (
        <div className="rounded-2xl border bg-card p-3" data-testid="unit-list">
          <div className="mb-2 text-sm font-semibold">Unit list</div>
          {draftUnits.length === 0 && <p className="mb-2 text-xs text-muted-foreground">Empty list: the tech types the area and picks 9K, 12K, 18K or 24K. The quote still uses the {DEFAULT_WALL_UNIT}.</p>}
          {draftUnits.map((u, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_5.5rem] gap-2">
              <Input aria-label="Area name" value={u.area} onChange={(e) => setDraftUnits(draftUnits.map((x, j) => j === i ? { ...x, area: e.target.value } : x))} className="h-12" />
              <select aria-label="Unit size" value={u.unitSize} onChange={(e) => setDraftUnits(draftUnits.map((x, j) => j === i ? { ...x, unitSize: e.target.value } : x))} className="h-12 rounded-md border bg-background px-2">
                {UNIT_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setDraftUnits([...draftUnits, { area: "", unitSize: "12K" }])}>Add area</Button>
            <Button type="button" className="h-12 flex-1 bg-[#C2410C] text-white hover:bg-[#9a3412]" disabled={busy} onClick={() => onSaveUnits?.(draftUnits.filter((u) => u.area.trim()))}>Save list</Button>
          </div>
        </div>
      )}
    </section>
  );
}
