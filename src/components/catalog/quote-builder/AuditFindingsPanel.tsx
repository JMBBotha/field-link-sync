import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlayCircle, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

interface AuditRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
  suppliers_scanned: string[];
  total_products: number;
  total_findings: number;
  status: string;
  error: string | null;
}

interface Finding {
  id: string;
  supplier_name: string | null;
  product_code: string | null;
  short_name: string | null;
  page_number: number | null;
  issue_type: string;
  severity: string;
  details: string | null;
  actual_bbox: any;
}

const SEVERITY_VARIANTS: Record<string, "default" | "destructive" | "secondary"> = {
  error: "destructive",
  warn: "secondary",
};

export const AuditFindingsPanel = () => {
  const [runs, setRuns] = useState<AuditRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingFindings, setLoadingFindings] = useState(false);
  const [running, setRunning] = useState(false);
  const [issueFilter, setIssueFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const loadRuns = async () => {
    setLoadingRuns(true);
    const { data, error } = await (supabase.from("overlay_audit_runs") as any)
      .select("id, started_at, finished_at, triggered_by, suppliers_scanned, total_products, total_findings, status, error")
      .order("started_at", { ascending: false })
      .limit(20);
    setLoadingRuns(false);
    if (error) {
      toast({ title: "Failed to load runs", description: error.message, variant: "destructive" });
      return;
    }
    setRuns((data || []) as AuditRun[]);
    if (data && data.length > 0 && !selectedRunId) {
      setSelectedRunId(data[0].id);
    }
  };

  const loadFindings = async (runId: string) => {
    if (!runId) { setFindings([]); return; }
    setLoadingFindings(true);
    const { data, error } = await (supabase.from("overlay_audit_findings") as any)
      .select("id, supplier_name, product_code, short_name, page_number, issue_type, severity, details, actual_bbox")
      .eq("run_id", runId)
      .order("severity")
      .limit(500);
    setLoadingFindings(false);
    if (error) {
      toast({ title: "Failed to load findings", description: error.message, variant: "destructive" });
      return;
    }
    setFindings((data || []) as Finding[]);
  };

  useEffect(() => { loadRuns(); }, []);
  useEffect(() => { if (selectedRunId) loadFindings(selectedRunId); }, [selectedRunId]);

  const runNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("audit-overlay-data", {
      body: { triggered_by: "manual" },
    });
    setRunning(false);
    if (error) {
      toast({ title: "Audit failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Audit complete",
      description: `Scanned ${data?.total_products ?? 0} products, ${data?.total_findings ?? 0} findings`,
    });
    await loadRuns();
    if (data?.run_id) setSelectedRunId(data.run_id);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return findings
      .filter((f) => issueFilter === "all" ? true : f.issue_type === issueFilter)
      .filter((f) => q
        ? (f.product_code || "").toLowerCase().includes(q) ||
          (f.supplier_name || "").toLowerCase().includes(q)
        : true);
  }, [findings, issueFilter, search]);

  const issueTypes = useMemo(() => {
    const set = new Set<string>();
    findings.forEach((f) => set.add(f.issue_type));
    return Array.from(set);
  }, [findings]);

  const selectedRun = runs.find((r) => r.id === selectedRunId);

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Nightly Audit Findings</h2>
          <p className="text-xs text-muted-foreground">
            Runs automatically at 02:00 UTC. Flags missing/invalid <code className="bg-muted px-1 rounded">row_bbox</code>, page mismatches, and suspicious regions for configured suppliers.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={loadRuns} disabled={loadingRuns}>
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loadingRuns ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5 mr-1.5" />}
            Run audit now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label>Audit run</Label>
          <Select value={selectedRunId} onValueChange={setSelectedRunId}>
            <SelectTrigger><SelectValue placeholder="Select run" /></SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {formatDistanceToNow(new Date(r.started_at), { addSuffix: true })} — {r.status} — {r.total_findings} findings
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Issue type</Label>
          <Select value={issueFilter} onValueChange={setIssueFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All ({findings.length})</SelectItem>
              {issueTypes.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Search code/supplier</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. FTXM35" />
        </div>
      </div>

      {selectedRun && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline">Trigger: {selectedRun.triggered_by}</Badge>
          <Badge variant="outline">Suppliers: {(selectedRun.suppliers_scanned || []).join(", ") || "none"}</Badge>
          <Badge variant="outline">Products scanned: {selectedRun.total_products}</Badge>
          <Badge variant={selectedRun.total_findings > 0 ? "destructive" : "default"}>
            Findings: {selectedRun.total_findings}
          </Badge>
          {selectedRun.error && <Badge variant="destructive">Error: {selectedRun.error}</Badge>}
        </div>
      )}

      {loadingFindings ? (
        <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading findings…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground text-sm">
          {selectedRun ? "No findings for these filters — looks clean!" : "No runs yet. Click \"Run audit now\" to generate findings."}
        </div>
      ) : (
        <div className="overflow-auto max-h-96 border rounded">
          <table className="w-full text-xs">
            <thead className="bg-muted text-left sticky top-0">
              <tr>
                <th className="p-1.5">Severity</th>
                <th className="p-1.5">Supplier</th>
                <th className="p-1.5">Product code</th>
                <th className="p-1.5">Page</th>
                <th className="p-1.5">Issue</th>
                <th className="p-1.5">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="p-1.5">
                    <Badge variant={SEVERITY_VARIANTS[f.severity] || "secondary"} className="text-[10px]">
                      {f.severity}
                    </Badge>
                  </td>
                  <td className="p-1.5 truncate max-w-[140px]">{f.supplier_name || "—"}</td>
                  <td className="p-1.5 font-mono">{f.product_code || "—"}</td>
                  <td className="p-1.5 font-mono">{f.page_number ?? "—"}</td>
                  <td className="p-1.5 font-mono">{f.issue_type}</td>
                  <td className="p-1.5 text-muted-foreground">{f.details || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

export default AuditFindingsPanel;
