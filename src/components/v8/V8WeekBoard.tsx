import { format, isToday, getDay } from "date-fns";
import { cn } from "@/lib/utils";
import "./v8.css";

/** v8 Schedule (New layout): pipeline-style day columns. Pure view: every drop goes back to the page's existing handlers. */
export type V8Sched = { id: string; lead_id: string; job_id?: string | null; agent_id: string | null; scheduled_date: string; start_time: string; end_time: string;
  leads?: { customer_name: string; service_type: string; status: string; customer_address?: string } | null; jobs?: { status?: string | null } | null };
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
  laneOf: (s: V8Sched) => string | null; capacityMin: number; dragOver: string | null; setDragOver: (k: string | null) => void;
  onCardDragStart: (e: React.DragEvent, s: V8Sched) => void; onDragEnd: () => void; onOpen: (s: V8Sched) => void;
  onDropDay: (e: React.DragEvent, date: string) => void; onDropZone: (e: React.DragEvent, zone: "unscheduled" | "sunday" | "cancel") => void;
  unscheduled: number; onTray: () => void; sundayLabel: string;
  role: V8CalRole; setRole: (r: V8CalRole) => void; salesIds: Set<string>; techIds: Set<string>;
}
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
          const pct = p.capacityMin ? Math.min(100, Math.round((booked / p.capacityMin) * 100)) : 0;
          return (
            <section key={key} {...over(key)} onDrop={(e) => { p.setDragOver(null); p.onDropDay(e, key); }} data-v8-day={key}
              className={cn("v8-daycol snap-start", isToday(d) && "today", p.dragOver === key && "is-over", p.month && "month")}>
              <header className="px-2.5 pt-2">
                <div className="flex items-baseline justify-between gap-1">
                  <span><span className="block text-[11px] opacity-60">{format(d, "EEE")}</span><span className="text-lg font-extrabold leading-none">{format(d, "d")}</span></span>
                  <span className="text-[11px] opacity-70 tabular-nums">{list.length} · {Math.round(booked / 60)}h booked</span>
                </div>
                <div className="v8-fill"><i style={{ width: `${pct}%` }} className={pct >= 85 ? "hot" : undefined} /></div>
              </header>
              <div className="flex flex-col gap-1.5 p-1.5">
                {list.map((s) => {
                  const k = v8KindOf(s, p.laneOf(s));
                  return (
                    <div key={s.id} draggable onDragStart={(e) => p.onCardDragStart(e, s)} onDragEnd={p.onDragEnd} onClick={() => p.onOpen(s)}
                      className={cn("v8-ccard", V8_KIND[k].cls)} title={`${s.leads?.customer_name || ""} · ${name(s.agent_id)}`}>
                      <div className="text-[11px] font-bold tabular-nums">{s.start_time.slice(0, 5)}</div>
                      <div className="truncate text-[13px] font-bold">{s.leads?.customer_name || "Booking"}</div>
                      {!p.month && <div className="truncate text-[11px] opacity-70">{s.leads?.customer_address || s.leads?.service_type} · {Math.round(v8Dur(s) / 60 * 10) / 10} h</div>}
                      {!p.month && <div className="mt-1 flex items-center justify-between"><span className="v8-tag">{V8_KIND[k].label}</span><span className="v8-av2">{s.agent_id ? initials(name(s.agent_id)) : "—"}</span></div>}
                    </div>);
                })}
                {p.dragOver === key && <div className="v8-ghost">Drop: move here (same time)</div>}
              </div>
            </section>);
        })}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1.3fr_1fr_1.3fr]">
        <div {...over("z-un")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "unscheduled"); }} onClick={p.onTray}
          className={cn("v8-dz", p.dragOver === "z-un" && "is-over")}>⏸ Unscheduled · {p.unscheduled} waiting (drag onto a day)</div>
        <div {...over("z-sun")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "sunday"); }} className={cn("v8-dz", p.dragOver === "z-sun" && "is-over")}>{p.sundayLabel}</div>
        <div {...over("z-x")} onDrop={(e) => { p.setDragOver(null); p.onDropZone(e, "cancel"); }} className={cn("v8-dz cancel", p.dragOver === "z-x" && "is-over")}>✕ Cancel / reschedule later</div>
      </div>
    </div>
  );
}
