import { type DragEvent } from "react";
import JobCard from "@/components/cards/JobCard";
import { toMinutes } from "@/lib/schedulingDefaults";
import { LANE_META, type LeadLane } from "@/lib/leadLane";
import { calendarScheduleToCard, bookingMinutes, bookingRange, hoursLabel, freeGaps, loadTone, mergedMinutes, blockedSpan, type WorkWindow, type BlockedTime, type CalendarLead, type CalendarSchedule, type CalendarPerson } from "./calendarModel";

export function BusyBlock({ schedule }: { schedule: CalendarSchedule }) {
  return <div data-testid="busy-block" className="rounded-md border bg-muted p-3 text-muted-foreground"><p className="text-sm font-semibold">Busy</p><p className="text-xs">{bookingRange(schedule)} · {hoursLabel(bookingMinutes(schedule))}</p></div>;
}
export function LoadBar({ minutes, clash, capacity = 540 }: { minutes: number; clash: boolean; capacity?: number }) {
  const tone = loadTone(minutes, clash, capacity);
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{hoursLabel(minutes)} booked of {hoursLabel(capacity)}</p><svg role="progressbar" aria-label="Booked hours" aria-valuenow={minutes / 60} aria-valuemin={0} aria-valuemax={capacity / 60} data-tone={tone} viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full overflow-hidden rounded bg-muted"><rect width={Math.min(100, minutes / Math.max(1, capacity) * 100)} height={6} className={tone === "destructive" ? "fill-destructive" : tone === "warning" ? "fill-warning" : "fill-primary"} /></svg></div>;
}
type Props<L extends CalendarLead, S extends CalendarSchedule> = {
  date: string; groups: { key: LeadLane | null; label: string; agents: CalendarPerson[] }[];
  schedules: S[]; leads: L[]; sales: boolean; isAgentOnline: (id: string) => boolean;
  onJobInfoClick: (lead: L, schedule: S) => void; onScheduleDragStart: (e: DragEvent, schedule: S) => void;
  onDragEnd: () => void; onDrop: (e: DragEvent, agentId: string, date: string, hour: number) => void;
  onDragOver: (e: DragEvent) => void; dragOverSlot: string | null;
  onSlotDragEnter: (key: string) => void; onSlotDragLeave: () => void;
  windows?: Record<string, WorkWindow | undefined>; blocked?: BlockedTime[]; showReason?: (profileId: string) => boolean;
};
export default function DayCards<L extends CalendarLead, S extends CalendarSchedule>({ date, groups, schedules, leads, sales, isAgentOnline,
  onJobInfoClick, onScheduleDragStart, onDragEnd, onDrop, onDragOver, dragOverSlot, onSlotDragEnter, onSlotDragLeave, windows = {}, blocked = [], showReason = () => false }: Props<L, S>) {
  return <div className="space-y-4 p-3" data-testid="day-cards">{groups.map(g => <section key={g.key || "unknown"} className="space-y-2">
    <h3 className="text-sm font-semibold">{g.label}</h3><div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">{g.agents.map(person => {
      const booked = schedules.filter(s => s.agent_id === person.id).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const win = windows[person.id];
      const off = win?.is_working === false;
      const capacity = win && !off ? Math.max(0, toMinutes(win.end_time) - toMinutes(win.start_time)) : 540;
      const blocks = blocked.filter(b => b.profile_id === person.id).map(b => ({ b, span: blockedSpan(b, date) })).filter(x => x.span) as { b: BlockedTime; span: { start_time: string; end_time: string } }[];
      const rows = [...booked.map(s => ({ start: toMinutes(s.start_time), schedule: s, gap: null, block: null })),
        ...freeGaps(booked, win || undefined, blocks.map(x => x.span)).map(gap => ({ start: toMinutes(gap.start), schedule: null, gap, block: null })),
        ...blocks.map(x => ({ start: toMinutes(x.span.start_time), schedule: null, gap: null, block: x }))].sort((a, b) => a.start - b.start);
      return <div key={person.id} data-testid="person-day-card" className="min-w-0 space-y-2">
        <header className="space-y-2 border-b pb-2"><div className="flex flex-wrap items-center gap-2"><span className={`h-2 w-2 rounded-full ${isAgentOnline(person.id) ? "bg-success" : "bg-muted-foreground/40"}`} aria-label={isAgentOnline(person.id) ? "Online" : "Offline"} /><span className="text-sm font-semibold">{person.full_name}</span><span className={`rounded border px-1 text-[10px] font-semibold ${g.key ? LANE_META[g.key].className : "text-muted-foreground"}`}>{g.key?.toUpperCase() || "LANE?"}</span>{off && <span data-testid="off-chip" className="rounded border bg-muted px-1 text-[10px] font-semibold text-muted-foreground">Off</span>}</div><LoadBar minutes={mergedMinutes(booked)} clash={booked.some(s => !!s.clash)} capacity={capacity} /></header>
        {rows.map(row => {
          if (row.block) {
            const { b, span } = row.block;
            const label = b.kind === "leave" ? "Off" : "Blocked";
            return <div key={`blk-${b.id}`} data-testid="off-block" className="rounded-md border bg-muted p-2 text-xs text-muted-foreground">{label} {span.start_time}–{span.end_time}{b.kind !== "leave" && b.reason && showReason(person.id) ? ` · ${b.reason}` : ""}</div>;
          }
          if (row.gap) {
            const gap = row.gap; const hour = toMinutes(gap.start) / 60; const key = `${person.id}-${date}-${Math.floor(hour)}`;
            return <div key={`gap-${gap.start}`} data-testid="free-gap" className={`rounded-md border border-dashed p-2 text-xs text-muted-foreground ${dragOverSlot === key ? "ring-2 ring-primary bg-primary/10" : ""}`} onDragOver={onDragOver} onDragEnter={() => onSlotDragEnter(key)} onDragLeave={onSlotDragLeave} onDrop={e => onDrop(e, person.id, date, hour)}>Free {gap.start}–{gap.end} · {hoursLabel(gap.minutes)} open</div>;
          }
          const s = row.schedule;
          if (!s) return null;
          const lead = leads.find(l => l.id === s.lead_id);
          const busy = sales && !s.leads;
          const card = calendarScheduleToCard(s, lead);
          return <div key={s.id} className="space-y-1" draggable={!busy} onDragStart={e => onScheduleDragStart(e, s)} onDragEnd={onDragEnd}>
            <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground" data-testid="booking-time">{bookingRange(s)} · {hoursLabel(bookingMinutes(s))}{s.clash && <span data-testid="clash-badge" title={`Overlaps ${s.clash.start}–${s.clash.end} with ${s.clash.label}`} className="rounded bg-destructive px-1 font-semibold text-destructive-foreground">⚠ Clash</span>}</div>
            {busy ? <BusyBlock schedule={s} /> : <JobCard item={{ ...card, assigneeName: person.full_name }} audience={sales ? "sales" : "office"} density="compact" onOpen={() => { if (lead) onJobInfoClick(lead, s); }} />}
          </div>;
        })}
      </div>;
    })}</div>
  </section>)}</div>;
}