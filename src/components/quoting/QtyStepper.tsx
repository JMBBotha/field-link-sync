import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";

/**
 * Phone-friendly quantity / length input for quote lines (Johan 19:51).
 * Select-all on focus (typing replaces the value), right-aligned, decimal keypad,
 * 44px tall compact box, Enter/Done commits, never below `min`. No − / + buttons (Johan 21:15).
 * Pure UI: the parent still decides what a committed value means (no pricing logic here).
 */
export function parseQty(raw: string): number {
  const v = Number(String(raw).trim().replace(",", "."));
  return raw.trim() === "" ? NaN : v;
}
export function stepQty(value: number, delta: number, min: number): number {
  const next = Math.round((value + delta) * 100) / 100;
  return next < min ? min : next;
}

type Props = {
  value: number;
  min: number;
  step: number;
  ariaLabel: string;
  unit?: string;
  onCommit: (v: number) => void;
  inputProps?: InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string>;
};

export default function QtyStepper({ value, min, step: _step, ariaLabel, unit, onCommit, inputProps }: Props) {
  const [text, setText] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(String(value)); }, [value]);

  const commit = (v: number) => {
    if (!Number.isFinite(v) || v < min) { setText(String(value)); return; }
    setText(String(v));
    if (v !== value) onCommit(v);
  };

  return (
    <div data-qty-stepper className="inline-flex items-center gap-0.5 print:hidden" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        aria-label={ariaLabel}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onMouseUp={(e) => e.preventDefault()}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
        onBlur={(e) => commit(parseQty(e.target.value))}
        className="qty-box h-11 w-14 sm:w-16 rounded-md border border-slate-300 bg-white px-2 text-right text-base tabular-nums text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        {...inputProps}
      />
      {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
    </div>
  );
}
