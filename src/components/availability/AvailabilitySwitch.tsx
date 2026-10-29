import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
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
      className={cn("flex h-8 shrink-0 items-center rounded-full border border-white/25 bg-white/10 p-0.5", className)}
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
              "flex h-7 min-w-[30px] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold transition-colors sm:px-2",
              labelled && "flex-1 text-xs",
              active ? o.on : "text-white/85 hover:bg-white/15",
            )}
          >
            {!active && <span className={cn("h-2 w-2 rounded-full", o.dot)} />}
            <span className={cn(active || labelled ? "inline" : "hidden sm:inline")}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default AvailabilitySwitch;

/** Self-contained header switch for the signed-in user (used in the sales header). */
export function MyAvailabilitySwitch({ className, labelled }: { className?: string; labelled?: boolean }) {
  const [uid, setUid] = useState<string | undefined>();
  useEffect(() => {
    let off = false;
    supabase.auth.getSession().then(({ data }) => { if (!off) setUid(data.session?.user?.id); });
    return () => { off = true; };
  }, []);
  const availability = useAvailability(uid);
  if (!uid) return null;
  return <AvailabilitySwitch status={availability.status} onChange={(s) => void availability.setManualStatus(s)} className={className} labelled={labelled} />;
}
