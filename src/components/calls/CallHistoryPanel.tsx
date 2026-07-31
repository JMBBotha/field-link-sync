import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Phone, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";

export interface CallRecord {
  id: string;
  provider_call_id: string | null;
  caller_phone: string | null;
  caller_name: string | null;
  customer_id: string | null;
  lead_id: string | null;
  started_at: string | null;
  duration_seconds: number;
  ended_reason: string | null;
  service_type: string | null;
  urgency: string | null;
  summary: string | null;
  transcript: string | null;
  recording_url: string | null;
  outcome: string | null;
  created_at: string;
}

interface Props {
  customerId?: string;
  leadId?: string;
  limit?: number;
  title?: string;
  className?: string;
}

export function formatCallDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

const outcomeLabel: Record<string, string> = {
  lead_created: "Lead created",
  lead_enriched: "Lead updated",
  lead_failed: "No lead saved",
  no_lead: "No lead",
};

export default function CallHistoryPanel({
  customerId,
  leadId,
  limit = 20,
  title = "Call history",
  className,
}: Props) {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!customerId && !leadId) {
        setCalls([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      let query = supabase
        .from("vapi_calls")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (leadId) query = query.eq("lead_id", leadId);
      else if (customerId) query = query.eq("customer_id", customerId);

      const { data } = await query;
      if (active) {
        setCalls((data as CallRecord[]) || []);
        setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [customerId, leadId, limit]);

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4" />
          {title}
          {!loading && <Badge variant="secondary">{calls.length}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading calls…
          </div>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recorded calls yet.</p>
        ) : (
          calls.map((call) => (
            <Collapsible key={call.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    <span>
                      {new Date(call.started_at || call.created_at).toLocaleString("en-ZA", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <Badge variant="outline">{formatCallDuration(call.duration_seconds)}</Badge>
                    {call.service_type && <Badge variant="secondary">{call.service_type}</Badge>}
                    {call.outcome && (
                      <Badge variant={call.outcome === "no_lead" ? "outline" : "default"}>
                        {outcomeLabel[call.outcome] || call.outcome}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {call.caller_name || "Unknown caller"} · {call.caller_phone || "no number"}
                    {call.ended_reason ? ` · ended: ${call.ended_reason}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {call.lead_id && !leadId && (
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/admin/leads?lead=${call.lead_id}`}>
                        Lead <ExternalLink className="ml-1 h-3 w-3" />
                      </Link>
                    </Button>
                  )}
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm">
                      Details <ChevronDown className="ml-1 h-3 w-3" />
                    </Button>
                  </CollapsibleTrigger>
                </div>
              </div>

              <CollapsibleContent className="mt-3 space-y-3">
                {call.summary && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Summary</p>
                    <p className="text-sm whitespace-pre-wrap">{call.summary}</p>
                  </div>
                )}
                {call.recording_url && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Recording</p>
                    <audio controls src={call.recording_url} className="mt-1 w-full" />
                  </div>
                )}
                {call.transcript && (
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Transcript</p>
                    <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                      {call.transcript}
                    </pre>
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
          ))
        )}
      </CardContent>
    </Card>
  );
}
