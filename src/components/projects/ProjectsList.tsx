import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Loader2, FolderKanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useProjects, useInvalidateProject, clientName, db } from "@/hooks/useProjectTracker";
import { DEFAULT_PHASES } from "@/lib/projectTracker";

/** Projects list. With customerId: that client's projects + "New project". Without: every client (admin sidebar). */
export default function ProjectsList({ customerId, companyId }: { customerId?: string; companyId?: string | null }) {
  const { data = [], isLoading } = useProjects(customerId);
  const invalidate = useInvalidateProject();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!customerId || !companyId || !name.trim()) return;
    setBusy(true);
    const { data: p, error } = await db.from("projects").insert({ customer_id: customerId, company_id: companyId, name: name.trim(), code: name.trim().toUpperCase() }).select("id, company_id").single();
    if (!error && p) await db.from("project_phases").insert(DEFAULT_PHASES.map((ph) => ({ ...ph, project_id: p.id, company_id: p.company_id })));
    setBusy(false);
    if (error) toast({ title: "Couldn't create project", description: error.message, variant: "destructive" });
    else { setName(""); invalidate(); }
  };
  if (isLoading) return <Skeleton className="h-24 w-full" />;
  return (
    <div className="space-y-3" data-testid="projects-list">
      {customerId && (
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New project name, e.g. AVEC" className="max-w-xs" onKeyDown={(e) => e.key === "Enter" && create()} />
          <Button onClick={create} disabled={busy || !name.trim() || !companyId}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} New project</Button>
        </div>)}
      {data.length === 0 ? <div className="rounded-xl border p-6 text-center text-sm text-muted-foreground">No projects yet.</div> : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((p) => (
            <Link key={p.id} to={`/admin/projects/${p.id}`} className="rounded-xl border bg-card p-3 hover:border-[#1590D6]">
              <div className="flex items-center gap-2 font-semibold"><FolderKanban className="h-4 w-4 text-[#1590D6]" /> {p.name}</div>
              <div className="text-xs text-muted-foreground">{!customerId && `${clientName(p.customers)} · `}{p.project_houses?.[0]?.count ?? 0} houses{p.po_number ? ` · PO ${p.po_number}` : ""} · {p.status}</div>
            </Link>))}
        </div>)}
    </div>
  );
}
