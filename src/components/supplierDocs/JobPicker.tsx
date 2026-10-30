import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { searchJobs } from "./api";

export default function JobPicker({ companyId, exclude = [], onPick }: { companyId: string; exclude?: string[]; onPick: (job: any) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => searchJobs(companyId, q).then((r) => live && setRows(r)), 250);
    return () => { live = false; clearTimeout(t); };
  }, [companyId, q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Search job or client name" value={q} onChange={(e) => setQ(e.target.value)} data-testid="sjd-job-search" />
      <div className="max-h-48 overflow-auto rounded-md border divide-y">
        {rows.filter((r) => !exclude.includes(r.id)).map((r) => (
          <button type="button" key={r.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted" onClick={() => onPick(r)}>
            <div className="font-medium truncate">{r.customers?.name ?? "Client"} · {r.title ?? "Job"}</div>
            <div className="text-xs text-muted-foreground">{r.scheduled_for ? new Date(r.scheduled_for).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" }) : "Not scheduled"} · {r.status}</div>
          </button>
        ))}
        {!rows.length && <div className="px-3 py-2 text-xs text-muted-foreground">No jobs found</div>}
      </div>
    </div>
  );
}
