import { installFeedback } from "@/lib/feedback";
import { installChunkReload } from "@/lib/chunkReload";

// Stale lazy chunk after a deploy: one guarded hard reload (Johan 31 Oct 16:11).
installChunkReload();
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./components/v8/v8.css";
import { primeMapboxToken } from "@/lib/mapboxToken";
import { isPushWorkerUrl } from "@/lib/webPush";

// ── Apply saved / system theme BEFORE first paint to avoid a flash ──
(() => {
  try {
    const stored = localStorage.getItem("theme");
    const theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    root.style.colorScheme = theme;
  } catch {
    /* ignore */
  }
})();

// Only the push-only worker (/push-sw.js, no fetch/caching) is kept. Unregister any other stray one
// (old installs/extensions) so a cached shell can never pin an old bundle; VersionBanner handles updates.
try {
  navigator.serviceWorker?.getRegistrations?.().then((regs) => regs.forEach((r) => {
    const url = r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "";
    if (!isPushWorkerUrl(url)) void r.unregister();
  })).catch(() => {});
} catch {
  /* ignore */
}

// Fetch shared Mapbox public token early so map components never prompt the user.
primeMapboxToken();

// Global unhandled error logging with context
window.addEventListener("error", (event) => {
  console.error("[Global] Unhandled error:", {
    message: event.message,
    filename: event.filename,
    line: event.lineno,
    col: event.colno,
    url: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[Global] Unhandled promise rejection:", {
    reason: event.reason?.message || event.reason,
    stack: event.reason?.stack,
    url: window.location.pathname,
    timestamp: new Date().toISOString(),
  });
});

installFeedback();
createRoot(document.getElementById("root")!).render(<App />);
