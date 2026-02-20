import { useState } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const FBTimeTracking = () => {
  const { companyId } = useCompany();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ hours: "1", minutes: "0", date: new Date().toISOString().split("T")[0], billable: true, notes: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["fb-time-entries", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_time_entries").select("*, fb_projects(name)").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const durationStr = `${form.hours} hours ${form.minutes} minutes`;
      const { error } = await supabase.from("fb_time_entries").insert({
        company_id: companyId!, user_id: session.user.id, duration: durationStr,
        date: form.date, billable: form.billable, notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-time-entries"] }); setShowCreate(false); toast({ title: "Time entry added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-[hsl(0,0%,29%)]">Time Tracking</h2>
        <Button onClick={() => setShowCreate(true)} className="bg-[hsl(211,100%,43%)] hover:bg-[hsl(211,100%,38%)]"><Plus className="h-4 w-4 mr-2" />Log Time</Button>
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-[hsl(0,0%,90%)] overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-[hsl(0,0%,98%)]">
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Date</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Project</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Duration</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Billable</th>
            <th className="text-left px-4 py-3 font-medium text-[hsl(0,0%,53%)]">Notes</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">Loading...</td></tr>
            : entries.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-[hsl(0,0%,53%)]">No time entries</td></tr>
            : entries.map((e: any) => (
              <tr key={e.id} className="border-b border-[hsl(0,0%,95%)] hover:bg-[hsl(0,0%,98%)]">
                <td className="px-4 py-3">{e.date}</td>
                <td className="px-4 py-3">{e.fb_projects?.name || "—"}</td>
                <td className="px-4 py-3 flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-[hsl(0,0%,53%)]" />{e.duration}</td>
                <td className="px-4 py-3">{e.billable ? <Badge variant="secondary" className="bg-green-100 text-green-700">Yes</Badge> : <Badge variant="secondary">No</Badge>}</td>
                <td className="px-4 py-3 text-[hsl(0,0%,53%)] truncate max-w-[200px]">{e.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hours</Label><Input type="number" min="0" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></div>
              <div><Label>Minutes</Label><Input type="number" min="0" max="59" value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} /></div>
            </div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="flex items-center gap-3"><Switch checked={form.billable} onCheckedChange={v => setForm(f => ({ ...f, billable: v }))} /><Label>Billable</Label></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <Button onClick={() => createMutation.mutate()} className="w-full bg-[hsl(211,100%,43%)]">Log Time</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBTimeTracking;
