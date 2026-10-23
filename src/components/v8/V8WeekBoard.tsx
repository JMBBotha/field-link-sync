import { format, isToday, getDay } from "date-fns";
import { cn } from "@/lib/utils";
import { v8OutsideHours, v8WinMinutes, v8FillTone, type Win } from "@/lib/v8Hours";
import { dayBadge, hoursText, type BoardDayState } from "@/lib/jobDays";
import "./v8.css";

/** v8 Schedule (New layout): pipeline-style day columns. Pure view: every drop goes back to the page's existing handlers. */
export type V8Sched = { id: string; lead_id: string; job_id?: string | null; agent_id: string | null; scheduled_date: string; start_time: string; end_time: string;
  leads?: { customer_name: string; service_type: string; status: string; customer_address?: string } | null; jobs?: { status?: string | null } | null;
  /** Phase (b): day N of M of a multi-day run. */
  day_index?: number | null; day_count?: number | null };
export type V8Kind = "sales" | "callout" | "install" | "other";
export const V8_KIND: Record<V8Kind, { label: string; cls: string }> = {
  sales: { label: "Sales visit", cls: "k-sales" }, callout: { label: "Call-out R680", cls: "k-call" }, install: { label: "Install", cls: "k-inst" }, other: { label: "Service", cls: "k-other" },
};
export function v8KindOf(s: V8Sched, lane: string | null | undefined): V8Kind {
  const t = `${s.leads?.service_type || ""}`.toLowerCase();
  if (/call.?out|repair|fault/.test(t)) return "callout";
  if (s.job_id || /install/.test(t)) return "install";
  if (lane === "sales") return "sales";
  return "other";
}
const mins = (t: string) => { const [h, m] = (t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const v8Dur = (s: V8Sched) => Math.max(0, mins(s.end_time) - mins(s.start_time));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

interface Props {
  days: Date[]; month: boolean; byDate: Map<string, V8Sched[]>; people: { id: string; full_name: string }[]; staff: string; setStaff: (s: string) => void;
  laneOf: (s: V8Sched) => string | null; winFor: (profileId: string, date: string) => Win; cancelled: number; onCancelledTray: () => void; resched: number; onReschedTray: () => void; dragOver: string | null; setDragOver: (k: string | null) => void;
  onCardDragStart: (e: React.DragEvent, s: V8Sched) => void; onDragEnd: () => void; onOpen: (s: V8Sched) => void;
  onDropDay: (e: React.DragEvent, date: string) => void; onDropZone: (e: React.DragEvent, zone: "unscheduled" | "sunday" | "resched" | "cancel") => void;
  unscheduled: number; onTray: () => void; sundayLabel: string;
  role: V8CalRole; setRole: (r: V8CalRole) => void; salesIds: Set<string>; techIds: Set<string>;
  /** Phase (b): per-day check-in state by schedule row id, and SA holidays / closures by date. */
  dayStates?: Map<string, BoardDayState>; holidays?: Map<string, string>; draggingRun?: boolean;
}
const DAY_CHIP: Record<string, string> = { done: "Day done", on_site: "On site", en_route: "En route" };
export type V8CalRole = "all" | "sales" | "tech";

export default function V8WeekBoard(p: Props) {
  // Role switch + person picker. Dual-role staff are in both sets, so they show under Sales and Technicians.
  const inRole = (id: string | null) => p.role === "all" || (!!id && (p.role === "sales" ? p.salesIds : p.techIds).has(id));
  const people = p.people.filter((a) => inRole(a.id));
  const staff = p.staff !== "all" && people.some((a) => a.id === p.staff) ? p.staff : "all";
  const filt = (l: V8Sched[]) => l.filter((s) => (staff === "all" ? inRole(s.agent_id) : s.agent_id === staff));
  const name = (id: string | null) => p.people.find((x) => x.id === id)?.full_name || "Pool";
  const cols = p.month ? p.days : p.days.filter((d) => getDay(d) !== 0);
  const over = (k: string) => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (p.dragOver !== k) p.setDragOver(k); },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) p.setDragOver(null); },
  });
  return (
    <div className="v8-cal flex h-full flex-col gap-2 p-2" data-testid="v8-week-board">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="v8-seg" role="tablist" aria-label="Role">
          {([["all", "All"], ["sales", "Sales"], ["tech", "Technicians"]] as [V8CalRole, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={p.role === k} className={cn(p.role === k && "on")} onClick={() => p.setRole(k)}>{l}</button>))}
        </div>
        <button className={cn("v8-chip", staff === "all" && "on")} onClick={() => p.setStaff("all")}>Everyone</button>
        {people.length <= 6 ? people.map((a) => (
          <button key={a.id} className={cn("v8-chip", staff === a.id && "on")} onClick={() => p.setStaff(a.id)}>
            <span className="v8-av2">{initials(a.full_name)}</span>{a.full_name.split(" ")[0]}
          </button>)) : (
          <select aria-label="Person" value={staff} onChange={(e) => p.setStaff(e.target.value)} className="v8-chip pr-6">
            <option value="all">Everyone</option>{people.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>)}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {(["sales", "callout", "install"] as V8Kind[]).map((k) => <span key={k} className={cn("v8-key", V8_KIND[k].cls)}>{V8_KIND[k].label.replace(" R680", "")}</span>)}
        </span>
      </div>
      <div className={cn("min-h-0 flex-1", p.month ? "grid grid-cols-7 gap-1.5 overflow-auto" : "flex gap-2 overflow-x-auto snap-x")}>
        {cols.map((d) => {
          const key = format(d, "yyyy-MM-dd");
          const list = filt(p.byDate.get(key) || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
          const booked = list.reduce((s, x) => s + v8Dur(x), 0);
          // Capacity = real working minutes of the people in view (person hours → company hours → Mon–Fri 08–17).
          const inView = staff === "all" ? people : people.filter((a) => a.id === staff);
          const cap = inView.reduce((t, a) => t + v8WinMinutes(p.winFor(a.id, key)), 0);
          const pct = cap ? Math.round((booked / cap) * 100) : booked ? 101 : 0;
          const tone = v8FillTone(pct);
          const hol = p.holidays?.get(key) ?? null;
          return (
            <section key={key} {...over(key)} onDrop={(e) => { p.setDragOver(null); p.onDropDay(e, key); }} data-v8-day={key}
              className={cn("v8-daycol snap-start", isToday(d) && "today", (!cap || hol) && "offday", hol && "holiday", p.dragOver === key && "is-over", p.month && "month")}>
              <header className="px-2.5 pt-2">
                <div className="flex items-baseline justify-between gap-1">
                  <span><span className="block text-xs opacity-60">{format(d, "EEE")}</span><span className="text-lg font-extrabold leading-none">{format(d, "d")}</span></span>
                  <span className="text-xs opacity-70 tabular-nums">{list.length} · {Math.round(booked / 6) / 10}h{cap ? ` / ${Math.round(cap / 60)}h` : " · off"}{pct > 100 ? ` · ${pct}%` : ""}</span>
                </div>
                {hol && <div className="v8-hol truncate text-xs font-semibold" data-testid="v8-holiday" title={hol}>{hol}</div>}
                <div className="v8-fill"><i style={{ width: `${Math.min(100, pct)}%` }} className={tone || undefined} /></div>
              </header>
              <div className="flex flex-col gap-1.5 p-1.5">
                {list.map((s) => {
                  const k = v8KindOf(s, p.laneOf(s));
                  const late = !!s.agent_id && v8OutsideHours(p.winFor(s.agent_id, key), s.start_time, s.end_time);
                  const lateTag = late ? (p.salesIds.has(s.agent_id!) && !p.techIds.has(s.agent_id!) ? "After hours" : "Overtime") : null;
                  const dTag = dayBadge(s.day_index, s.day_count);
                  const ds = p.dayStates?.get(s.id);
                  const dsText = ds && ds.state !== "none" ? (ds.state === "done" ? `✓ ${hoursText(ds.hours)}` : DAY_CHIP[ds.state]) : null;
                  return (
                    <div key={s.id} draggable onDragStart={(e) => p.onCardDragStart(e, s)} onDragEnd={p.onDragEnd} onClick={() => p.onOpen(s)}
                      className={cn("v8-ccard", V8_KIND[k].cls, late && "late")} title={`${s.leads?.customer_name || ""} · ${name(s.agent_id)}`}>
                      <div className="flex items-center justify-between gap-1 text-xs font-bold tabular-nums">{s.start_time.slice(0, 5)}
                        <span className="flex gap-1">{dTag && <span className="v8-day" data-testid="v8-day-badge">{dTag}</span>}{lateTag && <span className="v8-late">{lateTag}</span>}</span></div>
                      <div className="truncate text-xs font-bold">{s.leads?.customer_name || "Booking"}</div>
                      {!p.month && <div className="truncate text-xs opacity-70">{s.leads?.customer_address || s.leads?.service_type} · {Math.round(v8Dur(s) / 60 * 10) / 10} h</div>}
                      {dsText && <div className={cn("v8-dstate", ds!.state)} data-testid="v8-day-state">{dsText}</div>}
                      {!p.month && <div className="mt-1 flex items-center justify-between"><span className="v8-tag">{V8_KIND[k].label}</span><span className="v8-av2">{s.agent_id ? initials(name(s.agent_id)) : "—"}</span></div>}
                    </div>);
                })}
                {p.dragOver === key && <div className="v8-ghost">{p.draggingRun ? "Drop: move the whole run from here" : "Drop: move here (same time)"}</div>}
              </div>
            </section>);
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1.4fr_1fr]">
        <div {...over("z-un")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "unscheduled"); }} onClick={p.onTray}
          className={cn("v8-dz", p.dragOver === "z-un" && "is-over")}>⏸ Unscheduled · {p.unscheduled} waiting</div>
        <div {...over("z-sun")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "sunday"); }} className={cn("v8-dz", p.dragOver === "z-sun" && "is-over")}>{p.sundayLabel}</div>
        <div {...over("z-rs")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "resched"); }} onClick={p.onReschedTray}
          className={cn("v8-dz resched", p.dragOver === "z-rs" && "is-over")} data-testid="v8-resched-zone">↻ Needs rescheduling · {p.resched}</div>
        <div {...over("z-x")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "cancel"); }} onClick={p.onCancelledTray}
          className={cn("v8-dz cancel", p.dragOver === "z-x" && "is-over")} data-testid="v8-cancelled-tray">✕ Cancelled · {p.cancelled}</div>
      </div>
    </div>
  );
}
