import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, ChevronDown, ChevronRight, History, Loader2 } from "lucide-react";
import { format } from "date-fns";

const ACTION_COLORS: Record<string, string> = {
  insert: "bg-green-500 text-white",
  update: "bg-blue-500 text-white",
  delete: "bg-red-500 text-white",
};

const AuditLogViewer = () => {
  const [search, setSearch] = useState("");
  const [tableFilter, setTableFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["audit-log", search, tableFilter, actionFilter],
    queryFn: async () => {
      let query = supabase
        .from("audit_log" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (tableFilter !== "all") {
        query = query.eq("table_name", tableFilter);
      }
      if (actionFilter !== "all") {
        query = query.eq("action", actionFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const filteredLogs = logs.filter((log: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      log.table_name?.toLowerCase().includes(s) ||
      log.record_id?.toLowerCase().includes(s) ||
      JSON.stringify(log.new_data)?.toLowerCase().includes(s) ||
      JSON.stringify(log.old_data)?.toLowerCase().includes(s)
    );
  });

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const tables = ["all", "quotes", "invoices", "payments", "leads", "service_agreements"];
  const actions = ["all", "insert", "update", "delete"];

  const renderJsonDiff = (log: any) => {
    if (log.action === "update" && log.old_data && log.new_data) {
      const changes: { key: string; old: any; new: any }[] = [];
      for (const key of Object.keys(log.new_data)) {
        if (JSON.stringify(log.old_data[key]) !== JSON.stringify(log.new_data[key])) {
          changes.push({ key, old: log.old_data[key], new: log.new_data[key] });
        }
      }
      if (changes.length === 0) return <p className="text-xs text-muted-foreground">No visible changes</p>;
      return (
        <div className="space-y-1">
          {changes.map((c) => (
            <div key={c.key} className="text-xs font-mono">
              <span className="font-semibold text-foreground">{c.key}:</span>{" "}
              <span className="text-red-500 line-through">{JSON.stringify(c.old)}</span>{" "}
              → <span className="text-green-600">{JSON.stringify(c.new)}</span>
            </div>
          ))}
        </div>
      );
    }
    const data = log.new_data || log.old_data;
    return (
      <pre className="text-xs font-mono bg-muted p-2 rounded max-h-48 overflow-auto whitespace-pre-wrap">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  };

  return (
    <div className="space-y-4 p-4 max-w-6xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <History className="h-5 w-5 text-primary" />
        <h2 className="text-xl font-bold">Audit Log</h2>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search records..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={tableFilter} onValueChange={setTableFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Table" />
          </SelectTrigger>
          <SelectContent>
            {tables.map((t) => (
              <SelectItem key={t} value={t}>{t === "all" ? "All Tables" : t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            {actions.map((a) => (
              <SelectItem key={a} value={a}>{a === "all" ? "All Actions" : a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p>No audit entries found</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Timestamp</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Record ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log: any) => (
                <Collapsible key={log.id} open={expandedRows.has(log.id)} onOpenChange={() => toggleRow(log.id)} asChild>
                  <>
                    <CollapsibleTrigger asChild>
                      <TableRow className="cursor-pointer hover:bg-muted/50">
                        <TableCell>
                          {expandedRows.has(log.id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(new Date(log.created_at), "dd MMM yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">{log.table_name}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className={`text-[10px] ${ACTION_COLORS[log.action] || ""}`}>
                            {log.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono truncate max-w-[200px]">
                          {log.record_id?.slice(0, 8)}...
                        </TableCell>
                      </TableRow>
                    </CollapsibleTrigger>
                    <CollapsibleContent asChild>
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 p-4">
                          {renderJsonDiff(log)}
                        </TableCell>
                      </TableRow>
                    </CollapsibleContent>
                  </>
                </Collapsible>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default AuditLogViewer;
