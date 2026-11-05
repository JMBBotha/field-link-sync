import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAvailability, type AvailabilityStatus } from "@/hooks/useAvailability";

const OPTIONS: { value: AvailabilityStatus; label: string; dot: string; on: string }[] = [
  { value: "available", label: "Available", dot: "bg-green-500", on: "bg-green-500 text-white" },
  { value: "busy", label: "Busy", dot: "bg-amber-400", on: "bg-amber-400 text-slate-900" },
  { value: "offline", label: "Off", dot: "bg-slate-400", on: "bg-slate-600 text-white" },
];

/** Three-way Available / Busy / Off switch. Thumb-sized on phones, compact pill in headers. */
export function AvailabilitySwitch({
  status,
  onChange,
  disabled,
  className,
  labelled,
}: {
  /** Always show text labels with equal-width segments (mobile strip). */
  labelled?: boolean;
  status: AvailabilityStatus;
  onChange: (s: AvailabilityStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Availability"
      data-testid="availability-switch"
      // Johan 2 Nov 18:08: true segmented control. Three equal 44px segments; highlight inset inside the pill (ring, not border, so height stays 44).
      className={cn("grid h-11 shrink-0 grid-cols-3 items-stretch rounded-full bg-white/10 ring-1 ring-inset ring-white/25", className)}
    >
      {OPTIONS.map((o) => {
        const active = status === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.label}
            disabled={disabled}
            data-testid={`availability-${o.value}`}
            onClick={() => !active && onChange(o.value)}
            className={cn(
              "relative flex h-11 min-w-11 items-center justify-center rounded-full px-1 text-[11px] font-semibold",
              labelled && "text-xs",
            )}
          >
            <span className={cn("absolute inset-[4px] rounded-full transition-colors", active ? o.on : "hover:bg-white/15")} aria-hidden />
            <span className={cn("relative flex items-center gap-1 px-1.5 leading-none", active ? o.on.split(" ").filter((c) => c.startsWith("text-")).join(" ") : "text-white/85")}>
              {!active && <span className={cn("h-2 w-2 rounded-full", o.dot)} />}
              <span className={cn(active || labelled ? "inline" : "hidden sm:inline")}>{o.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default AvailabilitySwitch;

/** Self-contained header switch for the signed-in user (used in the sales header). */
export function MyAvailabilitySwitch({ className, labelled }: { className?: string; labelled?: boolean }) {
  const uid = useAuth().user?.id;
  const availability = useAvailability(uid);
  if (!uid) return null;
  return <AvailabilitySwitch status={availability.status} onChange={(s) => void availability.setManualStatus(s)} className={className} labelled={labelled} />;
}
