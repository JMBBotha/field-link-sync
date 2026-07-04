import { WifiOff, RefreshCw } from "lucide-react";
import { useOfflineContext } from "@/contexts/OfflineContext";

export function OfflineBanner() {
  const { isOnline, syncStatus } = useOfflineContext();
  const pending = syncStatus?.pendingCount ?? 0;

  // Online + nothing queued → hide
  if (isOnline && pending === 0) return null;

  // Online but still syncing queued ops → subtle blue pill
  if (isOnline && pending > 0) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-blue-600/90 text-white p-2 text-center text-xs font-medium flex items-center justify-center gap-2 backdrop-blur-sm shadow-md">
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
        Syncing {pending} queued {pending === 1 ? "change" : "changes"}…
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-700/90 text-white p-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 backdrop-blur-sm shadow-md">
      <WifiOff className="h-4 w-4 shrink-0" />
      You're offline — changes will sync when back online
      {pending > 0 && (
        <span className="ml-1 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
          {pending} queued
        </span>
      )}
    </div>
  );
}
