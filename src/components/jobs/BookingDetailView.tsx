import type { ReactNode } from "react";
import { MapPin, Phone } from "lucide-react";
import JobInfoBlock from "@/components/jobs/JobInfoBlock";
import CallNotes from "@/components/jobs/CallNotes";
import StaffMoreMenu from "@/components/jobs/StaffMoreMenu";
import CancelVisitDialog from "@/components/jobs/CancelVisitDialog";
import { assignedLabel, isAssigned } from "@/lib/assignedLabel";
import { friendlyWhen } from "@/lib/friendlyWhen";
import { bookingStatus, type BookingPerms } from "@/lib/bookingEdit";
import { canCancelVisit, type CancelVisitReasonId } from "@/lib/cancelVisit";
import { mapHref } from "@/lib/mapPin";

export type BookingQuoteLink = { id: string; quote_number: string | null; status: string | null };

export type BookingDetailModel = {
  id: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  customer_id?: string | null;
  service_type?: string | null;
  job_types?: string[] | null;
  job_info?: string | null;
  notes?: string | null;
  tech_name?: string | null;
  date?: string | null;
  time?: string | null;
  status?: string | null;
  lead_status?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  assigned_agent_id?: string | null;
  perms?: BookingPerms | null;
  quotes?: BookingQuoteLink[];
};

/**
 * Booking page body. The page owns the reads and writes; this view only lays out the V8 cards.
 * Obvious actions: Cancel visit, Reschedule, Open quote. The rest sit in More.
 */
