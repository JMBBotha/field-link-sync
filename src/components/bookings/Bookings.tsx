import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSalesRep } from "@/hooks/useSalesRep";
import { friendlyWhen } from "@/lib/friendlyWhen";
import { isAssigned, assignedLabel, cardHref } from "@/lib/assignedLabel";

/** An open lead that is (or is about to be) a booking — no job row yet. From client_bookings / pipeline_open_leads (RLS-equivalent scope). */
export interface Booking {
  id: string; customer_id: string | null; customer_name: string | null; address: string | null; intent: string | null; service_type: string | null;
  source: string | null; created_at: string; first_contact_at: string | null; scheduled_date: string | null; scheduled_time: string | null;
  assigned_to: string | null; assigned_name: string | null; has_quote: boolean;
}
export type BookingStage = "booked" | "assigned" | "contacted" | "new";
export const bookingStage = (b: Booking): BookingStage =>
  b.scheduled_date ? "booked" : b.assigned_to ? "assigned" : b.first_contact_at || b.source === "manual" ? "contacted" : "new";
export const STAGE_LABEL: Record<BookingStage, string> = { booked: "Booked", assigned: "Assigned · not scheduled", contacted: "Contacted · not scheduled", new: "New · not contacted" };
export const bookingLine = (b: Booking) => {
  const st = bookingStage(b);
  if (isAssigned(b) && b.scheduled_date) return assignedLabel(b.assigned_name || "a technician", b.scheduled_date, b.scheduled_time);
  if (st === "booked") return ["Booked", b.assigned_name ? `with ${b.assigned_name}` : null, "for", friendlyWhen(b.scheduled_date, b.scheduled_time)].filter(Boolean).join(" ");
  if (st === "assigned") return `With ${b.assigned_name || "a technician"} · not scheduled`;
  return STAGE_LABEL[st];
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const bookingHref = (b: Booking, _salesRep?: boolean) => cardHref({ lead_id: b.id }) ?? `/admin/bookings/${b.id}`;
const sast = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const SRC: Record<string, string> = { manual: "Added by hand", vapi_call: "Mandy call", website_form: "Website", whatsapp: "WhatsApp", phone: "Phone", email: "Email" };
export const sourceText = (s?: string | null) => (s ? SRC[s] ?? s : "Added");

export function useClientBookings(customerId?: string | null) {
  return useQuery({
    queryKey: ["client-bookings", customerId], enabled: !!customerId, refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("client_bookings", { p_customer: customerId });
      if (error) throw error;
      return (data || []) as Booking[];
    },
  });
}
export function usePipelineOpenLeads() {
  return useQuery({
    queryKey: ["pipeline-open-leads"], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("pipeline_open_leads");
      if (error) throw error;
      return (data || []) as Booking[];
    },
  });
}

/** "Upcoming: booked with Innocent Mattienga for Tue 10 Nov, 08:00" — top of the client card. */
export function UpcomingLine({ customerId }: { customerId: string }) {
  const { data = [] } = useClientBookings(customerId);
  const next = data.find((b) => b.scheduled_date) ?? data[0];
  if (!next) return null;
  const st = bookingStage(next);
  return (
    <p data-testid="client-upcoming" className="mt-1.5 inline-block rounded-lg bg-white/15 px-2.5 py-1 text-[14px] font-semibold text-white break-words">
      {isAssigned(next) && next.scheduled_date ? `Upcoming: ${bookingLine(next)}` : st === "booked" ? `Upcoming: booked for ${friendlyWhen(next.scheduled_date, next.scheduled_time)}` : `Open: ${bookingLine(next).toLowerCase()}`}
      {data.length > 1 ? ` · +${data.length - 1} more` : ""}
    </p>
  );
}

