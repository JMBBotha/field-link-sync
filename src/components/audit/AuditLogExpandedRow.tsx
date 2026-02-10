import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  computeChanges,
  resolveAllUUIDs,
  formatDisplayValue,
  getActionHeader,
  isUUID,
  type ChangeRow,
} from "@/lib/auditLogUtils";

interface AuditLogExpandedRowProps {
  log: {
    table_name: string;
    action: string;
    old_data: Record<string, any> | null;
    new_data: Record<string, any> | null;
  };
}

const ACTION_BADGE: Record<string, string> = {
  insert: "bg-green-600 text-white",
  update: "bg-blue-600 text-white",
  delete: "bg-red-600 text-white",
};

const AuditLogExpandedRow = ({ log }: AuditLogExpandedRowProps) => {
  const [resolvedNames, setResolvedNames] = useState<Map<string, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);

  const changes = computeChanges(
    log.table_name,
    log.action,
    log.old_data,
    log.new_data
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    resolveAllUUIDs(log.old_data, log.new_data).then((resolved) => {
      if (!cancelled) {
        setResolvedNames(resolved);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [log.old_data, log.new_data]);

  const header = getActionHeader(log.table_name, log.action);
  const isUpdate = log.action === "update";

  const renderValue = (value: unknown, fieldName: string, side: "old" | "new") => {
    const formatted = formatDisplayValue(value, resolvedNames, fieldName);

    if (formatted.isNull) {
      return <span className="italic text-muted-foreground text-xs">Not set</span>;
    }

    if (formatted.type === "uuid") {
      const fullUUID = String(value);
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="font-mono text-xs cursor-help border-b border-dashed border-muted-foreground/40">
                {formatted.text}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="font-mono text-xs">
              {fullUUID}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return <span className="text-xs">{formatted.text}</span>;
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-semibold text-foreground">Change Details</h4>
        <span className="text-sm text-muted-foreground">—</span>
        <span className="text-sm font-medium text-foreground">{header}</span>
        <Badge className={`text-[10px] ${ACTION_BADGE[log.action] || ""}`}>
          {log.action}
        </Badge>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-xs">Loading details...</span>
        </div>
      ) : changes.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No visible changes</p>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-blue-500/10 border-b">
                <th className="text-left px-3 py-2 text-xs font-semibold text-blue-300 w-1/4">
                  Field
                </th>
                {isUpdate ? (
                  <>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-blue-300 w-[37.5%]">
                      Before
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-blue-300 w-[37.5%]">
                      After
                    </th>
                  </>
                ) : (
                  <th className="text-left px-3 py-2 text-xs font-semibold text-blue-300">
                    Value
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {changes.map((row) => (
                <tr key={row.field} className="hover:bg-muted/30">
                  <td className="px-3 py-2 text-xs font-medium text-foreground">
                    {row.label}
                  </td>
                  {isUpdate ? (
                    <>
                      <td className="px-3 py-2">
                        <span className="text-red-400 line-through">
                          {renderValue(row.oldValue, row.field, "old")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-green-400">
                          {renderValue(row.newValue, row.field, "new")}
                        </span>
                      </td>
                    </>
                  ) : (
                    <td className="px-3 py-2 text-muted-foreground">
                      {renderValue(
                        log.action === "delete" ? row.oldValue : row.newValue,
                        row.field,
                        log.action === "delete" ? "old" : "new"
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AuditLogExpandedRow;
