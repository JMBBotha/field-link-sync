import type { ReactNode } from "react";
import { Check, Loader2, AlertTriangle } from "lucide-react";

/** One send button whose colour is its state (Johan 17 Oct 2026): brand → orange (sending) → green (sent) / red (not sent). */
export type SendButtonState = "idle" | "busy" | "slow" | "done" | "failed";

export default function SendStateButton({
  state, labels, icon, onClick, disabled, outline, small, className = "", testId, title,
}: {
  state: SendButtonState;
  labels: Partial<Record<SendButtonState, string>> & { idle: string };
  icon?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  outline?: boolean;
  small?: boolean;
  className?: string;
  testId?: string;
  title?: string;
}) {
  const glyph =
    state === "busy" || state === "slow" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    : state === "done" ? ((labels.done || "").includes("✓") ? null : <Check className="h-4 w-4" aria-hidden />)
    : state === "failed" ? <AlertTriangle className="h-4 w-4" aria-hidden />
    : icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === "busy" || state === "slow"}
      aria-busy={state === "busy" || state === "slow"}
      data-state={state}
      data-testid={testId}
      title={title}
      className={`fl-sbtn is-${state}${outline ? " is-outline" : ""}${small ? " is-sm" : ""} ${className}`}
    >
      {glyph}
      <span aria-live="polite">{labels[state] ?? labels.idle}</span>
    </button>
  );
}
