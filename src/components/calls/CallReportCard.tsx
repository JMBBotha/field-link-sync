import { Badge } from "@/components/ui/badge";

export interface CallReport {
  id: string;
  call_id: string;
  lead_id: string | null;
  caller_name: string | null;
  caller_phone: string | null;
  breakdown: string | null;
  lead_level: string | null;
  urgency: string | null;
  score: number | null;
  service_type: string | null;
  next_action: string | null;
  address_confirmed: boolean | null;
  address: string | null;
  is_test: boolean;
  status: string;
  error: string | null;
  email_status: string | null;
  email_to: string | null;
  created_at: string;
}

const levelVariant = (l: string | null) =>
  l === "hot" ? "destructive" : l === "warm" ? "default" : "secondary";

export default function CallReportCard({ report, showCaller }: { report: CallReport; showCaller?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-2 text-sm space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Call report</span>
        {report.is_test && <Badge variant="outline">Test</Badge>}
        {report.status === "failed" && <Badge variant="destructive">Failed</Badge>}
        {report.status === "pending" && <Badge variant="outline">Pending</Badge>}
        {report.lead_level && <Badge variant={levelVariant(report.lead_level) as any}>{report.lead_level.toUpperCase()}</Badge>}
        {report.urgency && <Badge variant="outline">{report.urgency.replace("_", " ")}</Badge>}
        {report.score != null && <Badge variant="secondary">Score {report.score}/5</Badge>}
        {report.service_type && <Badge variant="outline">{report.service_type}</Badge>}
      </div>
      {showCaller && (
        <p className="text-xs text-muted-foreground">
          {report.caller_name || "Unknown caller"} · {report.caller_phone || "no number"} ·{" "}
          {new Date(report.created_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}
      {report.breakdown && <p className="whitespace-pre-wrap">{report.breakdown}</p>}
      {report.next_action && (
        <p><span className="font-medium">Next: </span>{report.next_action}</p>
      )}
      {report.status === "done" && (
        <p className="text-xs text-muted-foreground">
          Address {report.address_confirmed ? "confirmed" : "not confirmed"}
          {report.address ? ` · ${report.address}` : ""}
        </p>
      )}
      {report.error && <p className="text-xs text-destructive">{report.error}</p>}
      <p className="text-[11px] text-muted-foreground">
        Email: {report.email_status || "not sent"}{report.email_to ? ` → ${report.email_to}` : ""}
      </p>
    </div>
  );
}
