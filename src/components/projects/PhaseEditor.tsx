import { useEffect, useState } from "react";
import { Settings2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db, type ProjectRow } from "@/hooks/useProjectTracker";
import type { ProjectPhase } from "@/lib/projectTracker";

type Row = Partial<ProjectPhase> & { name: string; house_from: number | null; house_to: number | null; _del?: boolean };

export default function PhaseEditor({ project, phases, onSaved }: { project: ProjectRow; phases: ProjectPhase[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const { toast } = useToast();
  useEffect(() => { if (open) setRows(phases.map((p) => ({ ...p }))); }, [open, phases]);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const save = async () => {
    let i = 0;
    for (const r of rows) {
      const body = { name: r.name, house_from: r.house_from, house_to: r.house_to, sort_order: ++i };
      const res = r._del ? (r.id ? await db.from("project_phases").delete().eq("id", r.id) : { error: null })
        : r.id ? await db.from("project_phases").update(body).eq("id", r.id)
        : await db.from("project_phases").insert({ ...body, project_id: project.id, company_id: project.company_id });
      if (res.error) return toast({ title: "Couldn't save phases", description: res.error.message, variant: "destructive" });
    }
    setOpen(false); onSaved();
  };
  return (<>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}><Settings2 className="h-4 w-4 mr-1" /> Phases</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit phases</DialogTitle></DialogHeader>
        <div className="space-y-2">
          {rows.map((r, i) => !r._del && (
            <div key={r.id || i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-2">
              <Input value={r.name} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Phase name" />
              <Input type="number" placeholder="From" value={r.house_from ?? ""} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, house_from: num(e.target.value) } : x))} />
              <Input type="number" placeholder="To (blank = +)" value={r.house_to ?? ""} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, house_to: num(e.target.value) } : x))} />
              <Button size="icon" variant="ghost" aria-label="Remove phase" onClick={() => setRows(rows.map((x, j) => j === i ? { ...x, _del: true } : x))}><Trash2 className="h-4 w-4" /></Button>
            </div>))}
          <Button size="sm" variant="outline" onClick={() => setRows([...rows, { name: `Phase ${rows.filter((r) => !r._del).length + 1}`, house_from: null, house_to: null }])}><Plus className="h-4 w-4 mr-1" /> Add phase</Button>
          <p className="text-xs text-muted-foreground">Houses fall into a phase by number unless a house has its own phase set. Removing a phase never deletes houses.</p>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>);
}
