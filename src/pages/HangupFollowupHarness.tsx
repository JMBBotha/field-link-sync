/** Demo shots: a short-call admin follow-up, and the bell before and after a lead is dismissed. */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bell } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CallAdminFollowupCard, { type CallAdminFollowupItem } from "@/components/calls/CallAdminFollowupCard";
import NotificationsList from "@/components/notifications/NotificationsList";

const CALL = "c1111111-1111-4111-8111-111111111111";
const LEAD = "l1111111-1111-4111-8111-111111111111";

const followup: CallAdminFollowupItem = {
  id: "f1111111-1111-4111-8111-111111111111",
  phone: "+27606037097",
  called_at: "2026-11-16T13:17:00Z",
  duration_seconds: 5,
  call_id: CALL,
  status: "open",
};

type Note = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  related_id: string | null;
  created_at: string;
  metadata?: Record<string, unknown> | null;
};

const beforeNotes: Note[] = [
  { id: "n1", type: "new_lead", title: "New Lead", body: "Unknown Caller — General Inquiry", read: false, related_id: LEAD, created_at: "2026-11-16T13:17:05Z" },
  { id: "n2", type: "call_logged", title: "Call Logged — General Inquiry", body: "+27606037097 · 5s", read: false, related_id: CALL, created_at: "2026-11-16T13:17:06Z", metadata: { lead_id: LEAD } },
  { id: "n3", type: "sales_nudge", title: "Hot lead waiting", body: "Unknown Caller not contacted yet", read: false, related_id: LEAD, created_at: "2026-11-16T13:24:00Z", metadata: { entity: "lead", stage: "new", level: 1 } },
];

const afterNotes: Note[] = beforeNotes.map((n) => ({ ...n, read: true }));

const closedNotes: Note[] = [
  { id: "n4", type: "new_lead", title: "New Lead", body: "This lead is already closed", read: false, related_id: LEAD, created_at: "2026-11-16T13:48:00Z", metadata: { lead_closed: true } },
];

function BellShot({ title, notes, testId }: { title: string; notes: Note[]; testId: string }) {
  const unread = notes.filter((n) => !n.read).length;
  return (
    <section data-testid={testId} className="w-full max-w-[26rem]">
      <div className="mb-2 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="relative bg-[#0F2A44] text-white hover:bg-[#0F2A44] hover:text-white" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <Badge variant="destructive" className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs" data-testid={`${testId}-badge`}>
              {unread}
            </Badge>
          )}
        </Button>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <NotificationsList
          notifications={notes}
          role="admin"
          onMarkAsRead={() => {}}
          onMarkAllRead={() => {}}
          onClose={() => {}}
        />
      </div>
    </section>
  );
}

export default function HangupFollowupHarness() {
  const [item, setItem] = useState<CallAdminFollowupItem>(followup);
  const [params] = useSearchParams();
  const shot = params.get("shot");
  const show = (name: string) => !shot || shot === name;
  return (
    <div className="min-h-screen space-y-8 bg-[#E7EEF5] p-6 text-[#0F2A44]" data-testid="hangup-followup-harness">
      {show("followup") && (
        <section data-testid="shot-followup" className="mx-auto max-w-xl">
          <h1 className="mb-3 text-lg font-semibold">Short call, no name</h1>
          <CallAdminFollowupCard
            item={item}
            onMakeLead={() => setItem({ ...item, status: "converted" })}
            onDismiss={() => setItem({ ...item, status: "dismissed" })}
          />
        </section>
      )}
      <div className="mx-auto flex max-w-5xl flex-wrap gap-8">
        {show("before") && <BellShot title="Bell before the lead is dismissed" notes={beforeNotes} testId="shot-bell-before" />}
        {show("after") && <BellShot title="Bell after the lead is dismissed" notes={afterNotes} testId="shot-bell-after" />}
        {show("closed") && <BellShot title="New Lead for a lead that is already closed" notes={closedNotes} testId="shot-bell-closed" />}
      </div>
    </div>
  );
}
