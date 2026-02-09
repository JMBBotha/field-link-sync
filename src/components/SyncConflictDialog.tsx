import { useState, useEffect, useCallback } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export interface ConflictInfo {
  operationId: number;
  recordId: string;
  tableName: string;
  localData: any;
  serverData: any;
  serverUpdatedAt: string;
  localTimestamp: number;
}

interface SyncConflictDialogProps {
  conflict: ConflictInfo | null;
  onResolve: (operationId: number, choice: "keep_local" | "use_server") => void;
}

const AUTO_RESOLVE_TIMEOUT_MS = 30_000;

const SyncConflictDialog = ({ conflict, onResolve }: SyncConflictDialogProps) => {
  const [countdown, setCountdown] = useState(30);

  useEffect(() => {
    if (!conflict) return;
    setCountdown(30);

    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          // Auto last-write-wins after 30s
          console.log("[Conflict] Auto-resolving via last-write-wins (timeout):", conflict.recordId);
          onResolve(conflict.operationId, "keep_local");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [conflict?.operationId]);

  if (!conflict) return null;

  const serverTime = new Date(conflict.serverUpdatedAt).toLocaleString();
  const localTime = new Date(conflict.localTimestamp).toLocaleString();

  // Summarize key differences
  const diffKeys: string[] = [];
  if (conflict.localData && conflict.serverData) {
    const keys = new Set([
      ...Object.keys(conflict.localData),
      ...Object.keys(conflict.serverData),
    ]);
    keys.forEach((k) => {
      if (k === "cachedAt") return;
      const local = JSON.stringify(conflict.localData[k]);
      const server = JSON.stringify(conflict.serverData[k]);
      if (local !== server) diffKeys.push(k);
    });
  }

  return (
    <AlertDialog open={!!conflict}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <AlertDialogTitle className="text-base">Sync Conflict</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-sm space-y-2">
            <p>This job was changed remotely while you were offline.</p>
            <div className="text-xs space-y-1 p-2 rounded-lg bg-muted">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Your change:</span>
                <span>{localTime}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Server change:</span>
                <span>{serverTime}</span>
              </div>
              {diffKeys.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  <span className="text-muted-foreground text-[10px]">Changed:</span>
                  {diffKeys.slice(0, 5).map((k) => (
                    <Badge key={k} variant="secondary" className="text-[10px] h-4">
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Auto-resolving in {countdown}s (your changes will be kept)
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex-row gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => {
              console.log("[Conflict] Agent chose: use_server for", conflict.recordId);
              onResolve(conflict.operationId, "use_server");
            }}
          >
            Use Latest
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              console.log("[Conflict] Agent chose: keep_local for", conflict.recordId);
              onResolve(conflict.operationId, "keep_local");
            }}
          >
            Keep Mine
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default SyncConflictDialog;
