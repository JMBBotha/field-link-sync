import { cn } from "@/lib/utils";

/** 24-hour time picker (hour 00–23 + minute in 5-min steps). Value "HH:mm"; onChange gets { target: { value } } like a native input. */
export interface TimeInput24Props {
  value: string | null | undefined;
  onChange: (e: { target: { value: string } }) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

export function TimeInput24({ value, onChange, className, disabled, id, onKeyDown, placeholder: _p, ...rest }: TimeInput24Props) {
  const [hRaw, mRaw] = String(value || "").split(":");
  const h = hRaw ? String(Number(hRaw)).padStart(2, "0") : "";
  const m = hRaw ? String(Number(mRaw || 0)).padStart(2, "0") : "";
  const mins = m && !MINS.includes(m) ? [...MINS, m].sort() : MINS;
  const emit = (nh: string, nm: string) => onChange({ target: { value: `${nh || "08"}:${nm || "00"}` } });
  const sel = "h-9 rounded-md border border-input bg-background px-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
  return (
    <div className={cn("inline-flex items-center gap-1 min-w-0", className, "w-auto shrink-0")} data-time24="">
      <select id={id} aria-label={rest["aria-label"] ? `${rest["aria-label"]} hour` : "Hour"} className={sel} disabled={disabled}
        value={h} onKeyDown={onKeyDown} onChange={(e) => emit(e.target.value, m)}>
        {!h && <option value="">--</option>}
        {HOURS.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <span className="text-muted-foreground">:</span>
      <select aria-label={rest["aria-label"] ? `${rest["aria-label"]} minute` : "Minute"} className={sel} disabled={disabled}
        value={m} onKeyDown={onKeyDown} onChange={(e) => emit(h, e.target.value)}>
        {!m && <option value="">--</option>}
        {mins.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}

export default TimeInput24;
