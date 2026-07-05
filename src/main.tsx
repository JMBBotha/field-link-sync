import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { primeMapboxToken } from "@/lib/mapboxToken";

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

createRoot(document.getElementById("root")!).render(<App />);
