import { Link } from "react-router-dom";
import { Phone, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCallDuration } from "@/components/calls/CallHistoryPanel";

export type CallAdminFollowupItem = {
  id: string;
  phone: string;
  called_at: string;
  duration_seconds: number;
  customer_id?: string | null;
  customer_name?: string | null;
  call_id?: string | null;
  status: "open" | "dismissed" | "converted";
};

export function callLogHref(callId?: string | null): string {
  return callId ? `/admin/calls?call=${callId}` : "/admin/calls";
}

export function formatCallWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-ZA", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One admin follow-up for a short call. It is not a lead and it does not raise a hot-lead alert. */
export default function CallAdminFollowupCard({
  item,
  busy,
  onMakeLead,
  onDismiss,
}: {
  item: CallAdminFollowupItem;
  busy?: boolean;
  onMakeLead?: (id: string) => void;
  onDismiss?: (id: string) => void;
}) {
  const open = item.status === "open";
  return (
    <article
      data-testid="call-admin-followup"
      className="rounded-2xl border border-[#E7D3B0] bg-[#FFF8EE] p-4 text-[#0F2A44] shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#C2410C] px-2.5 py-1 text-xs font-semibold text-white">
          <Phone className="h-3.5 w-3.5" /> Short call / hang-up
        </span>
        <span className="text-xs font-medium text-[#8A5A12]">Admin follow-up · not a lead · no hot-lead alert</span>
      </div>
      <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        <div><dt className="text-xs text-[#6B7C8F]">Number</dt><dd className="font-semibold tabular-nums">{item.phone}</dd></div>
        <div><dt className="text-xs text-[#6B7C8F]">Time</dt><dd className="font-semibold">{formatCallWhen(item.called_at)}</dd></div>
        <div><dt className="text-xs text-[#6B7C8F]">Call length</dt><dd className="font-semibold">{formatCallDuration(item.duration_seconds)}</dd></div>
        <div>
          <dt className="text-xs text-[#6B7C8F]">Client</dt>
          <dd className="font-semibold">
            {item.customer_id && item.customer_name ? (
              <Link to={`/admin/customers/${item.customer_id}`} className="text-[#0F6FA8] underline">{item.customer_name}</Link>
            ) : "No client on this number"}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-[#6B7C8F]">No customer was created for this call.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm" className="border-[#D6E4EF]">
          <Link to={callLogHref(item.call_id)} data-testid="followup-call-log">Call log</Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="border-[#D6E4EF]">
          <a href={`tel:${item.phone}`} data-testid="followup-call-back"><PhoneOutgoing className="mr-1 h-3.5 w-3.5" />Call back</a>
        </Button>
        {open && (
          <>
            <Button
              size="sm"
              variant="brand"
              disabled={busy}
              data-testid="followup-make-lead"
              onClick={() => onMakeLead?.(item.id)}
            >
              Make it a lead
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-[#D6E4EF]"
              disabled={busy}
              data-testid="followup-dismiss"
              onClick={() => onDismiss?.(item.id)}
            >
              Dismiss
            </Button>
          </>
        )}
        {!open && <span className="text-xs font-semibold text-[#4A5D70]">{item.status === "converted" ? "Made into a lead" : "Dismissed"}</span>}
      </div>
    </article>
  );
}