export function BookingRow({ b, showClient = false }: { b: Booking; showClient?: boolean }) {
  const navigate = useNavigate();
  const { isSalesRep } = useSalesRep();
  const st = bookingStage(b);
  return (
    <button onClick={() => navigate(bookingHref(b, isSalesRep))} data-testid="booking-row"
      className="flex w-full min-h-14 flex-col items-start gap-0.5 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/40">
      {showClient && <span className="text-[16px] font-semibold">{b.customer_name || "Client"}</span>}
      <span className={st === "booked" ? "text-[15px] font-semibold text-[#1B5E20]" : st === "new" ? "text-[15px] font-semibold text-[#C62828]" : "text-[15px] font-semibold text-[#E65100]"}>{bookingLine(b)}</span>
      <span className="text-[13px]">{[b.service_type || (b.intent === "service" ? "Service" : "Sales"), b.has_quote ? "has quote" : null].filter(Boolean).join(" · ")}</span>
      <span className="text-[12px] text-muted-foreground">{sourceText(b.source)} · {sast(b.created_at)}</span>
    </button>
  );
}

/** Bookings list for the client Jobs tab. */
export function ClientBookingsList({ customerId }: { customerId: string }) {
  const { data = [] } = useClientBookings(customerId);
  if (!data.length) return null;
  return (
    <div data-testid="client-bookings" className="mb-2">
      <p className="px-4 pb-1 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Bookings · no job yet</p>
      {data.map((b) => <BookingRow key={b.id} b={b} />)}
    </div>
  );
}

/** Activity timeline items for bookings (added, booked). */
export function BookingActivity({ customerId }: { customerId: string }) {
  const { data = [] } = useClientBookings(customerId);
  const navigate = useNavigate();
  const { isSalesRep } = useSalesRep();
  if (!data.length) return null;
  const items = data.flatMap((b) => [
    ...(b.scheduled_date || b.assigned_to ? [{ k: `${b.id}-b`, b, title: bookingLine(b), sub: b.service_type || "" }] : []),
    { k: `${b.id}-c`, b, title: `${b.intent === "service" ? "Service request" : "Sales lead"} ${sourceText(b.source).toLowerCase()}`, sub: sast(b.created_at) },
  ]);
  return (
    <ul data-testid="booking-activity" className="mb-3 space-y-2">
      {items.map((i) => (
        <li key={i.k}><button onClick={() => navigate(bookingHref(i.b, isSalesRep))} className="w-full rounded-xl border bg-card px-3 py-2 text-left">
          <div className="text-[15px] font-semibold">{i.title}</div>{i.sub && <div className="text-[12px] text-muted-foreground">{i.sub}</div>}
        </button></li>
      ))}
    </ul>
  );
}

/** Pipeline: rep's own bookings & leads (owner-rep rule), grouped by stage. Admin sees booked/assigned only (open leads are already on the board). */
export function PipelineBookings({ ownOnly }: { ownOnly: boolean }) {
  const { data = [], isLoading } = usePipelineOpenLeads();
  const rows = ownOnly ? data : data.filter((b) => b.scheduled_date || b.assigned_to);
  if (isLoading) return null;
  if (!rows.length) return ownOnly ? (
    <div data-testid="pipeline-empty" className="rounded-2xl border bg-card p-4 text-[15px]">
      <p className="font-semibold">Nothing in your pipeline yet</p>
      <p className="mt-1 text-[14px] text-muted-foreground">Your leads, bookings and quotes land here — anything assigned to you, that you created, or for clients where you're the rep.</p>
    </div>
  ) : null;
  const order: BookingStage[] = ["new", "contacted", "assigned", "booked"];
  return (
    <div data-testid="pipeline-bookings" className="rounded-2xl border bg-card">
      <p className="px-4 pt-3 text-[15px] font-semibold">Leads & bookings <span className="text-[13px] font-normal text-muted-foreground">{rows.length}</span></p>
      {order.map((st) => {
        const l = rows.filter((b) => bookingStage(b) === st);
        return l.length ? <div key={st}><p className="px-4 pt-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{st === "booked" ? "Scheduled / booked" : STAGE_LABEL[st]}</p>
          {l.map((b) => <BookingRow key={b.id} b={b} showClient />)}</div> : null;
      })}
    </div>
  );
}
