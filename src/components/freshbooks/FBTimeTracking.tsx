import { useState, useEffect, useRef, useCallback } from "react";
import { useCompany } from "@/providers/CompanyProvider";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Clock, Play, Square, Timer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

const FBTimeTracking = () => {
  const { companyId } = useCompany();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ hours: "1", minutes: "0", date: new Date().toISOString().split("T")[0], billable: true, notes: "", project_id: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [timerProject, setTimerProject] = useState("");
  const [timerBillable, setTimerBillable] = useState(true);
  const [timerNotes, setTimerNotes] = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRunning) {
      intervalRef.current = setInterval(() => setTimerSeconds(s => s + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerRunning]);

  const formatTimer = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["fb-time-entries", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_time_entries").select("*, fb_projects(name)").eq("company_id", companyId!).order("date", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["fb-projects-for-time", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("fb_projects").select("id, name").eq("company_id", companyId!).order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const createMutation = useMutation({
    mutationFn: async (payload: { hours: string; minutes: string; date: string; billable: boolean; notes: string; project_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");
      const durationStr = `${payload.hours} hours ${payload.minutes} minutes`;
      const { error } = await supabase.from("fb_time_entries").insert({
        company_id: companyId!, user_id: session.user.id, duration: durationStr,
        date: payload.date, billable: payload.billable, notes: payload.notes || null,
        project_id: payload.project_id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["fb-time-entries"] }); toast({ title: "Time entry added" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleManualSave = () => {
    createMutation.mutate(form);
    setShowCreate(false);
  };

  const handleStopTimer = useCallback(() => {
    setTimerRunning(false);
    const totalMinutes = Math.ceil(timerSeconds / 60);
    const h = Math.floor(totalMinutes / 60).toString();
    const m = (totalMinutes % 60).toString();
    createMutation.mutate({
      hours: h, minutes: m,
      date: new Date().toISOString().split("T")[0],
      billable: timerBillable, notes: timerNotes,
      project_id: timerProject,
    });
    setTimerSeconds(0);
    setTimerNotes("");
  }, [timerSeconds, timerBillable, timerNotes, timerProject, createMutation]);

  const HOURLY_RATE = 450;
  const fmt = (n: number) => new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

  const parseDurationHours = (dur: string) => {
    const d = String(dur || "");
    // Handle HH:MM:SS format
    const hmsMatch = d.match(/^(\d+):(\d+):(\d+)$/);
    if (hmsMatch) return Number(hmsMatch[1]) + Number(hmsMatch[2]) / 60 + Number(hmsMatch[3]) / 3600;
    // Handle "X hours Y minutes" format
    const hMatch = d.match(/(\d+)\s*hour/);
    const mMatch = d.match(/(\d+)\s*min/);
    return (hMatch ? Number(hMatch[1]) : 0) + (mMatch ? Number(mMatch[1]) / 60 : 0);
  };

  const totalHours = entries.reduce((sum: number, e: any) => sum + parseDurationHours(e.duration), 0);
  const billableAmount = entries.reduce((sum: number, e: any) => e.billable ? sum + parseDurationHours(e.duration) * HOURLY_RATE : sum, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Time Tracking</h2>
          <p className="text-sm text-muted-foreground">
            Total: {totalHours.toFixed(1)} hours logged · Billable: {fmt(billableAmount)}
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="bg-blue-600 hover:bg-blue-700 text-white"><Plus className="h-4 w-4 mr-2" />Log Time</Button>
      </div>

      {/* Live Timer */}
      <div className="bg-card rounded-lg shadow-sm border border-border p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-blue-500" />
            <span className="text-2xl font-mono font-bold text-foreground">{formatTimer(timerSeconds)}</span>
          </div>
          <Select value={timerProject} onValueChange={setTimerProject}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>{projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input placeholder="What are you working on?" value={timerNotes} onChange={e => setTimerNotes(e.target.value)} className="flex-1 min-w-[200px]" />
          <div className="flex items-center gap-2">
            <Switch checked={timerBillable} onCheckedChange={setTimerBillable} />
            <span className="text-sm text-muted-foreground">Billable</span>
          </div>
          {timerRunning ? (
            <Button variant="destructive" size="sm" onClick={handleStopTimer}><Square className="h-4 w-4 mr-1" />Stop</Button>
          ) : (
            <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => setTimerRunning(true)}><Play className="h-4 w-4 mr-1" />Start</Button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/50">
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Date</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Project</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Duration</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Billable</th>
            <th className="text-left px-4 py-3 font-medium text-muted-foreground">Notes</th>
          </tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            : entries.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No time entries</td></tr>
            : entries.map((e: any) => (
              <tr key={e.id} className="border-b border-border/50 hover:bg-muted/30">
                <td className="px-4 py-3">{e.date}</td>
                <td className="px-4 py-3">{e.fb_projects?.name || "—"}</td>
                <td className="px-4 py-3 flex items-center gap-1"><Clock className="h-3.5 w-3.5 text-muted-foreground" />{String(e.duration)}</td>
                <td className="px-4 py-3">{e.billable ? <Badge variant="secondary" className="bg-green-100 text-green-700">Yes</Badge> : <Badge variant="secondary">No</Badge>}</td>
                <td className="px-4 py-3 text-muted-foreground truncate max-w-[200px]">{e.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Log Time Manually</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Project</Label>
              <Select value={form.project_id} onValueChange={v => setForm(f => ({ ...f, project_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select project (optional)" /></SelectTrigger>
                <SelectContent>{projects.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Hours</Label><Input type="number" min="0" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} /></div>
              <div><Label>Minutes</Label><Input type="number" min="0" max="59" value={form.minutes} onChange={e => setForm(f => ({ ...f, minutes: e.target.value }))} /></div>
            </div>
            <div><Label>Date</Label><Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div className="flex items-center gap-3"><Switch checked={form.billable} onCheckedChange={v => setForm(f => ({ ...f, billable: v }))} /><Label>Billable</Label></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <Button onClick={handleManualSave} className="w-full bg-blue-600 hover:bg-blue-700 text-white">Log Time</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FBTimeTracking;
