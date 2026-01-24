import { useState, useEffect } from "react";
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetTrigger,
  SheetDescription 
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { 
  RefreshCw, 
  Trash2, 
  Clock, 
  FileText, 
  MapPin, 
  Camera, 
  Timer,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2
} from "lucide-react";
import { PendingOperation, OperationType } from "@/lib/offlineDb";
import { SyncStatus } from "@/hooks/useSyncQueue";
import { formatDistanceToNow } from "date-fns";

interface SyncQueuePanelProps {
  syncStatus: SyncStatus;
  onSyncNow: () => Promise<void>;
  onClearFailed: () => Promise<number>;
  onDeleteOperation: (id: number) => Promise<void>;
  getPendingOperations: () => Promise<PendingOperation[]>;
  trigger: React.ReactNode;
}

const operationIcons: Record<OperationType, React.ReactNode> = {
  update_lead: <FileText className="h-4 w-4" />,
  update_job_status: <FileText className="h-4 w-4" />,
  create_invoice: <FileText className="h-4 w-4" />,
  update_invoice: <FileText className="h-4 w-4" />,
  update_equipment: <FileText className="h-4 w-4" />,
  update_agent_location: <MapPin className="h-4 w-4" />,
  upload_photo: <Camera className="h-4 w-4" />,
  delete_photo: <Trash2 className="h-4 w-4" />,
  update_timer_log: <Timer className="h-4 w-4" />,
};

const operationLabels: Record<OperationType, string> = {
  update_lead: "Job Update",
  update_job_status: "Status Change",
  create_invoice: "New Invoice",
  update_invoice: "Invoice Update",
  update_equipment: "Equipment Update",
  update_agent_location: "Location Update",
  upload_photo: "Photo Upload",
  delete_photo: "Photo Delete",
  update_timer_log: "Timer Log",
};

export function SyncQueuePanel({
  syncStatus,
  onSyncNow,
  onClearFailed,
  onDeleteOperation,
  getPendingOperations,
  trigger,
}: SyncQueuePanelProps) {
  const [operations, setOperations] = useState<PendingOperation[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Load operations when panel opens
  useEffect(() => {
    if (open) {
      loadOperations();
    }
  }, [open, syncStatus.pendingCount]);

  const loadOperations = async () => {
    setLoading(true);
    try {
      const ops = await getPendingOperations();
      setOperations(ops);
    } catch (error) {
      console.error("Failed to load operations:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncNow = async () => {
    await onSyncNow();
    await loadOperations();
  };

  const handleClearFailed = async () => {
    await onClearFailed();
    await loadOperations();
  };

  const handleDeleteOperation = async (id: number) => {
    await onDeleteOperation(id);
    await loadOperations();
  };

  const failedOps = operations.filter(op => op.retryCount > 0);
  const pendingOps = operations.filter(op => op.retryCount === 0);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md bg-background">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Sync Queue
          </SheetTitle>
          <SheetDescription>
            Manage pending offline changes
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Status Summary */}
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-2">
              {syncStatus.isSyncing ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : syncStatus.pendingCount === 0 ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : syncStatus.failedOperations > 0 ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <Clock className="h-4 w-4 text-yellow-500" />
              )}
              <span className="text-sm font-medium">
                {syncStatus.isSyncing
                  ? "Syncing..."
                  : syncStatus.pendingCount === 0
                  ? "All synced"
                  : `${syncStatus.pendingCount} pending`}
              </span>
            </div>
            {syncStatus.lastSyncAt && (
              <span className="text-xs text-muted-foreground">
                Last sync: {formatDistanceToNow(syncStatus.lastSyncAt, { addSuffix: true })}
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              onClick={handleSyncNow}
              disabled={syncStatus.isSyncing || syncStatus.pendingCount === 0}
              className="flex-1"
              size="sm"
            >
              {syncStatus.isSyncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Sync Now
            </Button>
            
            {failedOps.length > 0 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear Failed ({failedOps.length})
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Clear Failed Operations?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently remove {failedOps.length} failed operation{failedOps.length > 1 ? 's' : ''}. 
                      These changes will not be synced to the server.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleClearFailed}>
                      Clear Failed
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {/* Operations Breakdown */}
          {syncStatus.pendingCount > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(syncStatus.pendingByType).map(([type, count]) => 
                count > 0 && (
                  <div 
                    key={type}
                    className="flex items-center gap-2 p-2 rounded bg-muted/30 text-sm"
                  >
                    {operationIcons[type as OperationType]}
                    <span className="flex-1 truncate">{operationLabels[type as OperationType]}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count}
                    </Badge>
                  </div>
                )
              )}
            </div>
          )}

          {/* Operations List */}
          <ScrollArea className="h-[400px] pr-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : operations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mb-2 opacity-50" />
                <p className="text-sm">No pending changes</p>
              </div>
            ) : (
              <div className="space-y-2">
                {/* Failed Operations */}
                {failedOps.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-destructive uppercase tracking-wide">
                      Failed ({failedOps.length})
                    </h4>
                    {failedOps.map((op) => (
                      <OperationCard
                        key={op.id}
                        operation={op}
                        onDelete={() => op.id && handleDeleteOperation(op.id)}
                        isFailed
                      />
                    ))}
                  </>
                )}

                {/* Pending Operations */}
                {pendingOps.length > 0 && (
                  <>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4">
                      Pending ({pendingOps.length})
                    </h4>
                    {pendingOps.map((op) => (
                      <OperationCard
                        key={op.id}
                        operation={op}
                        onDelete={() => op.id && handleDeleteOperation(op.id)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface OperationCardProps {
  operation: PendingOperation;
  onDelete: () => void;
  isFailed?: boolean;
}

function OperationCard({ operation, onDelete, isFailed }: OperationCardProps) {
  return (
    <div 
      className={`p-3 rounded-lg border ${
        isFailed 
          ? 'bg-destructive/10 border-destructive/30' 
          : 'bg-muted/30 border-border'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={isFailed ? 'text-destructive' : 'text-muted-foreground'}>
            {operationIcons[operation.operationType]}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {operationLabels[operation.operationType]}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDistanceToNow(operation.timestamp, { addSuffix: true })}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-1">
          {isFailed && (
            <Badge variant="destructive" className="text-xs">
              {operation.retryCount} retries
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
          >
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {isFailed && operation.lastError && (
        <p className="mt-2 text-xs text-destructive truncate">
          Error: {operation.lastError}
        </p>
      )}
    </div>
  );
}
