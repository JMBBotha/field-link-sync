import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BLOCK_STYLE, DAY_START, DAY_END, blockPos, dayProgress, needsYou, ageTone, snapStart, type BlockKind, type ChipKey } from "@/lib/jobsCalm";

/** Presentational only (no queries) so it can be rendered from sample data. Calm Jobs page, Johan 20 Oct. No WhatsApp. */
export type CalmTab = "today" | "week" | "month" | "pipeline";
export type CalmLead = { id: string; name: string; place?: string | null; phone?: string | null; lane: "sales" | "service"; createdAt: string | null; contacted: boolean; tag?: string | null };
export type CalmBlock = {
  id: string; kind: "job" | "visit"; personId: string | null; day: string; start: number | null; dur: number;
  title: string; sub?: string | null; place?: string | null; block: BlockKind; pill?: string | null; late?: boolean; draggable?: boolean;
};
export type CalmPerson = { id: string; name: string; role: string; dot: "green" | "orange" | "grey" | "blue" };
export type CalmUnassigned = { id: string; title: string; sub?: string | null; age?: string | null; lane: "sales" | "service" };

type Props = {
  tab: CalmTab; onTab: (t: CalmTab) => void; dateLabel: string; onNew: () => void;
  leads: CalmLead[]; leadsTotal: number; showAllLeads: boolean; onShowAll: () => void;
  people: CalmPerson[]; blocks: CalmBlock[]; unassigned: CalmUnassigned[]; weekDays: { day: string; label: string }[];
  everyone: string; everyoneOptions: { value: string; label: string }[]; onEveryone: (v: string) => void;
  chip: ChipKey | null; onChip: (c: ChipKey | null) => void; counts: { leadsNotContacted: number; late: number; unassigned: number };
  onCallLead: (l: CalmLead) => void; onAssignLead: (l: CalmLead) => void; onOpenLead: (l: CalmLead) => void;
  onAssignJob: (id: string) => void; onOpenJob: (id: string) => void; onOpenBlock: (b: CalmBlock) => void;
  onMoveBlock?: (b: CalmBlock, start: number) => void;
  pipeline?: ReactNode; now?: Date; nowMin?: number | null;
  /** Month view: Mon–Sun grid cells; picking a day opens it in Today. */
  monthCells?: { day: string; inMonth: boolean }[]; todayDay?: string; onPickDay?: (day: string) => void;
};

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const DOT = { green: "bg-emerald-500", orange: "bg-orange-500", grey: "bg-slate-300", blue: "bg-sky-500" };
const TONE = { green: "bg-emerald-100 text-emerald-700", amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-600" };
const STRIPE = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-red-500" };
const fmtAge = (m: number) => (m >= 1440 ? `${Math.floor(m / 1440)}d` : m >= 60 ? `${Math.floor(m / 60)}h` : `${m}m`);
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const LaneTag = ({ lane, children }: { lane: "sales" | "service"; children?: ReactNode }) => (
  <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold", lane === "sales" ? "bg-violet-100 text-violet-700" : "bg-orange-100 text-orange-700")}>
    {children || (lane === "sales" ? "Sales quote" : "Technical")}
  </span>
);

function LeadCard({ l, now, onCall, onAssign, onOpen }: { l: CalmLead; now?: Date; onCall: () => void; onAssign: () => void; onOpen: () => void }) {
  const a = ageTone(l.createdAt, now);
  return (
    <div className="relative cursor-pointer overflow-hidden rounded-2xl bg-white dark:bg-card p-3 pl-4 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10" onClick={onOpen} data-calm-lead>
      <span className={cn("absolute inset-y-0 left-0 w-1", STRIPE[a.tone])} />
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">{l.name}</div>
          <div className="truncate text-[13px] text-slate-500 dark:text-slate-400">{[l.place, l.phone].filter(Boolean).join(" · ")}</div>
        </div>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", TONE[a.tone])}>{fmtAge(a.mins)}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1"><LaneTag lane={l.lane} />{l.tag && <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700">{l.tag}</span>}</div>
      <div className="mt-2.5 grid grid-cols-2 gap-2" onClick={(e) => e.stopPropagation()}>
        {l.phone ? <a href={`tel:${l.phone}`} onClick={onCall} className="rounded-full bg-[#1AA7EC] py-1.5 text-center text-[13px] font-semibold text-white hover:bg-[#1590D6]">Call</a>
          : <span className="rounded-full bg-slate-100 dark:bg-white/10 py-1.5 text-center text-[13px] text-slate-400">No number</span>}
        <button onClick={onAssign} className="rounded-full bg-sky-50 py-1.5 text-[13px] font-semibold text-[#1590D6] hover:bg-sky-100">Assign</button>
      </div>
    </div>
  );
}

function Block({ b, onOpen, onDrop, compact }: { b: CalmBlock; onOpen: () => void; onDrop?: (start: number) => void; compact?: boolean }) {
  const pos = !compact && b.start !== null ? blockPos(b.start, b.dur) : null;
  const ref = useRef<HTMLButtonElement>(null);
  const body = (
    <>
      <div className="flex items-center gap-1 truncate text-[12px] font-semibold">
        {b.start !== null ? `${hhmm(b.start)}${b.dur >= 120 && !compact ? `–${hhmm(Math.min(DAY_END, b.start + b.dur))}` : ""}` : "Any time"}
        {b.late && <span className="font-normal"> · Late</span>}
        {b.pill && !compact && b.dur >= 120 && <span className="ml-1 rounded-full bg-white/80 px-1.5 text-[10px] font-semibold uppercase tracking-wide">{b.pill}</span>}
      </div>
      <div className="truncate text-[12px]">{b.title}</div>
      {b.place && <div className="truncate text-[11px] opacity-75">{b.place}</div>}
    </>
  );
  if (compact || !pos) {
    return <button onClick={onOpen} className={cn("block w-full rounded-lg border px-2 py-1 text-left", BLOCK_STYLE[b.block])} data-calm-block>{body}</button>;
  }
  return (
    <button ref={ref} onClick={onOpen} draggable={!!onDrop && b.draggable}
      onDragStart={(e) => { e.dataTransfer.setData("text/calm-block", b.id); e.dataTransfer.effectAllowed = "move"; }}
      title={onDrop && b.draggable ? "Drag to change the time" : undefined}
      className={cn("absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg border px-2 py-1 text-left shadow-[0_1px_0_rgba(15,23,42,.03)]", BLOCK_STYLE[b.block])}
      style={{ left: `${pos.left}%`, width: `calc(${pos.width}% - 4px)` }} data-calm-block>{body}</button>
  );
}

export default function JobsCalmView(p: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [phoneDay, setPhoneDay] = useState<string | null>(null);
  const DOTC: Record<BlockKind, string> = { install: "bg-sky-400", service: "bg-orange-400", maintenance: "bg-emerald-400", sales: "bg-violet-400", done: "bg-slate-300", late: "bg-red-500" };
  const shownIds = new Set(p.people.map((x) => x.id));
  const dayBlocks = (d: string) => p.blocks.filter((b) => b.day === d && (!b.personId || shownIds.has(b.personId))).sort((a, b) => (a.start ?? 9999) - (b.start ?? 9999));
  const cells = p.monthCells || [];
  const month = (
    <>
      <div className="hidden min-w-0 rounded-3xl bg-white dark:bg-card p-4 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10 md:block" data-calm-month>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">This month</h2>
          <select value={p.everyone} onChange={(e) => p.onEveryone(e.target.value)} className="appearance-none rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-card px-3 py-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300" aria-label="Who">
            {p.everyoneOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-7 text-center text-[12px] font-semibold text-slate-500 dark:text-slate-400">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="pb-2">{d}</div>)}</div>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-slate-100 dark:bg-white/10">
          {cells.map((c) => {
            const bs = dayBlocks(c.day);
            return (
              <div key={c.day} className={cn("min-h-[104px] space-y-1 bg-white dark:bg-card p-1.5", !c.inMonth && "bg-slate-50/70")} data-calm-month-day>
                <button onClick={() => p.onPickDay?.(c.day)} className={cn("grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold",
                  c.day === p.todayDay ? "bg-[#1AA7EC] text-white" : c.inMonth ? "text-slate-700 dark:text-slate-300 hover:bg-sky-50" : "text-slate-300")}>{Number(c.day.slice(8))}</button>
                {bs.slice(0, 3).map((b) => (
                  <button key={b.id} onClick={() => p.onOpenBlock(b)} className={cn("block w-full truncate rounded-md border px-1.5 py-0.5 text-left text-[11px]", BLOCK_STYLE[b.block])}>
                    {b.start !== null && <span className="font-semibold">{hhmm(b.start)} </span>}{b.title}
                  </button>
                ))}
                {bs.length > 3 && <button onClick={() => p.onPickDay?.(c.day)} className="text-[11px] font-semibold text-[#1590D6]">+{bs.length - 3} more</button>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="space-y-3 md:hidden" data-calm-month-phone>
        <div className="rounded-2xl bg-white dark:bg-card p-3 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10">
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate-400">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="pb-1">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-y-1">
            {cells.map((c) => {
              const bs = dayBlocks(c.day); const kinds = [...new Set(bs.map((b) => b.block))].slice(0, 3);
              return (
                <button key={c.day} onClick={() => setPhoneDay(c.day)} className="flex flex-col items-center gap-0.5 py-1">
                  <span className={cn("grid h-7 w-7 place-items-center rounded-full text-[13px]",
                    (phoneDay || p.todayDay) === c.day ? "bg-[#1AA7EC] font-semibold text-white" : c.inMonth ? "text-slate-700 dark:text-slate-300" : "text-slate-300")}>{Number(c.day.slice(8))}</span>
                  <span className="flex h-1.5 gap-0.5">{kinds.map((k) => <span key={k} className={cn("h-1.5 w-1.5 rounded-full", DOTC[k])} />)}</span>
                </button>
              );
            })}
          </div>
        </div>
        {(() => { const d = phoneDay || p.todayDay || ""; const bs = dayBlocks(d); return (
          <div className="space-y-1.5" data-calm-month-list>
            <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{d ? new Date(`${d}T12:00:00+02:00`).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" }) : ""} · {bs.length} job{bs.length === 1 ? "" : "s"}</h3>
            {bs.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">Nothing booked</div>
              : bs.map((b) => <div key={b.id}><div className="mb-0.5 text-[11px] text-slate-500 dark:text-slate-400">{p.people.find((x) => x.id === b.personId)?.name || "Unassigned"}</div><Block b={b} compact onOpen={() => p.onOpenBlock(b)} /></div>)}
          </div>); })()}
      </div>
    </>
  );
  const chips = needsYou(p.counts);
  const hours = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => 8 + i);
  const rowBlocks = (pid: string) => p.blocks.filter((b) => b.personId === pid);
  const leadsRail = (
    <section className="space-y-2.5">
      <h3 className="flex items-center justify-between text-[13px] font-semibold text-slate-500 dark:text-slate-400">Needs you <span>{p.leadsTotal}</span></h3>
      {p.leads.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">No new leads</div>
        : p.leads.map((l) => <LeadCard key={l.id} l={l} now={p.now} onCall={() => p.onCallLead(l)} onAssign={() => p.onAssignLead(l)} onOpen={() => p.onOpenLead(l)} />)}
      {p.leadsTotal > p.leads.length && !p.showAllLeads && <button onClick={p.onShowAll} className="w-full py-1 text-[13px] font-semibold text-[#1590D6]">Show all ({p.leadsTotal})</button>}
    </section>
  );
  const unassignedRail = p.unassigned.length > 0 && (
    <section className="space-y-2.5">
      <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">Unassigned jobs</h3>
      {p.unassigned.map((u) => (
        <div key={u.id} className="relative cursor-pointer overflow-hidden rounded-2xl bg-white dark:bg-card p-3 pl-4 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10" onClick={() => p.onOpenJob(u.id)} data-calm-unassigned>
          <span className="absolute inset-y-0 left-0 w-1 bg-amber-400" />
          <div className="flex items-start gap-2"><div className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100">{u.title}</div>
            {u.age && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">{u.age}</span>}</div>
          {u.sub && <div className="truncate text-[13px] text-slate-500 dark:text-slate-400">{u.sub}</div>}
          <div className="mt-1.5 flex gap-1"><span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">Unassigned</span><LaneTag lane={u.lane} /></div>
          <button onClick={(e) => { e.stopPropagation(); p.onAssignJob(u.id); }} className="mt-2.5 w-full rounded-full bg-sky-50 py-1.5 text-[13px] font-semibold text-[#1590D6] hover:bg-sky-100">Assign</button>
        </div>
      ))}
    </section>
  );

  const timeline = (
    <div className="hidden min-w-0 rounded-3xl bg-white dark:bg-card p-4 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10 md:block" data-calm-timeline>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{p.tab === "week" ? "This week" : "Today"}</h2>
        <select value={p.everyone} onChange={(e) => p.onEveryone(e.target.value)} className="appearance-none rounded-full border border-slate-200 dark:border-white/10 bg-white dark:bg-card px-3 py-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-300" aria-label="Who">
          {p.everyoneOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {p.tab === "today" ? (
        <div>
          <div className="ml-[150px] flex justify-between text-[11px] text-slate-400">{hours.map((h) => <span key={h} className="w-0">{String(h).padStart(2, "0")}</span>)}</div>
          {p.people.length === 0 && <div className="py-10 text-center text-[13px] text-slate-500 dark:text-slate-400">Nobody booked today</div>}
          {p.people.map((per) => {
            const bs = rowBlocks(per.id);
            return (
              <div key={per.id} className="flex items-stretch border-t border-slate-100 py-1" data-calm-row>
                <div className="flex w-[150px] shrink-0 items-center gap-2 pr-2">
                  <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sky-50 text-[11px] font-semibold text-sky-700">
                    {initials(per.name)}<span className={cn("absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white", DOT[per.dot])} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-slate-900 dark:text-slate-100">{per.name}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">{per.role}</div>
                    <div className="mt-1 h-1 w-14 rounded bg-slate-100 dark:bg-white/10"><div className="h-1 rounded bg-[#1AA7EC]" style={{ width: `${dayProgress(bs.map((b) => b.block))}%` }} /></div>
                  </div>
                </div>
                <div className={cn("relative h-[72px] flex-1 rounded-lg", dragOver === per.id && "bg-sky-50")}
                  style={{ backgroundImage: "repeating-linear-gradient(to right, #eef2f6 0 1px, transparent 1px calc(100% / 9))" }}
                  onDragOver={(e) => { if (p.onMoveBlock) { e.preventDefault(); setDragOver(per.id); } }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    setDragOver(null);
                    const id = e.dataTransfer.getData("text/calm-block");
                    const b = bs.find((x) => x.id === id);
                    if (!b || !p.onMoveBlock) return;
                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    p.onMoveBlock(b, snapStart((e.clientX - r.left) / r.width));
                  }}>
                  {p.nowMin != null && p.nowMin > DAY_START && p.nowMin < DAY_END && <span className="absolute inset-y-0 w-px bg-red-400/70" style={{ left: `${((p.nowMin - DAY_START) / (DAY_END - DAY_START)) * 100}%` }} />}
                  {bs.map((b) => <Block key={b.id} b={b} onOpen={() => p.onOpenBlock(b)} onDrop={p.onMoveBlock ? () => {} : undefined} />)}
                  {bs.filter((b) => b.start === null).length > 0 && <span className="absolute bottom-0 right-1 text-[10px] text-slate-400">+{bs.filter((b) => b.start === null).length} no time</span>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `150px repeat(${p.weekDays.length}, minmax(0,1fr))` }}>
            <div />{p.weekDays.map((d) => <div key={d.day} className="px-1 pb-2 text-center text-[12px] font-semibold text-slate-500 dark:text-slate-400">{d.label}</div>)}
            {p.people.map((per) => (
              <div key={per.id} className="contents" data-calm-row>
                <div className="flex items-center gap-2 border-t border-slate-100 py-2 pr-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-50 text-[10px] font-semibold text-sky-700">{initials(per.name)}</span>
                  <div className="min-w-0"><div className="truncate text-[13px] font-semibold">{per.name}</div><div className="text-[11px] text-slate-500 dark:text-slate-400">{per.role}</div></div>
                </div>
                {p.weekDays.map((d) => (
                  <div key={d.day} className="space-y-1 border-l border-t border-slate-100 p-1">
                    {rowBlocks(per.id).filter((b) => b.day === d.day).sort((a, b) => (a.start ?? 9999) - (b.start ?? 9999)).map((b) => <Block key={b.id} b={b} compact onOpen={() => p.onOpenBlock(b)} />)}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {p.people.length === 0 && <div className="py-10 text-center text-[13px] text-slate-500 dark:text-slate-400">Nothing booked this week</div>}
        </div>
      )}
    </div>
  );

  const phoneJobs = (
    <div className="space-y-3 md:hidden" data-calm-phone-jobs>
      <h3 className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{p.tab === "week" ? "This week's jobs" : "Today's jobs"}</h3>
      {p.people.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-center text-[13px] text-slate-500 dark:text-slate-400">Nothing booked</div>}
      {p.people.map((per) => (
        <div key={per.id} className="rounded-2xl bg-white dark:bg-card p-3 shadow-sm ring-1 ring-slate-200/70 dark:ring-white/10">
          <div className="mb-2 flex items-center gap-2">
            <span className="relative grid h-7 w-7 place-items-center rounded-full bg-sky-50 text-[10px] font-semibold text-sky-700">{initials(per.name)}<span className={cn("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border-2 border-white", DOT[per.dot])} /></span>
            <span className="text-[13px] font-semibold">{per.name}</span><span className="text-[11px] text-slate-500 dark:text-slate-400">{per.role}</span>
          </div>
          <div className="space-y-1.5">{rowBlocks(per.id).sort((a, b) => a.day.localeCompare(b.day) || (a.start ?? 9999) - (b.start ?? 9999)).map((b) => <Block key={b.id} b={b} compact onOpen={() => p.onOpenBlock(b)} />)}</div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-full bg-[#F3F6FA] dark:bg-background p-3 sm:p-4 md:p-6" data-jobs-calm>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-3 text-white sm:px-4" data-testid="v8-page-header">
        <h1 className="text-[25px] font-semibold tracking-tight text-white">Jobs</h1>
        <div className="inline-flex rounded-full bg-white/10 p-1 ring-1 ring-white/20" role="tablist">
          {(["today", "week", "month", "pipeline"] as CalmTab[]).map((t) => (
            <button key={t} role="tab" aria-selected={p.tab === t} onClick={() => p.onTab(t)}
              className={cn("rounded-full px-3.5 py-1 text-[13px] font-semibold", p.tab === t ? "bg-white text-[#0F2A44]" : "text-white/80")}>
              {t === "today" ? "Today" : t === "week" ? "Week" : t === "month" ? "Month" : "Pipeline"}
            </button>
          ))}
        </div>
        <span className="hidden text-[13px] text-white/75 sm:inline">{p.dateLabel}</span>
        <button onClick={p.onNew} className="ml-auto rounded-full bg-white px-4 py-1.5 text-[13px] font-semibold text-[#0F2A44] shadow-sm hover:bg-white/90">+ New</button>
      </div>
      {p.tab !== "pipeline" && chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" data-calm-chips>
          <span className="text-[13px] text-slate-500 dark:text-slate-400">Needs you</span>
          {chips.map((c) => (
            <button key={c.key} onClick={() => p.onChip(p.chip === c.key ? null : c.key)} aria-pressed={p.chip === c.key}
              className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-semibold",
                c.tone === "red" ? "border-red-200 bg-red-50 text-red-600 dark:border-red-400/30 dark:bg-red-500/15 dark:text-red-300" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-300",
                p.chip === c.key && "ring-2 ring-[#1AA7EC]/50")}>
              <span className={cn("grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] text-white", c.tone === "red" ? "bg-red-500" : "bg-amber-500")}>{c.n}</span>{c.label}
            </button>
          ))}
          {p.chip && <button onClick={() => p.onChip(null)} className="text-[12px] text-slate-500 dark:text-slate-400 underline">Clear</button>}
        </div>
      )}
      {p.tab === "pipeline" ? <div className="mt-4">{p.pipeline}</div> : (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">{p.chip !== "late" && p.chip !== "unassigned" && leadsRail}{p.chip !== "leads" && p.chip !== "late" && unassignedRail}</div>
          {p.chip !== "leads" && (p.tab === "month" ? <div className="min-w-0">{month}</div> : <>{timeline}{phoneJobs}</>)}
        </div>
      )}
    </div>
  );
}
