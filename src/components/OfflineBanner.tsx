import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";

export function OfflineBanner() {
  const { isOnline } = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-amber-700/90 text-white p-2.5 text-center text-sm font-medium flex items-center justify-center gap-2 backdrop-blur-sm shadow-md">
      <WifiOff className="h-4 w-4 shrink-0" />
      You're offline — changes will sync when back online
    </div>
  );
}
