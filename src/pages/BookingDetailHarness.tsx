/** Demo shots for the booking page. Harness rows only — not live clients. */
import { useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import BookingDetailView from "@/components/jobs/BookingDetailView";
import TechPickerMessage from "@/components/jobs/TechPickerMessage";

const NOTES = `Source: phone
Call duration: 84s
Ended reason: customer-ended
Transcript:
AI: Hello, this is the office.
User: The lounge unit is leaking. Can someone come tomorrow morning?
AI: I can book a technician before ten.
User: Yes please. The gate code is 2468.`;

const booking = {
  id: "demo-lead",
  customer_name: "Demo Client",
  customer_phone: "0210000000",
  customer_address: "14 Demo Lane, Claremont",
  customer_id: "demo-client",
  service_type: "Service",
  job_types: ["service"],
  job_info: "Lounge unit leaking. Demo note only.",
  notes: NOTES,
  tech_name: "Demo Tech A",
  date: "2026-11-12",
  time: "09:00",
  status: "assigned",
  lead_status: "routed",
  assigned_agent_id: "tech-a",
  perms: { admin: true, rep: false, office: true, view: true },
  quotes: [{ id: "q-demo", quote_number: "Q-D-014", status: "sent" }],
};

export default function BookingDetailHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "page";
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F1B2A]" data-testid="booking-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BEB" }}>
        <b>Booking</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live client data</small>
      </header>
      <BookingDetailView
        booking={booking}
        moreOpen={shot === "more" ? true : undefined}
        cancelOpen={shot === "cancel"}
        onCancelOpen={() => {}}
        onConfirmCancel={() => {}}
        onReschedule={() => {}}
        onOpenQuote={() => {}}
        onReassign={() => {}}
        onEdit={() => {}}
        onSetPin={() => {}}
        onOpenClient={() => {}}
        onCloseLead={() => {}}
        onReturn={() => {}}
        confirmOpen={false}
        onConfirmOpen={() => {}}
      >
        <div className="rounded-2xl border bg-white p-4 text-sm" data-testid="harness-visit">
          <p className="font-semibold">Visit</p>
          <p className="text-[#334155]">Thu 12 Nov · 09:00–12:00 · Demo Tech A</p>
        </div>
      </BookingDetailView>
      {shot === "techs" && (
        <Dialog open>
          <DialogContent className="max-w-md" data-testid="lead-assign-dialog">
            <DialogHeader>
              <DialogTitle>Assign lead</DialogTitle>
              <DialogDescription>Demo Client – Service · now with Demo Tech A</DialogDescription>
            </DialogHeader>
            <TechPickerMessage phase="loading" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
