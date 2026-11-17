import { bookingSummaryParts, type BookingSummaryInput } from "@/lib/leadBooking";
import { cn } from "@/lib/utils";

/** Shared booking line. The red chip stands in for the technician's name. */
export default function BookingSummaryLine({ input, className }: { input: BookingSummaryInput; className?: string }) {
  const parts = bookingSummaryParts(input);
  return (
    <p className={cn("text-xs leading-snug text-foreground", className)} data-testid="booking-summary">
      <span>{parts.kind}</span>
      <span> · </span>
      {parts.chip ? (
        <span className="inline-flex items-center rounded bg-[#B91C1C] px-1.5 py-0.5 text-[11px] font-bold text-white" data-testid="no-technician">No technician</span>
      ) : (
        <span>{parts.who}</span>
      )}
      {parts.when && <span> · {parts.when}</span>}
    </p>
  );
}
