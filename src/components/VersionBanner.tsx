import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { checkForNewBuild, softReload, useBuildStatus } from "@/lib/buildInfo";

/** Small, non-blocking "new version" banner. Polls every 2 min and on focus. */
export default function VersionBanner() {
  const stale = useBuildStatus((s) => s.stale);
  useEffect(() => {
    if (import.meta.env.DEV) return;
    void checkForNewBuild();
    const id = window.setInterval(() => void checkForNewBuild(), 120_000);
    const onFocus = () => void checkForNewBuild();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, []);
  if (!stale) return null;
  return (
    <button
      type="button"
      onClick={softReload}
      className="fixed left-1/2 top-2 z-[100] -translate-x-1/2 flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg"
    >
      <RefreshCw className="h-4 w-4" /> New version available — tap to reload
    </button>
  );
}
