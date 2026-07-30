import { cn } from "@/lib/utils";

export type StatusTone = "green" | "red" | "gray" | "blue" | "amber";

const TONES: Record<StatusTone, string> = {
  green: "bg-brand-green/12 text-brand-green ring-brand-green/25",
  red: "bg-destructive/12 text-destructive ring-destructive/25",
  gray: "bg-muted text-muted-foreground ring-border",
  blue: "bg-link/12 text-link ring-link/25",
  amber: "bg-warning/15 text-warning ring-warning/30",
};

/** Maps common document/job statuses to a colored pill tone. */
export const toneForStatus = (status?: string | null): StatusTone => {
  const s = (status || "").toLowerCase().replace(/[_-]/g, " ").trim();
  if (["paid", "accepted", "approved", "completed", "active", "won"].includes(s))
    return "green";
  if (["overdue", "declined", "rejected", "cancelled", "canceled", "failed", "lost"].includes(s))
    return "red";
  if (["sent", "viewed", "pending", "in progress", "scheduled", "claimed"].includes(s))
    return "blue";
  if (["partial", "due soon", "on hold"].includes(s)) return "amber";
  return "gray";
};

interface StatusPillProps {
  status: string;
  tone?: StatusTone;
  className?: string;
}

const StatusPill = ({ status, tone, className }: StatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset",
      TONES[tone ?? toneForStatus(status)],
      className
    )}
  >
    {status.replace(/[_-]/g, " ")}
  </span>
);

export default StatusPill;
