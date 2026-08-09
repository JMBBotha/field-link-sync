export type Row = Record<string, unknown>;
export type Structured = { tool_name: string; rows: Row[] };

export const TOOL_LABELS: Record<string, string> = {
  query_leads: "Leads",
  get_overdue_invoices: "Overdue invoices",
  query_jobs: "Jobs",
  search_customer: "Customers",
  get_staff_availability: "Staff availability",
  get_unassigned_queue: "Unassigned queue",
  create_quote_draft: "Create draft quote",
  assign_job: "Assign job",
};

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) return new Date(str).toLocaleString("en-ZA");
  return str;
}

/** Shared result renderer — identical cards for text answers and voice answers. */
const ResultTable = ({ block }: { block: Structured }) => {
  if (!block.rows.length) {
    return (
      <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {TOOL_LABELS[block.tool_name] ?? block.tool_name}: no matching records.
      </div>
    );
  }
  const columns = Object.keys(block.rows[0]);
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="bg-muted/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
        {TOOL_LABELS[block.tool_name] ?? block.tool_name} · {block.rows.length}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-card">
              {columns.map((c) => (
                <th key={c} className="px-2 py-1.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                  {c.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1.5 text-foreground whitespace-nowrap max-w-[220px] truncate">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultTable;
