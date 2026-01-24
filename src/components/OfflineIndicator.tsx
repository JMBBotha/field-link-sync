import { Cloud, CloudOff, RefreshCw, Loader2, Check, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SyncStatus } from "@/hooks/useSyncQueue";
import { SyncQueuePanel } from "@/components/SyncQueuePanel";
import { PendingOperation } from "@/lib/offlineDb";

interface OfflineIndicatorProps {
  isOnline: boolean;
  syncStatus: SyncStatus;
  onRetrySync: () => Promise<void>;
  onClearFailed: () => Promise<number>;
  onDeleteOperation: (id: number) => Promise<void>;
  getPendingOperations: () => Promise<PendingOperation[]>;
  compact?: boolean;
}

export function OfflineIndicator({ 
  isOnline, 
  syncStatus, 
  onRetrySync,
  onClearFailed,
  onDeleteOperation,
  getPendingOperations,
  compact = false 
}: OfflineIndicatorProps) {
  const { isSyncing, pendingCount, failedOperations } = syncStatus;

  // Main indicator element
  const getIndicator = () => {
    // Syncing state
    if (isSyncing) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/20 rounded-full">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
          {!compact && (
            <span className="text-xs text-white font-medium">Syncing...</span>
          )}
        </div>
      );
    }

    // Offline with pending changes
    if (!isOnline && pendingCount > 0) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-500/20 rounded-full border border-orange-400/50 cursor-pointer">
          <CloudOff className="h-3.5 w-3.5 text-orange-400" />
          {!compact && (
            <span className="text-xs text-orange-300 font-medium">
              {pendingCount} pending
            </span>
          )}
          {compact && (
            <span className="text-xs text-orange-300 font-bold">{pendingCount}</span>
          )}
        </div>
      );
    }

    // Offline without pending changes
    if (!isOnline) {
      return (
        <Badge variant="outline" className="bg-orange-500/20 text-orange-300 border-orange-400/50 gap-1 cursor-pointer">
          <CloudOff className="h-3 w-3" />
          {!compact && "Offline"}
        </Badge>
      );
    }

    // Online with failed operations (need retry)
    if (failedOperations > 0) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-red-500/20 rounded-full border border-red-400/50 cursor-pointer">
          <AlertCircle className="h-3.5 w-3.5 text-red-400" />
          {!compact && (
            <span className="text-xs text-red-300 font-medium">
              {failedOperations} failed
            </span>
          )}
        </div>
      );
    }

    // Online with pending changes
    if (pendingCount > 0) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-yellow-500/20 rounded-full border border-yellow-400/50 cursor-pointer">
          <RefreshCw className="h-3.5 w-3.5 text-yellow-400" />
          {!compact && (
            <span className="text-xs text-yellow-300 font-medium">
              {pendingCount} pending
            </span>
          )}
        </div>
      );
    }

    // Online and synced
    return (
      <Badge variant="outline" className="bg-green-500/20 text-green-300 border-green-400/50 gap-1 cursor-pointer">
        <Cloud className="h-3 w-3" />
        {!compact && "Online"}
        {compact && <Check className="h-3 w-3" />}
      </Badge>
    );
  };

  return (
    <SyncQueuePanel
      syncStatus={syncStatus}
      onSyncNow={onRetrySync}
      onClearFailed={onClearFailed}
      onDeleteOperation={onDeleteOperation}
      getPendingOperations={getPendingOperations}
      trigger={
        <button 
          type="button"
          className="inline-flex items-center focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-full"
          title={
            isSyncing 
              ? "Syncing changes to server" 
              : !isOnline 
                ? `Offline - ${pendingCount} changes pending`
                : failedOperations > 0
                  ? `${failedOperations} failed - click to manage`
                  : pendingCount > 0
                    ? `${pendingCount} pending - click to sync`
                    : "Connected - all changes synced"
          }
        >
          {getIndicator()}
        </button>
      }
    />
  );
}

// Smaller inline indicator for lead cards
export function LeadSyncBadge({ hasPendingChanges }: { hasPendingChanges: boolean }) {
  if (!hasPendingChanges) return null;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-1 px-1.5 py-0.5 bg-orange-500/20 rounded text-orange-500">
          <CloudOff className="h-3 w-3" />
          <span className="text-[10px] font-medium">Pending</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>Changes pending sync</TooltipContent>
    </Tooltip>
  );
}
