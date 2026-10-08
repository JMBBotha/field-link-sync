import { type DragEvent } from "react";
import JobCard from "@/components/cards/JobCard";
import { calendarScheduleToCard } from "@/lib/cardModel";
import { toMinutes } from "@/lib/schedulingDefaults";
import { LANE_META, type LeadLane } from "@/lib/leadLane";
import { bookingMinutes, bookingRange, hoursLabel, freeGaps, loadTone, type CalendarLead, type CalendarSchedule, type CalendarPerson } from "./calendarModel";

export function BusyBlock({ schedule }: { schedule: CalendarSchedule }) {
  return <div data-testid="busy-block" className="rounded-md border bg-muted p-3 text-muted-foreground"><p className="text-sm font-semibold">Busy</p><p className="text-xs">{bookingRange(schedule)} · {hoursLabel(bookingMinutes(schedule))}</p></div>;
}
export function LoadBar({ minutes, clash }: { minutes: number; clash: boolean }) {
  const tone = loadTone(minutes, clash);
  // Discrete widths keep the visual styling token-based, without dynamic inline colours.
  const width = minutes >= 540 ? "w-full" : minutes > 405 ? "w-5/6" : minutes > 270 ? "w-2/3" : minutes > 135 ? "w-1/3" : minutes > 0 ? "w-1/6" : "w-0";
  return <div className="space-y-1"><p className="text-xs text-muted-foreground">{hoursLabel(minutes)} booked of 9 h</p><div role="progressbar" aria-label="Booked hours" aria-valuenow={minutes / 60} aria-valuemin={0} aria-valuemax={9} data-tone={tone} className="h-1.5 overflow-hidden rounded bg-muted"><div className={`h-full ${width} ${tone === "destructive" ? "bg-destructive" : tone === "warning" ? "bg-warning" : "bg-primary"}`} /></div></div>;
}
type Props<L extends CalendarLead, S extends CalendarSchedule> = {
  date: string; groups: { key: LeadLane | null; label: string; agents: CalendarPerson[] }[];
  schedules: S[]; leads: L[]; sales: boolean; isAgentOnline: (id: string) => boolean;
  onJobInfoClick: (lead: L, schedule: S) => void; onScheduleDragStart: (e: DragEvent, schedule: S) => void;
  onDragEnd: () => void; onDrop: (e: DragEvent, agentId: string, date: string, hour: number) => void;
  onDragOver: (e: DragEvent) => void; dragOverSlot: string | null;
  onSlotDragEnter: (key: string) => void; onSlotDragLeave: () => void;
};
export default function DayCards<L extends CalendarLead, S extends CalendarSchedule>({ date, groups, schedules, leads, sales, isAgentOnline,
  onJobInfoClick, onScheduleDragStart, onDragEnd, onDrop, onDragOver, dragOverSlot, onSlotDragEnter, onSlotDragLeave }: Props<L, S>) {
  return <div className="space-y-4 p-3" data-testid="day-cards">{groups.map(g => <section key={g.key || "unknown"} className="space-y-2">
    <h3 className="text-sm font-semibold">{g.label}</h3><div className="grid items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">{g.agents.map(person => {
      const booked = schedules.filter(s => s.agent_id === person.id).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
      const rows = [...booked.map(s => ({ start: toMinutes(s.start_time), schedule: s, gap: null })), ...freeGaps(booked).map(gap => ({ start: toMinutes(gap.start), schedule: null, gap }))].sort((a, b) => a.start - b.start);
      return <div key={person.id} data-testid="person-day-card" className="min-w-0 space-y-2">
        <header className="space-y-2 border-b pb-2"><div className="flex flex-wrap items-center gap-2"><span className={`h-2 w-2 rounded-full ${isAgentOnline(person.id) ? "bg-success" : "bg-muted-foreground/40"}`} aria-label={isAgentOnline(person.id) ? "Online" : "Offline"} /><span className="text-sm font-semibold">{person.full_name}</span><span className={`rounded border px-1 text-[10px] font-semibold ${g.key ? LANE_META[g.key].className : "text-muted-foreground"}`}>{g.key?.toUpperCase() || "LANE?"}</span></div><LoadBar minutes={booked.reduce((n, s) => n + bookingMinutes(s), 0)} clash={booked.some(s => !!s.clash)} /></header>
        {rows.map(row => {
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