export default function BookingDetailView({
  booking: b, children, moreOpen, onMoreOpenChange, cancelOpen, cancelBusy, onCancelOpen, onConfirmCancel,
  onReschedule, onOpenQuote,   onReassign, onEdit, onSetPin, onOpenClient, onCloseLead, onReturn, confirmOpen, onConfirmOpen,
}: {
  booking: BookingDetailModel;
  children?: ReactNode;
  moreOpen?: boolean;
  onMoreOpenChange?: (open: boolean) => void;
  cancelOpen: boolean;
  cancelBusy?: boolean;
  onCancelOpen: (open: boolean) => void;
  onConfirmCancel: (reason: CancelVisitReasonId, note: string) => void;
  onReschedule: () => void;
  onOpenQuote: (id: string) => void;
  onReassign: () => void;
  onEdit: () => void;
  onSetPin: () => void;
  onOpenClient: () => void;
  onCloseLead: () => void;
  onReturn: () => void;
  confirmOpen: boolean;
  onConfirmOpen: (open: boolean) => void;
}) {
  const assigned = isAssigned(b);
  const label = assignedLabel(b.tech_name, b.date, b.time);
  const st = bookingStatus(b.status, b.lead_status, assigned);
  const stCls = { green: "bg-[#E8F5E9] text-[#1B5E20]", amber: "bg-[#FFF3E0] text-[#8A3B00]", red: "bg-[#FDECEA] text-[#B71C1C]", blue: "bg-[#E3F2FD] text-[#0D47A1]" }[st.tone];
  const map = mapHref({ lat: b.latitude, lng: b.longitude, notes: b.notes, address: b.customer_address });
  const canEdit = !!(b.perms?.admin || b.perms?.rep);
  const quotes = b.quotes ?? [];
  const pillCls = `inline-block rounded-full px-2.5 py-1 text-left text-xs font-semibold ${assigned ? "bg-[#E8F5E9] text-[#1B5E20]" : "bg-[#FFF3E0] text-[#8A3B00]"}`;
  return (
    <div className="v8-scope mx-auto max-w-3xl space-y-3 p-3 sm:p-6" data-testid="booking-detail">
      <div className="space-y-3 rounded-2xl border bg-white p-4" data-testid="booking-header">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-[#475569]">Booking{b.service_type ? ` · ${b.service_type}` : ""}</p>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stCls}`} data-testid="booking-status">{st.label}</span>
        </div>
        <h1 className="break-words text-[24px] font-semibold leading-tight text-[#0F1B2A]">{b.customer_name || "Client"}</h1>
        {b.customer_address && <p className="flex items-start gap-1 text-sm text-[#334155]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{b.customer_address}</p>}
        <p data-testid="booking-assigned">
          <button type="button" className={pillCls} data-testid="booking-tech-pill" onClick={onReassign}>
            {assigned ? (label || `Tech: ${b.tech_name}`) : (b.date ? `${friendlyWhen(b.date, b.time)} · No technician yet` : "No technician yet")}
          </button>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {canCancelVisit(b.perms) && (
            <button type="button" className="fl-btn-secondary px-4" data-testid="booking-cancel" onClick={() => onCancelOpen(true)}>Cancel visit</button>
          )}
          {canEdit && (
            <button type="button" className="fl-btn-primary px-5" data-testid="booking-reschedule" onClick={onReschedule}>Reschedule</button>
          )}
          {quotes[0] && (
            <button type="button" className="fl-btn-primary px-5" data-testid="booking-open-quote" onClick={() => onOpenQuote(quotes[0].id)}>Open quote</button>
          )}
          {b.customer_phone && <a className="fl-btn-secondary inline-flex items-center px-4" href={`tel:${b.customer_phone}`}><Phone className="mr-1 h-4 w-4" />Call</a>}
          <StaffMoreMenu
            testId="booking-more"
            open={moreOpen}
            onOpenChange={onMoreOpenChange}
            items={[
              { label: "Reassign tech", testId: "booking-reassign", onSelect: onReassign },
              { label: "Confirm booking", testId: "booking-confirm", onSelect: () => onConfirmOpen(true) },
              { label: "Close lead", testId: "booking-close-lead", onSelect: onCloseLead },
              { label: "Edit booking", testId: "booking-edit", onSelect: onEdit, hidden: !canEdit },
              { label: "Set map pin", testId: "booking-set-pin", onSelect: onSetPin, hidden: !canEdit },
              { label: "Open client", testId: "booking-open-client", onSelect: onOpenClient, hidden: !b.customer_id },
              { label: "Return visit", testId: "booking-return-visit", onSelect: onReturn, hidden: !canEdit },
              { label: "Open map", testId: "booking-open-map", onSelect: () => { if (map) window.open(map, "_blank", "noopener"); }, hidden: !map },
            ]}
          />
        </div>
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-2" data-testid="booking-quote-list">
            {quotes.map((q) => (
              <button key={q.id} type="button" className="fl-btn-text px-2" data-testid="booking-quote-link" onClick={() => onOpenQuote(q.id)}>
                {q.quote_number || "Quote"} · {(q.status || "draft").replace(/_/g, " ")}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 rounded-2xl border bg-white p-3" data-testid="booking-notes">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Job notes</p>
          {canEdit && (
            <button type="button" className="fl-btn-text px-2" onClick={onEdit} data-testid="booking-notes-edit">{b.notes ? "Edit" : "Add"}</button>
          )}
        </div>
        <JobInfoBlock types={b.job_types} info={b.job_info} />
        {b.notes ? (
          <CallNotes notes={b.notes} editable={canEdit} onEdit={onEdit} />
        ) : !b.job_types?.length && !b.job_info && (
          canEdit
            ? <button type="button" onClick={onEdit} className="block w-full rounded-lg border border-dashed p-3 text-left text-sm text-muted-foreground" data-testid="booking-notes-add">No job notes yet. Tap to add.</button>
            : <p className="text-sm text-muted-foreground">No job notes yet.</p>
        )}
      </div>
      {children}
      <CancelVisitDialog open={cancelOpen} onOpenChange={onCancelOpen} busy={cancelBusy} onConfirm={onConfirmCancel} />
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center" data-testid="confirm-booking-dialog">
          <div className="w-full max-w-md space-y-3 rounded-2xl border bg-white p-4">
            <p className="text-lg font-semibold text-[#0F1B2A]">Confirm booking</p>
            <p className="text-sm text-[#334155]">This visit stays booked. No call-out fee and no invoice are created.</p>
            <button type="button" className="fl-btn-primary px-4" onClick={() => onConfirmOpen(false)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
