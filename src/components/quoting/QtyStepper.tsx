import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { Minus, Plus } from "lucide-react";

/**
 * Phone-friendly quantity / length input for quote lines (Johan 19:51).
 * Select-all on focus (typing replaces the value), right-aligned, decimal keypad,
 * 44px tap targets, − / + steppers that never go below `min`, Enter/Done commits.
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

export default function QtyStepper({ value, min, step, ariaLabel, unit, onCommit, inputProps }: Props) {
  const [text, setText] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (document.activeElement !== ref.current) setText(String(value)); }, [value]);

  const commit = (v: number) => {
    if (!Number.isFinite(v) || v < min) { setText(String(value)); return; }
    setText(String(v));
    if (v !== value) onCommit(v);
  };
  const btn = "inline-flex h-11 w-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 active:bg-slate-100 disabled:opacity-40";

  return (
    <div data-qty-stepper className="inline-flex items-center gap-0.5 print:hidden" onClick={(e) => e.stopPropagation()}>
      <button type="button" data-no-min aria-label={`Decrease ${ariaLabel}`} className={btn}
        disabled={value <= min} onClick={() => commit(stepQty(value, -step, min))}>
        <Minus className="h-4 w-4" />
      </button>
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
        className="h-11 w-12 sm:w-16 rounded-md border border-slate-300 bg-white px-2 text-right text-base tabular-nums text-slate-800 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
        {...inputProps}
      />
      <button type="button" data-no-min aria-label={`Increase ${ariaLabel}`} className={btn}
        onClick={() => commit(stepQty(value, step, min))}>
        <Plus className="h-4 w-4" />
      </button>
      {unit && <span className="text-[11px] text-slate-500">{unit}</span>}
    </div>
  );
}
