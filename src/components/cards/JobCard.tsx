import { Children, cloneElement, isValidElement, type HTMLAttributes, type ReactNode } from "react";
import { format } from "date-fns";
import { MapPin, HardHat, Phone, Users, Zap, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import BoardChip from "@/components/jobs/BoardChip";
import RowMenu, { type RowMenuItem } from "@/components/shared/RowMenu";
import CallSummary from "@/components/leads/CallSummary";
import { pillFor, NEXT_STATUS, fmtMins } from "@/lib/dispatchCards";
import { LANE_META } from "@/lib/leadLane";
import { overdueLabel, type CardJob } from "@/lib/cardModel";
import { cn } from "@/lib/utils";
import { hhmm, sastParts } from "@/lib/schedulingDefaults";

/** Keep caller-owned technician controls, but discard office controls and client links. */
export function techCardContent(content: ReactNode): ReactNode {
  return Children.map(content, (child) => {
    if (typeof child === "string") return /assign|\bauto\b|invoice|move[- ]to|next[- ]status/i.test(child) ? null : child.replace(/R\s?\d[\d\s,.]*/g, "");
    if (!isValidElement<{ children?: ReactNode; href?: string; to?: string; invoice?: unknown; hideAmount?: boolean; "aria-label"?: string }>(child)) return child;
    const props = child.props;
    if (props.href || (props.to && !/^\/field\/(jobs|job-sheet)/.test(props.to) && !/job sheet/i.test(String(props.children)))) return null;
    if (props.invoice) return cloneElement(child, { hideAmount: true });
    if (/assign|\bauto\b|invoice|move[- ]to|next[- ]status|client/i.test(props["aria-label"] || "")) return null;
    if (typeof props.children === "string" && /assign|\bauto\b|invoice|move[- ]to|next[- ]status/i.test(props.children)) return null;
    return props.children === undefined ? child : cloneElement(child, {}, techCardContent(props.children));
  });
}

export type { CardJob } from "@/lib/cardModel";
type Props = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  item: CardJob; density: "full" | "compact"; audience: "office" | "sales" | "tech";
  actions?: ReactNode; menuItems?: RowMenuItem[]; onOpen: () => void;
  onAssign?: () => void; onAuto?: () => void; onNext?: () => void;
  onLaneClick?: () => void; onAssigneeClick?: () => void;
};
/** Callers own navigation, mutations and drag behaviour. */
export default function JobCard({ item, density, audience, actions, menuItems = [], onOpen, onAssign, onAuto, onNext,
  onLaneClick, onAssigneeClick, className, ...rest }: Props) {
  const tech = audience === "tech";
  const text = (value?: string | null) => tech ? (value || "").replace(/R\s?\d[\d\s,.]*/g, "") : value;
  const unassigned = item.statusKey === "unassigned";
  const closed = ["completed", "cancelled", "canceled"].includes(item.statusKey);
  const pill = pillFor({ id: item.id, status: item.statusKey,
    assignments: item.assigneeName ? [{ profile_id: "assigned" }] : [] });
  const { key, mins, onSiteMins } = item.urgency;
  const scheduled = item.scheduledFor ? new Date(item.scheduledFor) : null;
  const time = scheduled && !isNaN(scheduled.getTime()) && !/^\d{4}-\d{2}-\d{2}$/.test(item.scheduledFor || "") ? (tech ? hhmm(sastParts(scheduled.toISOString()).time) : format(scheduled, "HH:mm")) : "--:--";
  const next = NEXT_STATUS[item.statusKey];
  const secondary: RowMenuItem[] = density === "compact" ? [
    ...(onAuto && unassigned ? [{ label: "Auto", onSelect: onAuto }] : []),
    ...(item.assigneePhone && !closed ? [{ label: "Call tech", onSelect: () => { window.location.href = `tel:${item.assigneePhone}`; } }] : []),
    ...(item.clientPhone && !closed ? [{ label: "Client", onSelect: () => { window.location.href = `tel:${item.clientPhone}`; } }] : []),
    ...(next && onNext ? [{ label: next.label, onSelect: onNext }] : []),
  ] : [];
  const menu = [...secondary, ...menuItems].filter((m) => !tech || !/assign|auto|invoice|move[- ]to|next[- ]status|client|R\s?\d/i.test(m.label));
  const assign = !tech && unassigned && onAssign ? <Button size="sm" variant="destructive" className="h-7 gap-1 px-2 text-xs" onClick={onAssign}><Users className="h-3.5 w-3.5" />{density === "full" ? "Assign tech" : "Assign"}</Button> : null;
  return (
    <div role="link" tabIndex={0} aria-label={`Open ${item.kind === "job" ? "job" : "booked lead"} ${text(item.title)}`}
      data-dispatch-card={item.id} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className={cn("min-w-0 cursor-pointer space-y-1.5 rounded-xl border border-l-4 bg-card p-3 shadow-sm hover:shadow-md", pill.bar,
        (key === "late" || unassigned) && "border-dashed border-destructive/60 bg-destructive/5", className)} {...rest}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-bold tabular-nums">{time}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", unassigned ? "border border-destructive text-destructive" : pill.className)}>{pill.label}</span>
        {["urgent", "high"].includes(String(item.priority || "").toLowerCase()) && <span className="rounded border border-destructive/60 px-1.5 text-[10px] font-bold uppercase text-destructive">{item.priority}</span>}
        <span className="ml-auto text-xs font-semibold">
          {key === "late" && mins !== null ? (mins < -(24 * 60)
            ? <span className="text-destructive">{overdueLabel(item.scheduledFor)}</span>
            : <span className="text-destructive">Late {fmtMins(-mins)}</span>)
            : onSiteMins != null ? <span className="text-muted-foreground">{fmtMins(onSiteMins)} on site</span>
            : (key === "unassigned" || key === "soon") && mins !== null && mins <= 120 ? <span className="text-destructive">starts in {fmtMins(mins)}</span> : null}
        </span>
      </div>
      <div className="truncate text-sm font-semibold">{text(item.title)}</div>
      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{[text(item.place), text(item.clientName)].filter(Boolean).join(" · ") || "No address"}</span></div>
      {item.assigneeName && <div className="flex min-w-0 items-center gap-1 text-xs"><HardHat className="h-3.5 w-3.5 shrink-0 text-warning" /><span className="truncate">{text(item.assigneeName)}</span></div>}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {onLaneClick ? <BoardChip label={`Filter ${LANE_META[item.lane].label}`} className={LANE_META[item.lane].className} onSelect={onLaneClick}>{item.lane.toUpperCase()}</BoardChip>
          : <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", LANE_META[item.lane].className)}>{item.lane.toUpperCase()}</span>}
        {onAssigneeClick && <BoardChip label={item.assigneeName ? `Filter assignee ${item.assigneeName}` : "Filter unassigned"}
          className={item.assigneeName ? "border-primary/30 bg-primary/10 text-primary" : "border-destructive text-destructive"} onSelect={onAssigneeClick}>{text(item.assigneeName) || "UNASSIGNED"}</BoardChip>}
      </div>
      {!tech && item.kind === "visit" && <CallSummary lead={{ call_summary: item.callSummary, notes: item.notes }} compact />}
      <div className="flex flex-wrap items-center gap-1 pt-0.5" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {tech ? techCardContent(actions) : (actions !== undefined ? actions : <>{assign}{density === "full" && <>
          {onAuto && unassigned && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onAuto}><Zap className="h-3.5 w-3.5" />Auto</Button>}
          {item.assigneePhone && !closed && <Button asChild size="sm" className="h-7 gap-1 px-2 text-xs"><a href={`tel:${item.assigneePhone}`}><Phone className="h-3.5 w-3.5" />Call tech</a></Button>}
          {item.clientPhone && !closed && <Button asChild size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs"><a href={`tel:${item.clientPhone}`}><Phone className="h-3.5 w-3.5" />Client</a></Button>}
          {next && onNext && <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={onNext}>{next.to === "completed" ? <Check className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}{next.label}</Button>}
        </>}</>)}
        <div className="ml-auto"><RowMenu label={item.kind === "job" ? "Job actions" : "Lead actions"} items={menu} /></div>
      </div>
    </div>
  );
}
