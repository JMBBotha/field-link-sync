import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Phone, ExternalLink } from "lucide-react";
import { formatCallDuration } from "@/components/calls/CallHistoryPanel";
import CallRecordingPlayer from "@/components/calls/CallRecordingPlayer";

interface CallRow {
  id: string;
  caller_name: string | null;
  caller_phone: string | null;
  service_type: string | null;
  outcome: string | null;
  duration_seconds: number;
  started_at: string | null;
  created_at: string;
  summary: string | null;
  recording_url: string | null;
  customer_id: string | null;
  lead_id: string | null;
  call_category: string | null;
  is_existing_client: boolean | null;
  quote_id: string | null;
  error_reason: string | null;
  quotes: { id: string; quote_number: string | null } | null;
  customers: { id: string; name: string | null } | null;
  leads: { id: string; service_type: string | null; status: string | null; scheduled_date: string | null; technician_name: string | null } | null;
}

export default function AdminCallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("vapi_calls")
        .select(
          "id, caller_name, caller_phone, service_type, outcome, duration_seconds, started_at, created_at, summary, recording_url, customer_id, lead_id, call_category, is_existing_client, quote_id, error_reason, customers(id, name), leads(id, service_type, status, scheduled_date, technician_name), quotes(id, quote_number)"
        )
        .order("created_at", { ascending: false })
        .limit(200);
      setCalls((data as unknown as CallRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return calls;
    return calls.filter((c) =>
      [c.caller_name, c.caller_phone, c.customers?.name, c.service_type, c.summary]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [calls, search]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Phone className="h-5 w-5" /> Call history
        </h1>
        <Input
          placeholder="Search caller, client or summary…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:w-72"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${filtered.length} call${filtered.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading calls…
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls recorded yet.</p>
          ) : (
            filtered.map((call) => (
              <div key={call.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span>{call.customers?.name || call.caller_name || "Unknown caller"}</span>
                      <span className="text-muted-foreground">{call.caller_phone}</span>
                      <Badge variant="outline">{formatCallDuration(call.duration_seconds)}</Badge>
                      {call.call_category && <Badge variant="secondary">{call.call_category}</Badge>}
                      <Badge variant="outline">{call.is_existing_client ? "Existing client" : "New lead"}</Badge>
                      {call.leads?.status && <Badge>{call.leads.status}</Badge>}
                      {call.quotes?.id && <Badge>Draft estimate {call.quotes.quote_number || ""}</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {new Date(call.started_at || call.created_at).toLocaleString("en-ZA")}
                      {call.leads?.scheduled_date ? ` · booked ${call.leads.scheduled_date}` : ""}
                      {call.leads?.technician_name ? ` · ${call.leads.technician_name}` : ""}
                    </p>
                    {call.error_reason && (
                      <p className="text-xs text-amber-600 dark:text-amber-500">{call.error_reason}</p>
                    )}
                    {call.summary && (
                      <p className="line-clamp-2 max-w-3xl text-sm text-muted-foreground">{call.summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {call.customer_id && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/admin/customers/${call.customer_id}`}>
                          Client <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                    {call.leads?.id && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/admin/leads?lead=${call.leads.id}`}>
                          Job <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                    {call.quotes?.id && (
                      <Button asChild variant="ghost" size="sm">
                        <Link to={`/admin/estimates/${call.quotes.id}`}>
                          Estimate <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  <CallRecordingPlayer callId={call.id} recordingUrl={call.recording_url} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
