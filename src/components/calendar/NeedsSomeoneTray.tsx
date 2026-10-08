import { useState, type DragEvent } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { laneOf, LANE_META, UNKNOWN_LANE_META } from "@/lib/leadLane";
import { leadMinutes, hhmm, fromMinutes, toMinutes } from "@/lib/schedulingDefaults";
import { bookingMinutes, bookingRange, calendarText, hoursLabel, type CalendarLead, type CalendarSchedule } from "./calendarModel";

type Props<L extends CalendarLead, S extends CalendarSchedule> = {
  leads: L[]; pool: S[]; onLeadDragStart: (e: DragEvent, lead: L) => void;
  onScheduleDragStart: (e: DragEvent, schedule: S) => void; onDragEnd: () => void;
  onAssignLead: (lead: L) => void; onAssignPool: (schedule: S) => void;
};
export default function NeedsSomeoneTray<L extends CalendarLead, S extends CalendarSchedule>({ leads, pool,
  onLeadDragStart, onScheduleDragStart, onDragEnd, onAssignLead, onAssignPool }: Props<L, S>) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const count = leads.length + pool.length;
  return <section data-testid="needs-someone-tray" className="border-b bg-muted/20 p-3 space-y-2">
    {mobile ? <Button variant="ghost" className="w-full justify-start" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>🙋 {count} need someone</Button>
      : <h3 className="text-sm font-semibold">Needs someone</h3>}
    {(!mobile || expanded) && <>
      {!count && <p className="text-xs text-muted-foreground">Nobody needed: every booking has a person.</p>}
      {leads.length > 0 && <div data-testid="tray-unassigned" className="space-y-2">
        <h4 className="text-xs font-semibold">No one assigned yet</h4>
        <p className="text-xs text-muted-foreground">A date and time is booked (e.g. by Mandy or the office) but no salesperson or tech has been chosen.</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{leads.map(l => {
          const minutes = leadMinutes(l);
          const lane = laneOf(l);
          return <div key={l.id} draggable onDragStart={e => { onLeadDragStart(e, l); e.dataTransfer.setData("application/start-time", hhmm(l.scheduled_time)); e.dataTransfer.setData("application/end-time", fromMinutes(toMinutes(l.scheduled_time || "08:00") + minutes)); }} onDragEnd={onDragEnd} className="min-w-0 rounded-md border bg-card p-2 cursor-grab active:cursor-grabbing">
            <p className="text-xs font-medium">{l.scheduled_date && format(new Date(`${l.scheduled_date}T12:00:00`), "EEE d MMM")} · {hhmm(l.scheduled_time)}–{fromMinutes(toMinutes(l.scheduled_time || "08:00") + minutes)}</p>
            <p className="truncate text-sm font-semibold">{calendarText(l.customer_name, calendarText(l.service_type))}</p>
            <p className="truncate text-xs text-muted-foreground">{calendarText(l.customer_address.split(",").slice(0, 2).join(", "), "Address pending")} · {hoursLabel(minutes)}</p>
            <div className="mt-1 flex items-center justify-between gap-2"><span className={`rounded border px-1 text-[10px] font-semibold ${lane ? LANE_META[lane].className : UNKNOWN_LANE_META.className}`}>{lane?.toUpperCase() || "LANE?"}</span><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onAssignLead(l)}>Assign…</Button></div>
          </div>;
        })}</div>
      </div>}
      {pool.length > 0 && <div data-testid="tray-open" className="space-y-2">
        <h4 className="text-xs font-semibold">Open for any tech to accept</h4>
        <p className="text-xs text-muted-foreground">An installation passed to Technical without a named tech. Any tech can take it, or drag it to someone.</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">{pool.map(s => <div key={s.id} draggable onDragStart={e => onScheduleDragStart(e, s)} onDragEnd={onDragEnd} className="min-w-0 rounded-md border bg-card p-2 cursor-grab active:cursor-grabbing">
          <p className="text-xs font-medium">{format(new Date(`${s.scheduled_date}T12:00:00`), "EEE d MMM")} · {bookingRange(s)}</p>
          <p className="truncate text-sm font-semibold">{calendarText(s.leads?.customer_name, calendarText(s.leads?.service_type))}</p>
          <p className="truncate text-xs text-muted-foreground">{calendarText(s.leads?.customer_address?.split(",").slice(0, 2).join(", "), "Address pending")} · {hoursLabel(bookingMinutes(s))}</p>
          <div className="mt-1 flex items-center justify-between gap-2"><span className={`rounded border px-1 text-[10px] font-semibold ${LANE_META.service.className}`}>SERVICE</span><Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => onAssignPool(s)}>Assign…</Button></div>
        </div>)}</div>
      </div>}
    </>}
  </section>;
}