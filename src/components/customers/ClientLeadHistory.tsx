import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ClientHistoryLead = {
  id: string;
  customer_name?: string | null;
  status?: string | null;
  service_type?: string | null;
  created_at?: string | null;
  archived_at?: string | null;
  archive_reason?: string | null;
};

/** Archived stamp used on a client's quotes and leads. */
export function ArchivedTag({ at, reason }: { at?: string | null; reason?: string | null }) {
  if (!at) return null;
  const when = Number.isNaN(new Date(at).getTime()) ? at : format(new Date(at), "dd MMM yyyy");
  return (
    <span data-testid="archived-tag" className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-300/40 dark:bg-amber-500/15 dark:text-amber-100">Archived</Badge>
      <span className="text-xs text-muted-foreground">{when}{reason ? ` · ${reason}` : ""}</span>
    </span>
  );
}

/** Leads for one client, including archived ones, so an archive does not remove the history. */
export function ClientLeadHistory({ leads, canRestore, onRestore }: {
  leads: ClientHistoryLead[];
  canRestore?: boolean;
  onRestore?: (lead: ClientHistoryLead) => void;
}) {
  return (
    <div data-testid="client-leads" className="px-2 pb-4 md:px-4">
      <p className="mb-2 text-sm font-semibold">Leads</p>
      {leads.length === 0 && <p className="text-sm text-muted-foreground">No leads yet.</p>}
      <ul className="divide-y">
        {leads.map((lead) => (
          <li key={lead.id} data-testid="client-lead-row" className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{lead.customer_name || "Lead"}</div>
              <div className="text-xs text-muted-foreground">{[lead.status || "pending", lead.service_type, lead.created_at ? format(new Date(lead.created_at), "dd MMM yyyy") : null].filter(Boolean).join(" · ")}</div>
              <ArchivedTag at={lead.archived_at} reason={lead.archive_reason} />
            </div>
            {lead.archived_at && canRestore && onRestore && (
              <Button size="sm" variant="outline" data-testid="client-lead-restore" onClick={() => onRestore(lead)}>Restore</Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
