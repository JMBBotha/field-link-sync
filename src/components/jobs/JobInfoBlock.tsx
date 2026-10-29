const LABEL: Record<string, string> = { service: "Service", repair: "Repair", installation: "Installation" };

/** Job type(s) + job information from the office/sales Assign step. Shown to the assigned tech only. */
export default function JobInfoBlock({ types, info }: { types?: string[] | null; info?: string | null }) {
  if (!types?.length && !info) return null;
  return (
    <div className="space-y-1 rounded-lg border bg-muted/40 p-2 text-sm" data-testid="job-info">
      {!!types?.length && (
        <div className="flex flex-wrap gap-1">
          {types.map((t) => <span key={t} className="rounded-full border bg-background px-2 py-0.5 text-xs font-semibold">{LABEL[t] || t}</span>)}
        </div>
      )}
      {info && <p className="whitespace-pre-wrap">{info}</p>}
    </div>
  );
}
